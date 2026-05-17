import { google } from '@ai-sdk/google'
import { ToolLoopAgent, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { ActionSchema, type Action } from '@/lib/actions/schema'
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt'
import { buildAgentContext } from '@/lib/agent/context'
import type { Room } from '@server/room'

// Same model as the voice orchestrator — full Flash tier. The agent needs
// the same classification quality the voice loop does (it picks from the
// same Action discriminated union), so keeping them in lockstep is the
// right call. If we ever want a cheaper conversational reply path with no
// emit_action, the lite variant would be a fine drop-in.
const MODEL_ID = 'gemini-3-flash-preview'

/**
 * One event the agent runner emits to its consumer (the /api/agent HTTP
 * route). The route serializes these onto an application/x-ndjson stream.
 *
 *  - `text`     : a streamed-chat token delta
 *  - `action`   : one validated Action that was already applied (recorded
 *                 + broadcast) inside the runner
 *  - `error`    : non-fatal warning surfaced to the client (e.g. a tool call
 *                 failed Zod validation — we keep going)
 *  - `done`     : terminal — caller should close the stream
 */
export type AgentEvent =
	| { kind: 'text'; delta: string }
	| { kind: 'action'; action: Action }
	| { kind: 'error'; message: string }
	| { kind: 'done' }

/**
 * Run one agent chat turn for the given room.
 *
 * Yields an async iterator of `AgentEvent`s. For each event:
 *  - `text` deltas are forwarded to the client as-is
 *  - `action` events fire AFTER the action has already been recorded into
 *    the room's history AND broadcast to all WS clients. The HTTP client
 *    receives this for chat-panel display only — its own WS will also
 *    receive the broadcast and apply the shape via the standard path.
 *
 * Error policy:
 *  - Schema validation failures on a tool call → emit `error` event, skip
 *    that action, continue the rest of the stream.
 *  - Upstream Gemini errors → emit `error` event, terminate with `done`.
 *  - The voice orchestrator's `filterDuplicateCreates` runs against the
 *    room's full action history (which now also includes this turn's
 *    earlier actions), keeping voice/agent canvas state internally
 *    consistent.
 */
export async function* runAgentTurn(
	room: Room,
	userMessage: string,
): AsyncGenerator<AgentEvent> {
	const context = buildAgentContext(room)
	const userPrompt = `${context}\n\nUSER MESSAGE:\n${userMessage}`

	const startedAt = Date.now()
	console.log(
		`[agent] turn start: ctx=${context.length}B user="${userMessage.slice(0, 80)}"`,
	)

	try {
		const canvasAgent = makeCanvasAgent(room)
		const result = await canvasAgent.stream({ prompt: userPrompt })

		let toolResults = 0

		for await (const part of result.fullStream) {
			if (part.type === 'text-delta') {
				yield { kind: 'text', delta: part.text }
				continue
			}
			if (part.type === 'tool-result') {
				// Only `emit_action` produces canvas-affecting results. Read
				// tools also surface here, but their output is consumed by
				// the model (next step) — we don't need to forward it to
				// the client. Filter by tool name.
				// biome-ignore lint/suspicious/noExplicitAny: AI SDK tool-result discriminator union
				const p = part as any
				if (p.toolName !== 'emit_action') continue
				// biome-ignore lint/suspicious/noExplicitAny: output shape is the union returned from emit_action.execute
				const out = p.output as any
				toolResults += 1
				if (out?.ok && out.action) {
					yield { kind: 'action', action: out.action }
				} else if (out && out.ok === false) {
					yield {
						kind: 'error',
						message: out.error ?? 'dispatch failed',
					}
				}
				continue
			}
			if (part.type === 'tool-error') {
				// The SDK couldn't even call execute (e.g., bad inputSchema
				// match). Surface to the user so it's not a silent drop.
				// biome-ignore lint/suspicious/noExplicitAny: tool-error shape varies; we just want the message
				const err = part as any
				const message =
					err.error instanceof Error
						? err.error.message
						: typeof err.error === 'string'
							? err.error
							: 'tool invocation failed'
				console.warn('[agent] tool-error:', message)
				yield { kind: 'error', message }
				continue
			}
			if (part.type === 'error') {
				const msg =
					part.error instanceof Error
						? part.error.message
						: String(part.error ?? 'stream error')
				console.error('[agent] stream error part:', msg)
				yield { kind: 'error', message: msg }
				continue
			}
			// Other parts (start, finish, tool-input-* deltas, tool-call,
			// etc.) are intentionally ignored — they don't change client
			// state. We render off tool-result now, not tool-call.
		}

		console.log(
			`[agent] turn done in ${Date.now() - startedAt}ms; tool results: ${toolResults}`,
		)
		yield { kind: 'done' }
	} catch (err) {
		const ms = Date.now() - startedAt
		const message =
			err instanceof Error ? err.message : 'unknown agent error'
		console.error(`[agent] turn failed after ${ms}ms:`, message)
		yield { kind: 'error', message }
		yield { kind: 'done' }
	}
}

/**
 * Build a `ToolLoopAgent` for one chat turn. Factory-per-request because the
 * tool `execute` closures need to capture the live `Room` (so they can read
 * shapes, history, memory, transcript) without us having to plumb context
 * through `AgentStreamParameters` (which doesn't expose `experimental_context`
 * at the call site in `ai@6.x`). The construction cost is just object
 * allocation — no LLM round-trip — so per-request is fine.
 *
 * The agent runs a tool loop: at each step the model can call any tool, the
 * SDK feeds tool results back into the next step, and the loop stops when
 * either (a) the model produces a turn-final response with no tool calls or
 * (b) `stepCountIs(4)` fires. We chose 4 over 3 because the new READ tools
 * make a typical compound ask 4-step shaped:
 *   step 1: read_canvas → step 2: emit_action (creates) →
 *   step 3: emit_action (link_nodes) → step 4: text summary
 */
export function makeCanvasAgent(room: Room) {
	return new ToolLoopAgent({
		model: google(MODEL_ID),
		instructions: AGENT_SYSTEM_PROMPT,
		temperature: 0.3,
		tools: buildTools(room),
		// stepCountIs counts LLM calls. 4 = one read pass + plan + emit + summary
		// in the worst case. Most turns finish in 1–2 steps. We empirically
		// never need more than 4 for the supported vocabulary.
		stopWhen: stepCountIs(4),
	})
}

/**
 * The full tool set: one writer (`emit_action`) + five readers
 * (`read_canvas`, `find_shapes`, `count_links`, `read_memory`,
 * `read_transcript_window`). Each tool's `execute` closes over `room` so it
 * can read live state without round-tripping through the prompt blob.
 *
 * The CANVAS context blob in the user prompt is a snapshot taken once at
 * turn start; the read tools give the model a way to re-query the same data
 * mid-step (after it emits something, or when it needs to confirm an id it
 * hallucinated). All read outputs are intentionally compact — under a few
 * KB — so they don't blow out the context window.
 */
// Exported for unit testing — direct invocation of each tool's `execute`
// closure against a stub `Room` lets us cover read-tool behavior without
// spinning up the full agent stream.
export function buildTools(room: Room) {
	const emitAction = tool({
		description:
			'Add or modify a shape on the canvas. Pass a single Action object whose `type` is one of the documented action types. Call this multiple times in a turn to emit multiple actions.',
		inputSchema: z.object({
			action: z
				.unknown()
				.describe(
					'A single Action object — one of the documented action types (create_proposal_card / create_decision_card / create_commitment_card / create_blocker_card / create_question_card / create_note / create_geo / create_text / create_priority_matrix / create_budget_allocator / link_nodes / lock_decision / update_card / group_into_frame / delete_shapes / move_shape / resize_shape / set_shape_style / align_shapes / distribute_shapes / reorder_shapes / zoom_to_shapes / create_arrow). Must include `id` (or `from`/`to` for link_nodes) and all required fields for that type. NEVER invent a new type — for free-form jots / boxes / sticky notes use create_note.',
				),
		}),
		execute: async ({ action }) => {
			try {
				const dispatched = dispatchAction(room, action)
				if (dispatched.ok) {
					return {
						ok: true as const,
						action: dispatched.action,
						id:
							'id' in dispatched.action
								? dispatched.action.id
								: undefined,
						type: dispatched.action.type,
					}
				}
				return { ok: false as const, error: dispatched.error }
			} catch (err) {
				const message =
					err instanceof Error
						? err.message
						: 'dispatch threw an unknown error'
				console.error('[agent] emit_action.execute threw:', message)
				return { ok: false as const, error: message }
			}
		},
	})

	const readCanvas = tool({
		description:
			"Re-read the current canvas shapes (id, type, content summary). Use when you need to verify an id, find a shape by content, or confirm whether something already exists. Returns shapes in creation order; capped at 50 most-recent for very full canvases.",
		inputSchema: z.object({}),
		execute: async () => {
			const all = Array.from(room.canvasShapes.entries()).map(
				([id, v]) => ({ id, type: v.type, summary: v.summary }),
			)
			const truncated = all.length > 50
			const shapes = truncated ? all.slice(-50) : all
			return { count: all.length, truncated, shapes }
		},
	})

	const findShapes = tool({
		description:
			'Find shapes matching a query (substring of the shape summary) and/or a type filter. Use to locate cards by content ("the SMB proposal", "anything red") without re-reading the whole canvas.',
		inputSchema: z.object({
			query: z
				.string()
				.optional()
				.describe('case-insensitive substring to match against the shape summary'),
			type: z
				.string()
				.optional()
				.describe(
					'optional action type filter (e.g. "create_proposal_card", "create_note", "create_geo")',
				),
			limit: z
				.number()
				.int()
				.min(1)
				.max(20)
				.optional()
				.describe('max results to return; defaults to 20'),
		}),
		execute: async ({ query, type, limit }) => {
			const q = query?.toLowerCase()
			const cap = limit ?? 20
			const out: Array<{ id: string; type: string; summary: string }> = []
			for (const [id, v] of room.canvasShapes.entries()) {
				if (type && v.type !== type) continue
				if (q && !v.summary.toLowerCase().includes(q)) continue
				out.push({ id, type: v.type, summary: v.summary })
				if (out.length >= cap) break
			}
			return { count: out.length, matches: out }
		},
	})

	const countLinks = tool({
		description:
			'For a given shape id, count its incoming and outgoing links (link_nodes actions) and list the neighbor ids. Use to find "the most-linked proposal" or check whether a card is connected before deleting it.',
		inputSchema: z.object({
			id: z.string().describe('the shape id to inspect'),
		}),
		execute: async ({ id }) => {
			const incoming: Array<{ from: string; kind: string }> = []
			const outgoing: Array<{ to: string; kind: string }> = []
			for (const a of room.actionHistory) {
				if (a.type !== 'link_nodes') continue
				if (a.to === id) incoming.push({ from: a.from, kind: a.kind })
				if (a.from === id) outgoing.push({ to: a.to, kind: a.kind })
			}
			return {
				id,
				incoming: incoming.length,
				outgoing: outgoing.length,
				total: incoming.length + outgoing.length,
				neighbors: { incoming, outgoing },
			}
		},
	})

	const readMemory = tool({
		description:
			"Read the canvas's long-term compressed memory (voice thread narrative, chat thread narrative, shared meta: tensions/themes/abandoned/followups). Use when the user references something that happened earlier than the recent action window.",
		inputSchema: z.object({}),
		execute: async () => {
			const m = room.memory
			if (!m) {
				return {
					empty: true as const,
					note: 'no long-term memory yet for this canvas',
				}
			}
			return {
				empty: false as const,
				voiceThread: m.voiceThread,
				chatThread: m.chatThread,
				sharedMeta: m.sharedMeta,
				coverage: {
					voiceMsgsCovered: m.voiceMsgsCovered,
					chatMsgsCovered: m.chatMsgsCovered,
				},
			}
		},
	})

	const readTranscriptWindow = tool({
		description:
			'Read the last ~90s of finalized speech segments (speaker + text + timestamp). Use to confirm what was said when the user says "what I just said", or to ground a card in actual recent dialogue.',
		inputSchema: z.object({
			limit: z
				.number()
				.int()
				.min(1)
				.max(40)
				.optional()
				.describe('max segments to return (most recent first); defaults to 20'),
		}),
		execute: async ({ limit }) => {
			const segs = room.buffer.window()
			const cap = limit ?? 20
			const tail = segs.slice(-cap)
			return {
				count: tail.length,
				segments: tail.map((s) => ({
					speaker: s.speaker,
					text: s.text,
					ts: s.ts,
				})),
			}
		},
	})

	return {
		emit_action: emitAction,
		read_canvas: readCanvas,
		find_shapes: findShapes,
		count_links: countLinks,
		read_memory: readMemory,
		read_transcript_window: readTranscriptWindow,
	}
}

/**
 * Validate a raw action object via ActionSchema, persist + broadcast it on
 * success. Returns either the validated Action or a short error string for
 * the runner to surface to the client.
 *
 * We deliberately do NOT run the orchestrator's `filterDuplicateCreates` pass
 * here — the agent is acting on direct user intent ("add a question card"),
 * so silently dropping its emission as a "duplicate" would be confusing. The
 * agent's prompt already instructs it to use update_card on existing ids,
 * which is the right behavior for refinement.
 */
function dispatchAction(
	room: Room,
	raw: unknown,
): { ok: true; action: Action } | { ok: false; error: string } {
	// Strip explicit nulls (Gemini emits them for unset optionals — same
	// quirk the voice orchestrator's sanitizeRawObject handles).
	const cleaned = stripNulls(raw)
	// Normalize common LLM type-drift variants ("create_blocker" without the
	// _card suffix, "sticky_note" for create_note, "create_circle" for
	// create_geo{geo:ellipse}, etc.) BEFORE Zod runs. ALSO: if `type` is
	// missing entirely (we've seen the model emit a structurally-valid
	// payload with no discriminator), infer it from the payload shape.
	if (cleaned && typeof cleaned === 'object') {
		const obj = cleaned as Record<string, unknown>
		const t = obj.type
		if (typeof t === 'string') {
			const { type: norm, defaults } = normalizeActionType(t)
			if (norm !== t) {
				console.log(
					`[agent] normalized type "${t}" → "${norm}"${
						Object.keys(defaults).length > 0
							? ` (defaults: ${JSON.stringify(defaults)})`
							: ''
					}`,
				)
				obj.type = norm
				// Apply inferred defaults ONLY if the LLM didn't already set
				// the field — e.g. "create_circle" with no geo prop fills in
				// `geo: ellipse`, but if it emitted `geo: triangle` we keep
				// the explicit value.
				for (const [k, v] of Object.entries(defaults)) {
					if (!(k in obj)) obj[k] = v
				}
			}
		} else {
			// `type` is missing or non-string. Try to infer from the rest of
			// the payload. This catches a recurring failure mode where the
			// model emits `{ geo: 'rectangle', content: '...', color: '...' }`
			// (clearly a create_geo) or `{ id, patch: {...} }` (clearly an
			// update_card) but forgets the discriminator field.
			const inferred = inferActionType(obj)
			if (inferred) {
				console.log(
					`[agent] inferred type="${inferred}" from payload shape`,
				)
				obj.type = inferred
			}
		}
	}
	// Inject a server timestamp for proposal_card if missing (the model
	// often forgets `ts`).
	if (
		cleaned &&
		typeof cleaned === 'object' &&
		(cleaned as { type?: string }).type === 'create_proposal_card' &&
		typeof (cleaned as { ts?: unknown }).ts !== 'number'
	) {
		;(cleaned as { ts: number }).ts = Date.now()
	}
	// Defensive: layout objects fail validation in three common ways:
	//   1. `kind` is invalid (model invents "above_right", "stack")
	//   2. `kind` is valid but the required sibling field is missing
	//      (e.g. `{kind: 'grid'}` without `columns`)
	//   3. `kind` is valid but the sibling field is the wrong type
	// In all three we strip the layout entirely rather than fail the whole
	// action — type-aware default placement is a better fallback than
	// losing the user's "create X" intent on a layout-hint typo.
	if (cleaned && typeof cleaned === 'object') {
		const layout = (cleaned as { layout?: unknown }).layout as
			| { kind?: unknown; of?: unknown; columns?: unknown; nodeIds?: unknown }
			| undefined
		if (layout && typeof layout === 'object') {
			const kind = layout.kind
			const stripReason = validateLayout(kind, layout)
			if (stripReason) {
				console.log(`[agent] stripped layout — ${stripReason}`)
				delete (cleaned as { layout?: unknown }).layout
			}
		}
	}

	const parsed = ActionSchema.safeParse(cleaned)
	if (!parsed.success) {
		const summary = parsed.error.issues
			.slice(0, 3)
			.map((i) => `${i.path.join('.')}: ${i.message}`)
			.join('; ')
		const rawType =
			cleaned && typeof cleaned === 'object'
				? (cleaned as { type?: unknown }).type
				: undefined
		// Single-line log so the monitor's grep captures the actual value the
		// LLM sent. JSON.stringify on the full object can wrap to multiple
		// lines and get truncated by `tail | grep`.
		console.warn(
			`[agent] action rejected (sent type=${JSON.stringify(rawType)}): ${summary}`,
		)
		try {
			console.warn(
				'[agent] rejected payload:',
				JSON.stringify(cleaned).slice(0, 400),
			)
		} catch {}
		return { ok: false, error: `invalid action — ${summary}` }
	}

	const action = parsed.data
	try {
		// Tag with source='chat' so memory summaries attribute actions to
		// the right path. The voice orchestrator emits with the default
		// source='voice'.
		room.recordAction(action, 'chat')
		room.broadcast({ kind: 'actions', actions: [action] })
		console.log(
			`[agent] emitted ${action.type}${'id' in action ? ` ${action.id}` : ''}`,
		)
		return { ok: true, action }
	} catch (err) {
		const message = err instanceof Error ? err.message : 'broadcast failed'
		console.error('[agent] dispatch failed:', message)
		return { ok: false, error: message }
	}
}

/**
 * Returns a short reason string if the layout object is malformed; null if
 * it's a valid hint our schema accepts. Used by the dispatcher to decide
 * whether to drop the `layout` field before Zod validation.
 */
function validateLayout(
	kind: unknown,
	layout: { of?: unknown; columns?: unknown; nodeIds?: unknown },
): string | null {
	if (typeof kind !== 'string') return 'layout.kind missing or non-string'
	switch (kind) {
		case 'below':
		case 'above':
		case 'right_of':
		case 'left_of':
		case 'inside_frame':
			if (typeof layout.of !== 'string' || layout.of.length === 0) {
				return `layout.kind="${kind}" missing required \`of\` string`
			}
			return null
		case 'grid':
			if (
				typeof layout.columns !== 'number' ||
				!Number.isFinite(layout.columns) ||
				layout.columns <= 0
			) {
				return `layout.kind="grid" missing required \`columns\` positive integer`
			}
			return null
		case 'cluster_with':
			if (
				!Array.isArray(layout.nodeIds) ||
				layout.nodeIds.length === 0 ||
				!layout.nodeIds.every((n) => typeof n === 'string')
			) {
				return `layout.kind="cluster_with" missing/invalid \`nodeIds\` string[]`
			}
			return null
		default:
			return `layout.kind="${kind}" not in {below,above,right_of,left_of,inside_frame,grid,cluster_with}`
	}
}

/**
 * Best-guess the Action `type` from the payload shape when the LLM forgot to
 * emit the discriminator field. Order matters — most-specific shapes first
 * so we don't misclassify (e.g. `update_card.patch` would otherwise look
 * like a generic object). Returns `null` when the shape is too ambiguous to
 * decide — better to surface a clean Zod error than to silently mislabel.
 *
 * Empirically this catches:
 *   - "make this yellow" → { geo, content, color, fill } missing `type` → create_geo
 *   - "set X to Y" → { id, patch } missing `type` → update_card
 *   - "link A to B" → { from, to, kind } missing `type` → link_nodes
 */
function inferActionType(o: Record<string, unknown>): string | null {
	// Highly specific shape signatures first.
	if ('patch' in o && 'id' in o) return 'update_card'
	if ('from' in o && 'to' in o) return 'link_nodes'
	// L4 manipulation — distinguish via `op` enum value when present, then
	// fall back to shape of `ids`/`id`. `start`+`end` (both with x/y) is
	// the create_arrow signature.
	if (
		'start' in o &&
		'end' in o &&
		typeof o.start === 'object' &&
		typeof o.end === 'object' &&
		o.start !== null &&
		o.end !== null &&
		'x' in (o.start as object)
	) {
		return 'create_arrow'
	}
	if ('ids' in o && 'op' in o && typeof o.op === 'string') {
		const op = o.op
		if (
			op === 'left' || op === 'right' || op === 'top' || op === 'bottom' ||
			op === 'center-horizontal' || op === 'center-vertical'
		) {
			return 'align_shapes'
		}
		if (op === 'horizontal' || op === 'vertical') {
			return 'distribute_shapes'
		}
		if (
			op === 'to_front' || op === 'to_back' ||
			op === 'forward' || op === 'backward'
		) {
			return 'reorder_shapes'
		}
	}
	// `ids` alone (no other discriminator) most likely delete or zoom — we
	// can't tell which. Default to delete which is the more common intent;
	// if the agent wanted zoom it should have used the explicit type.
	if (
		'ids' in o &&
		Array.isArray(o.ids) &&
		Object.keys(o).length === 1
	) {
		return 'delete_shapes'
	}
	if ('id' in o && ('w' in o || 'h' in o) && !('geo' in o) && !('content' in o)) {
		return 'resize_shape'
	}
	if (
		'id' in o &&
		('x' in o || 'y' in o || 'dx' in o || 'dy' in o) &&
		!('content' in o) &&
		!('geo' in o)
	) {
		return 'move_shape'
	}
	if (
		'id' in o &&
		('color' in o || 'fill' in o || 'dash' in o || 'size' in o || 'font' in o) &&
		!('content' in o) &&
		!('geo' in o) &&
		!('items' in o) &&
		!('splits' in o) &&
		!('start' in o)
	) {
		return 'set_shape_style'
	}
	if ('geo' in o) return 'create_geo'
	if ('splits' in o) return 'create_budget_allocator'
	if ('items' in o && Array.isArray(o.items)) {
		const first = (o.items as unknown[])[0]
		if (first && typeof first === 'object') {
			// priority_matrix items have `impact` + `effort`; gantt items
			// have `startDays` + `endDays`. Disjoint enough to discriminate.
			if ('impact' in (first as object)) return 'create_priority_matrix'
			if ('startDays' in (first as object)) return 'create_gantt'
		}
		// Fallback when items[0] is something else — matrix is the more
		// commonly-requested L3, so default there.
		return 'create_priority_matrix'
	}
	if ('blockedNodeIds' in o) return 'create_blocker_card'
	if ('sourceProposalIds' in o) return 'create_decision_card'
	if ('askedBySpeakerId' in o) return 'create_question_card'
	if ('proposerSpeakerId' in o) return 'create_proposal_card'
	if ('ownerSpeakerId' in o && 'action' in o) return 'create_commitment_card'
	if ('nodeIds' in o && 'label' in o && !('id' in o)) return 'group_into_frame'
	if ('id' in o && 'content' in o && Object.keys(o).length <= 4) {
		// Bare { id, content, [color], [layout] } with no other discriminating
		// fields is most likely a create_note (the lightest content-bearing
		// card type). Won't always be right — for a sticky vs. a label the
		// model should send `type` explicitly — but a yellow sticky note is
		// the right fallback because it's the only meeting-agnostic option.
		return 'create_note'
	}
	return null
}

/**
 * Map common LLM type-drift variants to the canonical schema discriminator.
 *
 * Empirically Gemini Flash sometimes drops the `_card` suffix ("create_blocker"
 * for "create_blocker_card") or rewords actions in its own dialect
 * ("add_question" instead of "create_question_card"). Rather than fail the
 * tool call AND lose the whole turn, we map known-good aliases through.
 *
 * Lower-cases & normalizes the input before matching so trailing punctuation,
 * camelCase, dashes-vs-underscores, etc. don't matter. If no alias matches,
 * the original string is returned and Zod's discriminator error surfaces
 * as before — the right outcome for genuinely unknown types.
 */
function normalizeActionType(
	input: string,
): { type: string; defaults: Record<string, unknown> } {
	const key = input
		.toLowerCase()
		.replace(/[\s-]+/g, '_')
		.replace(/[^a-z_]/g, '')
		.replace(/^(add|make|emit|new)_/, 'create_')
	// Most aliases just remap the type. A few (shape-specific words like
	// "create_circle") ALSO infer a default prop value — captured as the
	// second tuple element.
	const ALIASES: Record<string, [string, Record<string, unknown>?]> = {
		// Card shortcuts (no _card suffix)
		create_proposal: ['create_proposal_card'],
		create_decision: ['create_decision_card'],
		create_commitment: ['create_commitment_card'],
		create_blocker: ['create_blocker_card'],
		create_question: ['create_question_card'],
		proposal_card: ['create_proposal_card'],
		decision_card: ['create_decision_card'],
		commitment_card: ['create_commitment_card'],
		blocker_card: ['create_blocker_card'],
		question_card: ['create_question_card'],
		proposal: ['create_proposal_card'],
		decision: ['create_decision_card'],
		commitment: ['create_commitment_card'],
		blocker: ['create_blocker_card'],
		question: ['create_question_card'],
		// Free-form notes
		create_sticky_note: ['create_note'],
		create_sticky: ['create_note'],
		create_text_note: ['create_note'],
		create_text_card: ['create_note'],
		sticky_note: ['create_note'],
		sticky: ['create_note'],
		note: ['create_note'],
		// Generic geo shapes — these infer the `geo` prop from the type name.
		create_box: ['create_geo', { geo: 'rectangle' }],
		create_rectangle: ['create_geo', { geo: 'rectangle' }],
		create_rect: ['create_geo', { geo: 'rectangle' }],
		create_circle: ['create_geo', { geo: 'ellipse' }],
		create_ellipse: ['create_geo', { geo: 'ellipse' }],
		create_oval: ['create_geo', { geo: 'oval' }],
		create_triangle: ['create_geo', { geo: 'triangle' }],
		create_diamond: ['create_geo', { geo: 'diamond' }],
		create_pentagon: ['create_geo', { geo: 'pentagon' }],
		create_hexagon: ['create_geo', { geo: 'hexagon' }],
		create_octagon: ['create_geo', { geo: 'octagon' }],
		create_star: ['create_geo', { geo: 'star' }],
		create_heart: ['create_geo', { geo: 'heart' }],
		create_cloud: ['create_geo', { geo: 'cloud' }],
		create_trapezoid: ['create_geo', { geo: 'trapezoid' }],
		create_rhombus: ['create_geo', { geo: 'rhombus' }],
		create_check_box: ['create_geo', { geo: 'check-box' }],
		create_checkbox: ['create_geo', { geo: 'check-box' }],
		create_x_box: ['create_geo', { geo: 'x-box' }],
		create_shape: ['create_geo'],
		create_geo_shape: ['create_geo'],
		box: ['create_geo', { geo: 'rectangle' }],
		rectangle: ['create_geo', { geo: 'rectangle' }],
		circle: ['create_geo', { geo: 'ellipse' }],
		ellipse: ['create_geo', { geo: 'ellipse' }],
		triangle: ['create_geo', { geo: 'triangle' }],
		diamond: ['create_geo', { geo: 'diamond' }],
		// Plain text labels.
		create_label: ['create_text'],
		create_heading: ['create_text', { size: 'l' }],
		create_title: ['create_text', { size: 'xl' }],
		text: ['create_text'],
		label: ['create_text'],
		heading: ['create_text', { size: 'l' }],
		title: ['create_text', { size: 'xl' }],
		// L3 widget shortcuts.
		create_matrix: ['create_priority_matrix'],
		priority_matrix: ['create_priority_matrix'],
		create_budget: ['create_budget_allocator'],
		budget_allocator: ['create_budget_allocator'],
		create_link: ['link_nodes'],
		link: ['link_nodes'],
		lock: ['lock_decision'],
		update: ['update_card'],
		group: ['group_into_frame'],
		// L4 manipulation aliases — singular/plural and verb-form variants.
		delete: ['delete_shapes'],
		delete_shape: ['delete_shapes'],
		remove: ['delete_shapes'],
		remove_shape: ['delete_shapes'],
		remove_shapes: ['delete_shapes'],
		move: ['move_shape'],
		reposition: ['move_shape'],
		resize: ['resize_shape'],
		set_style: ['set_shape_style'],
		set_color: ['set_shape_style'],
		recolor: ['set_shape_style'],
		style: ['set_shape_style'],
		align: ['align_shapes'],
		distribute: ['distribute_shapes'],
		space: ['distribute_shapes'],
		reorder: ['reorder_shapes'],
		bring_to_front: ['reorder_shapes', { op: 'to_front' }],
		send_to_back: ['reorder_shapes', { op: 'to_back' }],
		bring_forward: ['reorder_shapes', { op: 'forward' }],
		send_backward: ['reorder_shapes', { op: 'backward' }],
		zoom: ['zoom_to_shapes'],
		zoom_to_fit: ['zoom_to_shapes'],
		fit: ['zoom_to_shapes'],
		focus: ['zoom_to_shapes'],
		create_freeform_arrow: ['create_arrow'],
		create_unbound_arrow: ['create_arrow'],
		arrow: ['create_arrow'],
	}
	const hit = ALIASES[key]
	if (!hit) return { type: input, defaults: {} }
	return { type: hit[0], defaults: hit[1] ?? {} }
}

/**
 * Recursively drop `null` values from an object so Zod `.optional()` fields
 * stay undefined-or-missing instead of failing validation on a literal null.
 * Mirrors the voice loop's `sanitizeRawObject` helper.
 */
function stripNulls(value: unknown): unknown {
	if (value == null) return value
	if (Array.isArray(value)) return value.map(stripNulls)
	if (typeof value !== 'object') return value
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (v === null) continue
		out[k] = stripNulls(v)
	}
	return out
}
