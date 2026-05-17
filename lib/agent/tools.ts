import { tool } from 'ai'
import { z } from 'zod'
import type { Action } from '@/lib/actions/schema'
import type { Room } from '@server/room'

/**
 * Shared agent tooling, factored out of `lib/agent/runner.ts` so the voice
 * orchestrator's MODE-B ReAct path can reuse the same read primitives the
 * chat agent already has. Anything *both* surfaces want lives here; anything
 * one surface owns alone (chat's `read_transcript_window`, voice's emit
 * tool with per-action dedup) stays in its own file.
 *
 * Both surfaces feed the same tldraw canvas, so the same observation tools
 * apply: list shapes, find by content / type, count links on a shape, read
 * the long-term memory.
 */

// --- L3 widget state reconstruction -----------------------------------------
// Walk action history from the start, materialising the LATEST state of an
// L3 widget by id. Starts from the initial create and folds every
// `update_card` whose `id` matches. Returns `null` if no create_… was found
// (i.e. the widget id doesn't exist on the canvas).
//
// This sidesteps a sharp edge in the agent flow: the prompt tells the model
// to emit `update_card { items: [...] }` to remove a single row, but
// `priority-matrix`'s tldraw shape props demand a FULL items array (each
// with id/label/impact/effort). Without seeing the original impact/effort
// numbers the model would have to invent them — both loses data and trips
// tldraw's runtime validator. Returning the full reconstructed state here
// lets the model filter the live list and emit a complete patch.

export type WidgetMatrixItems = Array<{
	id: string
	label: string
	[k: string]: unknown
}>
export type WidgetBudgetSplits = Array<{
	label: string
	amountPct: number
	[k: string]: unknown
}>
export type WidgetState =
	| { kind: 'priority_matrix'; items: WidgetMatrixItems }
	| { kind: 'gantt'; items: WidgetMatrixItems }
	| {
			kind: 'budget_allocator'
			total: number
			currency: string
			splits: WidgetBudgetSplits
	  }

export function isWidgetType(type: string): boolean {
	return (
		type === 'create_priority_matrix' ||
		type === 'create_budget_allocator' ||
		type === 'create_gantt'
	)
}

export function reconstructWidgetState(
	id: string,
	history: Action[],
): WidgetState | null {
	let state: WidgetState | null = null
	for (const a of history) {
		if (!('id' in a) || a.id !== id) continue
		if (a.type === 'create_priority_matrix') {
			state = { kind: 'priority_matrix', items: [...a.items] }
		} else if (a.type === 'create_gantt') {
			state = {
				kind: 'gantt',
				items: [
					...(a.items as unknown as Array<{
						id: string
						label: string
						[k: string]: unknown
					}>),
				],
			}
		} else if (a.type === 'create_budget_allocator') {
			state = {
				kind: 'budget_allocator',
				total: a.total,
				currency: a.currency ?? '%',
				splits: [...a.splits],
			}
		} else if (a.type === 'update_card' && state) {
			const patch = a.patch as Record<string, unknown> | undefined
			if (!patch) continue
			if (state.kind === 'priority_matrix' && Array.isArray(patch.items)) {
				state = {
					kind: 'priority_matrix',
					items: patch.items as WidgetMatrixItems,
				}
			} else if (state.kind === 'gantt' && Array.isArray(patch.items)) {
				state = { kind: 'gantt', items: patch.items as WidgetMatrixItems }
			} else if (state.kind === 'budget_allocator') {
				state = {
					kind: 'budget_allocator',
					total:
						typeof patch.total === 'number' ? patch.total : state.total,
					currency:
						typeof patch.currency === 'string'
							? patch.currency
							: state.currency,
					splits: Array.isArray(patch.splits)
						? (patch.splits as WidgetBudgetSplits)
						: state.splits,
				}
			}
		}
	}
	return state
}

// --- Read tool set ----------------------------------------------------------
//
// `buildReadTools(room)` returns the four observation tools both the chat
// and voice agents share. The chat agent adds `read_transcript_window` on
// top of these (it's a chat-specific affordance — voice IS the transcript
// channel, so feeding the transcript back to itself is redundant).

/**
 * Build the shared read-only tool set for both the chat agent and the voice
 * MODE-B agent. Each tool's `execute` closes over `room` so state queries
 * always see live data.
 *
 * Returned shape is `{ read_canvas, find_shapes, count_links, read_memory }`.
 */
export function buildReadTools(room: Room) {
	const readCanvas = tool({
		description:
			"Re-read the current canvas shapes (id, type, content summary). Use when you need to verify an id, find a shape by content, or confirm whether something already exists. Returns shapes in creation order; capped at 50 most-recent for very full canvases. For L3 widgets (priority_matrix / budget_allocator / gantt) the response ALSO carries the full reconstructed `widget` state (items array with impact/effort, or splits array with total/currency) so you can build a clean update_card patch without inventing data.",
		inputSchema: z.object({}),
		execute: async () => {
			const all = Array.from(room.canvasShapes.entries()).map(
				([id, v]) => {
					const base: {
						id: string
						type: string
						summary: string
						widget?: WidgetState
					} = { id, type: v.type, summary: v.summary }
					if (isWidgetType(v.type)) {
						const state = reconstructWidgetState(id, room.actionHistory)
						if (state) base.widget = state
					}
					return base
				},
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
			const out: Array<{
				id: string
				type: string
				summary: string
				widget?: WidgetState
			}> = []
			for (const [id, v] of room.canvasShapes.entries()) {
				if (type && v.type !== type) continue
				if (q && !v.summary.toLowerCase().includes(q)) continue
				const entry: {
					id: string
					type: string
					summary: string
					widget?: WidgetState
				} = { id, type: v.type, summary: v.summary }
				if (isWidgetType(v.type)) {
					const state = reconstructWidgetState(id, room.actionHistory)
					if (state) entry.widget = state
				}
				out.push(entry)
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

	return {
		read_canvas: readCanvas,
		find_shapes: findShapes,
		count_links: countLinks,
		read_memory: readMemory,
	}
}
