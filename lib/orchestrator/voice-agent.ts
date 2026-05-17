import { google } from '@ai-sdk/google'
import { ToolLoopAgent, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import type { Action } from '@/lib/actions/schema'
import { buildReadTools } from '@/lib/agent/tools'
import { prepareAction } from '@/lib/actions/dispatch'
import { VOICE_AGENT_SYSTEM_PROMPT } from '@/lib/orchestrator/voice-agent-prompt'
import type { Room } from '@server/room'

/**
 * Voice MODE-B ReAct agent.
 *
 * Sits beside the existing `generateObject`-driven orchestrator path. When
 * `lib/orchestrator/loop.ts`'s classifier decides the live transcript
 * window contains a compound canvas command ("draw a flowchart with
 * arrows", "rank these by impact and effort", "align all the proposals to
 * the left"), it routes to `makeVoiceAgent(room).stream(...)` instead of
 * the single-shot generateObject path.
 *
 * Shape parity with chat: same `ToolLoopAgent`, same shared `buildReadTools`,
 * same `prepareAction` validation pipeline. The differences:
 *
 *   - `stepCountIs(3)`, not 4. Voice has no chat panel to summarize into,
 *     so the typical compound turn finishes in: read → emit (one or more) →
 *     optional self-correct. Step 4 (text summary) is wasted.
 *   - The emit tool runs per-action dedup BEFORE record+broadcast — voice
 *     ticks land back-to-back with the orchestrator's batch dedup pass, so
 *     a re-finalized utterance shouldn't double up.
 *   - source='voice' on recordAction so memory summaries attribute the
 *     actions to the right thread.
 *
 * Latency budget at `stepCountIs(3)` is ~8-12s p95 with Gemini 3 Flash.
 * The classifier ensures only compound MODE-B utterances pay that cost;
 * everything else stays on the ~5-15s generateObject single-shot path.
 */

const MODEL_ID = 'gemini-3-flash-preview'

/**
 * Build a per-tick voice agent. The factory pattern (cf. chat's
 * `makeCanvasAgent`) lets every tool close over the live `room` and the
 * tick-local dedup set without us having to thread `experimental_context`
 * through `AgentStreamParameters` (which `ai@6.x` doesn't expose at the
 * call site).
 *
 * `dedupSet` is a per-tick Set of "create-key" fingerprints; the emit tool
 * uses it to reject duplicate creates within a single turn (e.g. the model
 * emitting two link_nodes for the same arrow because step-2 didn't see
 * step-1's result clearly).
 */
export function makeVoiceAgent(room: Room) {
	const dedupSet = new Set<string>()
	const reads = buildReadTools(room)
	const emit = buildVoiceEmitTool(room, dedupSet)
	return new ToolLoopAgent({
		model: google(MODEL_ID),
		instructions: VOICE_AGENT_SYSTEM_PROMPT,
		temperature: 0.3,
		tools: { emit_action: emit, ...reads },
		// Three steps: typical compound voice command finishes in
		// read → emit → (optional) emit-correction. Step 4 (text summary)
		// is wasted because voice has no chat panel surface to summarize
		// into. Cap kept low so a single tick never blows the 3s debounce.
		stopWhen: stepCountIs(3),
	})
}

/**
 * Voice emit tool. Mirrors the chat agent's `emit_action` shape but:
 *  - records with `source: 'voice'`
 *  - runs per-action dedup against `room.actionHistory` + the tick-local
 *    Set BEFORE recording, so the model sees `{ok:false, reason:'duplicate'}`
 *    on a duplicate emit and can pivot (e.g. drop it, or switch to
 *    update_card)
 */
function buildVoiceEmitTool(room: Room, dedupSet: Set<string>) {
	return tool({
		description:
			'Apply one Action to the canvas. Pass a single Action object whose `type` is one of the documented action types. Call multiple times in a turn to emit multiple actions. Returns { ok, action, id, type } on success or { ok: false, error } on failure (invalid payload, invented id reference, duplicate).',
		inputSchema: z.object({
			action: z
				.unknown()
				.describe(
					'A single Action object — one of the documented action types (create_proposal_card / create_decision_card / create_commitment_card / create_blocker_card / create_question_card / create_note / create_geo / create_text / create_priority_matrix / create_budget_allocator / link_nodes / lock_decision / update_card / group_into_frame / delete_shapes / move_shape / resize_shape / set_shape_style / align_shapes / distribute_shapes / reorder_shapes / zoom_to_shapes / create_arrow).',
				),
		}),
		execute: async ({ action: raw }) => {
			const prepared = prepareAction(raw, room, 'voice')
			if (!prepared.ok) {
				return { ok: false as const, error: prepared.error }
			}
			const action = prepared.action
			const dup = dedupSingleAction(action, room, dedupSet)
			if (!dup.ok) {
				return {
					ok: false as const,
					error: dup.reason,
					...(dup.existingId ? { existingId: dup.existingId } : {}),
				}
			}
			try {
				room.recordAction(action, 'voice')
				room.broadcast({ kind: 'actions', actions: [action] })
				console.log(
					`[voice-agent] emitted ${action.type}${'id' in action ? ` ${action.id}` : ''}`,
				)
				return {
					ok: true as const,
					action,
					id: 'id' in action ? action.id : undefined,
					type: action.type,
				}
			} catch (err) {
				const message =
					err instanceof Error ? err.message : 'broadcast failed'
				console.error('[voice-agent] dispatch failed:', message)
				return { ok: false as const, error: message }
			}
		},
	})
}

/**
 * Single-action dedup gate for the voice ReAct emit path. Catches:
 *
 *  1. link_nodes duplicates — same (from,to,kind) tuple already in
 *     room.actionHistory OR in the tick-local dedupSet. The orchestrator's
 *     existing `filterDuplicateCreates` does this at batch-level but we
 *     need it per-emit here so the model can see the duplicate and react.
 *
 *  2. L3 widget duplicates — at most one matrix / budget / gantt per
 *     canvas. If one already exists, suggest the model emit update_card
 *     against the existing id instead.
 *
 *  3. Orphan link refs — link_nodes pointing at an id that doesn't exist
 *     on the canvas AND wasn't created earlier in the same tick. (The
 *     `validateActionRefs` step in prepareAction catches existing-canvas
 *     misses; this catches "the model is racing ahead and emitting links
 *     before it has emitted the targets".)
 *
 * Exported so the orchestrator test suite can lock the behavior in.
 */
export function dedupSingleAction(
	action: Action,
	room: Room,
	dedupSet: Set<string>,
):
	| { ok: true }
	| { ok: false; reason: string; existingId?: string } {
	if (action.type === 'link_nodes') {
		const key = `link::${action.from}::${action.to}::${action.kind}`
		if (dedupSet.has(key)) {
			return {
				ok: false,
				reason: `link_nodes ${action.from}→${action.to} (${action.kind}) already emitted in this tick — skip the duplicate`,
			}
		}
		for (const past of room.actionHistory) {
			if (
				past.type === 'link_nodes' &&
				past.from === action.from &&
				past.to === action.to &&
				past.kind === action.kind
			) {
				return {
					ok: false,
					reason: `link_nodes ${action.from}→${action.to} (${action.kind}) already exists on the canvas — no need to emit again`,
				}
			}
		}
		dedupSet.add(key)
		return { ok: true }
	}

	if (
		action.type === 'create_priority_matrix' ||
		action.type === 'create_budget_allocator' ||
		action.type === 'create_gantt'
	) {
		const tickKey = `widget::${action.type}`
		if (dedupSet.has(tickKey)) {
			return {
				ok: false,
				reason: `${action.type} already emitted in this tick — emit update_card on the existing widget instead`,
			}
		}
		for (const past of room.actionHistory) {
			if (past.type === action.type) {
				return {
					ok: false,
					reason: `${action.type} already exists on the canvas — emit update_card { id: "${past.id}", patch: {...} } to edit it instead of creating a second one`,
					existingId: past.id,
				}
			}
		}
		dedupSet.add(tickKey)
		return { ok: true }
	}

	// Track create ids so later actions in the same tick (e.g. a link
	// referencing a just-created box) can validate against the live tick
	// state, not only room.canvasShapes.
	if ('id' in action && typeof action.id === 'string') {
		dedupSet.add(`shape::${action.id}`)
	}
	return { ok: true }
}
