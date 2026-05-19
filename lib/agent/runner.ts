import { google } from '@ai-sdk/google'
import { ToolLoopAgent, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import type { Action } from '@/lib/actions/schema'
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt'
import { buildAgentContext } from '@/lib/agent/context'
import { buildReadTools } from '@/lib/agent/tools'
import { BroadcastThrottle } from '@/lib/agent/broadcast-throttle'
import { prepareAction } from '@/lib/actions/dispatch'
import type { Room } from '@server/room'

// Same model as the voice orchestrator — full Flash tier. The agent needs
// the same classification quality the voice loop does (it picks from the
// same Action discriminated union), so keeping them in lockstep is the
// right call. Briefly tried `gemini-3.1-flash-lite` for latency during demo
// bring-up (2026-05-19) but reverted — lite emits malformed action payload
// shapes that needed the `normalizePayloadShape` recovery in dispatch.ts to
// even render. Flash is the safer baseline.
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
	options?: { canvasImage?: string },
): AsyncGenerator<AgentEvent> {
	const context = buildAgentContext(room)
	const userPrompt = `${context}\n\nUSER MESSAGE:\n${userMessage}`

	const startedAt = Date.now()
	const hasImage = Boolean(options?.canvasImage)
	console.log(
		`[agent] turn start: ctx=${context.length}B user="${userMessage.slice(0, 80)}" img=${hasImage ? 'yes' : 'no'}`,
	)

	try {
		const canvasAgent = makeCanvasAgent(room)
		// When the client ships a PNG snapshot of the canvas, switch from
		// the plain `prompt: string` form to the multimodal `messages` form.
		// Gemini 3 Flash is multimodal and consumes `image` content parts
		// natively via the Vercel AI SDK. Keeps the same `streamText`/
		// ToolLoopAgent pipeline — just richer first message.
		const result = options?.canvasImage
			? await canvasAgent.stream({
					messages: [
						{
							role: 'user',
							content: [
								{ type: 'text', text: userPrompt },
								{
									type: 'image',
									image: options.canvasImage,
								},
							],
						},
					],
				})
			: await canvasAgent.stream({ prompt: userPrompt })

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
 * (b) `stepCountIs(15)` fires.
 *
 * The 15-step cap pairs with the "STREAMING — one action per step" prompt
 * guidance: we want the model to emit ONE action per step (so the client
 * sees shapes appear progressively, not in a batch dump). A 10-shape
 * compound diagram now needs 10+ steps, so the cap had to climb. Most
 * single-action turns still finish in 1-2 steps.
 *
 * The `BroadcastThrottle` is a belt-and-suspenders complement to the
 * prompt: when the model defies the guidance and emits multiple tool
 * calls in parallel within a step, the throttle serializes their
 * broadcasts so the client still sees a visible stream rather than a
 * burst. One throttle per agent instance = one per turn.
 */
export function makeCanvasAgent(room: Room) {
	const throttle = new BroadcastThrottle(120)
	return new ToolLoopAgent({
		model: google(MODEL_ID),
		instructions: AGENT_SYSTEM_PROMPT,
		temperature: 0.3,
		tools: buildTools(room, throttle),
		stopWhen: stepCountIs(15),
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
// spinning up the full agent stream. The throttle is optional in the
// signature so existing tests (which don't care about timing) can pass
// a no-op throttle (gapMs=0) without ceremony.
export function buildTools(
	room: Room,
	throttle: BroadcastThrottle = new BroadcastThrottle(0),
) {
	const emitAction = tool({
		description:
			'Add or modify a shape on the canvas. Pass a single Action object whose `type` is one of the documented action types. Call this multiple times in a turn to emit multiple actions.',
		inputSchema: z.object({
			action: z
				.unknown()
				.describe(
					'A single Action object — one of the documented action types (create_proposal_card / create_decision_card / create_commitment_card / create_blocker_card / create_question_card / create_note / create_geo / create_text / create_priority_matrix / create_budget_allocator / link_nodes / lock_decision / update_card / group_into_frame / delete_shapes / move_shape / resize_shape / set_shape_style / align_shapes / distribute_shapes / reorder_shapes / zoom_to_shapes / create_arrow / create_mermaid_diagram). Must include `id` (or `from`/`to` for link_nodes) and all required fields for that type. NEVER invent a new type — for free-form jots / boxes / sticky notes use create_note.',
				),
		}),
		execute: async ({ action }) => {
			try {
				// Stage 1: normalize + validate + ref-check + record. Synchronous.
				// We record BEFORE the throttle wait so subsequent emit_action
				// calls in the same step (which run concurrently) see this
				// shape in room.canvasShapes for their own ref-validation
				// step. Only the WS broadcast is staggered — internal state
				// is always up-to-date.
				const dispatched = dispatchActionAndRecord(room, action)
				if (!dispatched.ok) {
					return { ok: false as const, error: dispatched.error }
				}

				// Stage 2: throttled broadcast. Parallel tool-call siblings
				// stack up on the throttle's promise chain and get released
				// `gapMs` apart, so the client sees shapes appear in sequence
				// rather than all-at-once. First caller (or any caller after
				// a long quiet gap) resolves immediately.
				await throttle.awaitTurn()
				room.broadcast({
					kind: 'actions',
					actions: [dispatched.action],
				})
				console.log(
					`[agent] emitted ${dispatched.action.type}${
						'id' in dispatched.action
							? ` ${dispatched.action.id}`
							: ''
					}`,
				)

				return {
					ok: true as const,
					action: dispatched.action,
					id:
						'id' in dispatched.action
							? dispatched.action.id
							: undefined,
					type: dispatched.action.type,
				}
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

	// Shared observation tools live in lib/agent/tools.ts so the voice
	// MODE-B agent (lib/orchestrator/voice-agent.ts) reuses the exact same
	// implementations — both surfaces read the same canvas, action history,
	// and memory blob, so they should query them through one code path.
	const reads = buildReadTools(room)

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
		...reads,
		read_transcript_window: readTranscriptWindow,
	}
}

/**
 * Validate a raw action object via the shared prepareAction pipeline and
 * commit it to room state. Returns the validated Action on success;
 * caller broadcasts after the throttle gate (see emit_action.execute).
 *
 * "Record" here means: append to `room.actionHistory`, update the
 * `canvasShapes` summary index, persist to Postgres (fire-and-forget).
 * Broadcasting (sending the WS message to connected clients) is the
 * caller's responsibility and is intentionally separated so the
 * BroadcastThrottle can serialize WS emissions across parallel
 * `emit_action` calls without blocking internal state updates.
 *
 * Why not bundle the broadcast inline: parallel tool calls within a
 * single ToolLoopAgent step all run their `execute` concurrently. If
 * broadcast were inline, all five emit_action calls would fire their
 * WS messages within a millisecond — the client sees a burst dump.
 * Keeping `recordAction` here (sync, immediate) means sibling tool
 * calls can still validate refs against the live `canvasShapes` map;
 * staggering only the broadcast preserves both invariants.
 *
 * We deliberately do NOT run the orchestrator's `filterDuplicateCreates`
 * pass here — the chat agent acts on direct user intent ("add a
 * question card"), so silently dropping its emission as a "duplicate"
 * would be confusing. The prompt instructs the model to use update_card
 * on existing ids, which is the right behavior for refinement.
 *
 * The voice MODE-B agent uses the same prepareAction (via
 * lib/orchestrator/voice-agent.ts) plus an additional per-action dedup
 * step before record+broadcast.
 */
function dispatchActionAndRecord(
	room: Room,
	raw: unknown,
): { ok: true; action: Action } | { ok: false; error: string } {
	const prepared = prepareAction(raw, room, 'agent')
	if (!prepared.ok) return prepared

	const action = prepared.action
	try {
		room.recordAction(action, 'chat')
		return { ok: true, action }
	} catch (err) {
		const message = err instanceof Error ? err.message : 'recordAction failed'
		console.error('[agent] dispatch failed:', message)
		return { ok: false, error: message }
	}
}
