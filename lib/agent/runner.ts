import { google } from '@ai-sdk/google'
import { streamText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { ActionSchema, type Action } from '@/lib/actions/schema'
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt'
import { buildAgentContext } from '@/lib/agent/context'
import type { Room } from '@server/room'

// Same model as the voice orchestrator — short context, fast Flash tier.
// Picked for symmetry: voice + agent share latency budget and prompt style.
const MODEL_ID = 'gemini-3.1-flash-lite-preview'

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

	// The agent's emit_action tool. We deliberately use `z.unknown()` for the
	// action field so Gemini isn't forced through the SDK's JSON-Schema
	// conversion of our discriminated union (Gemini Flash 3 has rough edges
	// with deeply-nested oneOf-style schemas — same reason the voice
	// orchestrator uses `output: 'no-schema'`). We Zod-validate the inner
	// object ourselves with ActionSchema right after the tool call.
	//
	// Each emit_action call corresponds to exactly one Action. Multiple
	// actions in one turn = multiple tool calls in the same step.
	const emitAction = tool({
		description:
			'Add or modify a shape on the canvas. Pass a single Action object whose `type` is one of the documented action types. Call this multiple times in a turn to emit multiple actions.',
		inputSchema: z.object({
			action: z
				.unknown()
				.describe(
					'A single Action object — one of the documented action types (create_proposal_card / create_decision_card / create_commitment_card / create_blocker_card / create_question_card / create_priority_matrix / create_budget_allocator / link_nodes / lock_decision / update_card / group_into_frame). Must include `id` (or `from`/`to` for link_nodes) and all required fields for that type.',
				),
		}),
		// We declare `execute` so the AI SDK can carry the tool through its
		// multi-step loop. The actual side effect (recording + broadcasting)
		// happens in the dispatcher loop below — `execute` here just echoes
		// back a small confirmation so Gemini can see "the action landed".
		// We do NOT do the side effect inside execute() because we want it
		// gated by Zod validation and dedup, both of which want access to the
		// already-emitted actions in this turn.
		execute: async ({ action }) => {
			// Best-effort echo: the dispatcher loop will set this to a real
			// status. Returning a plain object keeps Gemini's tool-result
			// reasoning unambiguous.
			return { ok: true, type: (action as { type?: string })?.type ?? 'unknown' }
		},
	})

	const startedAt = Date.now()
	console.log(
		`[agent] turn start: ctx=${context.length}B user="${userMessage.slice(0, 80)}"`,
	)

	try {
		const result = streamText({
			model: google(MODEL_ID),
			system: AGENT_SYSTEM_PROMPT,
			prompt: userPrompt,
			temperature: 0.3,
			tools: { emit_action: emitAction },
			// Cap the agent at a single step. We don't want it bouncing tool
			// calls back-and-forth — one pass of "here are all the actions +
			// chat reply", then done. stepCountIs(1) keeps it bounded.
			stopWhen: stepCountIs(1),
		})

		const seenToolCalls = new Set<string>()

		for await (const part of result.fullStream) {
			if (part.type === 'text-delta') {
				yield { kind: 'text', delta: part.text }
				continue
			}
			if (part.type === 'tool-call') {
				// dynamic / static distinction doesn't matter to us — we
				// receive the parsed input either way.
				if (seenToolCalls.has(part.toolCallId)) continue
				seenToolCalls.add(part.toolCallId)
				// biome-ignore lint/suspicious/noExplicitAny: tool input is unknown by design (see emit_action schema rationale)
				const input = part.input as any
				const rawAction = input?.action
				if (!rawAction) {
					yield {
						kind: 'error',
						message: 'tool call missing `action` field',
					}
					continue
				}
				const dispatched = dispatchAction(room, rawAction)
				if (dispatched.ok) {
					yield { kind: 'action', action: dispatched.action }
				} else {
					yield { kind: 'error', message: dispatched.error }
				}
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
			// other parts (start, finish, tool-input-* deltas, etc.) are
			// ignored — they don't change the client-visible state.
		}

		console.log(
			`[agent] turn done in ${Date.now() - startedAt}ms; tool calls: ${seenToolCalls.size}`,
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

	const parsed = ActionSchema.safeParse(cleaned)
	if (!parsed.success) {
		const summary = parsed.error.issues
			.slice(0, 3)
			.map((i) => `${i.path.join('.')}: ${i.message}`)
			.join('; ')
		console.warn('[agent] action rejected:', summary, cleaned)
		return { ok: false, error: `invalid action — ${summary}` }
	}

	const action = parsed.data
	try {
		room.recordAction(action)
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
