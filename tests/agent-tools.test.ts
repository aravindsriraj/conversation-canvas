import { describe, expect, it, vi } from 'vitest'
import { buildTools } from '@/lib/agent/runner'
import type { Action } from '@/lib/actions/schema'
import type { Room } from '@server/room'

// Minimal stub for `ToolExecutionOptions` — our read-tool execute closures
// never read this argument, but the SDK signature still requires it.
const STUB_OPTS = {
	toolCallId: 'test-call',
	messages: [],
} as never

// The SDK's `ToolExecuteFunction` is typed as
// `AsyncIterable<OUTPUT> | PromiseLike<OUTPUT> | OUTPUT`. Our concrete
// tools always return a Promise; this helper narrows the union once at
// the call site so each test can work in the concrete return type without
// peppering casts everywhere.
async function callTool<T>(
	// biome-ignore lint/suspicious/noExplicitAny: bridge between the SDK's broad return-type union and our concrete shapes
	tool: { execute?: (input: any, options: typeof STUB_OPTS) => any },
	input: unknown,
): Promise<T> {
	if (!tool.execute) throw new Error('tool has no execute fn')
	return (await tool.execute(input, STUB_OPTS)) as T
}

// Output type aliases so each `callTool<T>(...)` call documents what shape
// we expect back. Kept inline so the test file is self-contained — these
// shapes are intentionally a subset of what the runner produces.
type ReadCanvasOut = {
	count: number
	truncated: boolean
	shapes: { id: string; type: string; summary: string }[]
}
type FindShapesOut = {
	count: number
	matches: { id: string; type: string; summary: string }[]
}
type CountLinksOut = {
	id: string
	incoming: number
	outgoing: number
	total: number
	neighbors: {
		incoming: { from: string; kind: string }[]
		outgoing: { to: string; kind: string }[]
	}
}
type ReadMemoryOut =
	| { empty: true; note: string }
	| {
			empty: false
			voiceThread: { narrative: string; key_moments: string[] }
			chatThread: { narrative: string; intents_pursued: string[] }
			sharedMeta: {
				open_tensions: string[]
				recurring_themes: string[]
				abandoned_paths: string[]
				pending_followups: string[]
			}
			coverage: { voiceMsgsCovered: number; chatMsgsCovered: number }
	  }
type ReadTranscriptOut = {
	count: number
	segments: { speaker: string; text: string; ts: number }[]
}
type EmitActionOut =
	| { ok: true; action: Action; id: string | undefined; type: string }
	| { ok: false; error: string }

// Minimal Room stub — fills only the surfaces the read tools touch and the
// two writer-tool side-effect methods (`recordAction` / `broadcast`).
function makeRoomStub(
	overrides: Partial<{
		canvasShapes: Map<string, { type: string; summary: string }>
		actionHistory: Action[]
		memory: Room['memory']
		bufferSegments: { speaker: string; text: string; isFinal: true; ts: number }[]
	}> = {},
): Room {
	const bufferSegments = overrides.bufferSegments ?? []
	return {
		id: 'test-room',
		canvasShapes:
			overrides.canvasShapes ??
			new Map<string, { type: string; summary: string }>(),
		actionHistory: overrides.actionHistory ?? [],
		memory: overrides.memory ?? null,
		buffer: {
			window: () => bufferSegments,
		},
		recordAction: vi.fn(),
		broadcast: vi.fn(),
	} as unknown as Room
}

describe('agent buildTools()', () => {
	describe('read_canvas', () => {
		it('returns all shapes in insertion order when below the 50 cap', async () => {
			const canvasShapes = new Map([
				['p1', { type: 'create_proposal_card', summary: 'A: Lisbon Q3' }],
				['d1', { type: 'create_decision_card', summary: 'D: Hire two PMs' }],
			])
			const room = makeRoomStub({ canvasShapes })
			const tools = buildTools(room)
			const out = await callTool<ReadCanvasOut>(tools.read_canvas, {})
			expect(out.count).toBe(2)
			expect(out.truncated).toBe(false)
			expect(out.shapes.map((s) => s.id)).toEqual(['p1', 'd1'])
			expect(out.shapes[0].type).toBe('create_proposal_card')
		})

		it('truncates to the last 50 entries on a very full canvas', async () => {
			const canvasShapes = new Map<string, { type: string; summary: string }>()
			for (let i = 0; i < 60; i++) {
				canvasShapes.set(`s${i}`, {
					type: 'create_note',
					summary: `note ${i}`,
				})
			}
			const tools = buildTools(makeRoomStub({ canvasShapes }))
			const out = await callTool<ReadCanvasOut>(tools.read_canvas, {})
			expect(out.count).toBe(60)
			expect(out.truncated).toBe(true)
			expect(out.shapes).toHaveLength(50)
			expect(out.shapes[0].id).toBe('s10')
			expect(out.shapes.at(-1)?.id).toBe('s59')
		})

		it('returns an empty result on an empty canvas', async () => {
			const tools = buildTools(makeRoomStub())
			const out = await callTool<ReadCanvasOut>(tools.read_canvas, {})
			expect(out.count).toBe(0)
			expect(out.truncated).toBe(false)
			expect(out.shapes).toEqual([])
		})
	})

	describe('find_shapes', () => {
		const shapes = new Map([
			['p1', { type: 'create_proposal_card', summary: 'Q3 focus on Lisbon SMB' }],
			['p2', { type: 'create_proposal_card', summary: 'EU enterprise push' }],
			['d1', { type: 'create_decision_card', summary: 'Hire two PMs in Lisbon' }],
			['n1', { type: 'create_note', summary: 'red sticky: review next week' }],
		])

		it('filters by case-insensitive substring on summary', async () => {
			const tools = buildTools(makeRoomStub({ canvasShapes: shapes }))
			const out = await callTool<FindShapesOut>(tools.find_shapes, {
				query: 'LISBON',
			})
			expect(out.count).toBe(2)
			expect(out.matches.map((m) => m.id).sort()).toEqual(['d1', 'p1'])
		})

		it('filters by exact action type', async () => {
			const tools = buildTools(makeRoomStub({ canvasShapes: shapes }))
			const out = await callTool<FindShapesOut>(tools.find_shapes, {
				type: 'create_proposal_card',
			})
			expect(out.count).toBe(2)
			expect(out.matches.every((m) => m.type === 'create_proposal_card')).toBe(
				true,
			)
		})

		it('combines query + type filters', async () => {
			const tools = buildTools(makeRoomStub({ canvasShapes: shapes }))
			const out = await callTool<FindShapesOut>(tools.find_shapes, {
				query: 'lisbon',
				type: 'create_decision_card',
			})
			expect(out.count).toBe(1)
			expect(out.matches[0].id).toBe('d1')
		})

		it('honors the user-supplied limit', async () => {
			const tools = buildTools(makeRoomStub({ canvasShapes: shapes }))
			const out = await callTool<FindShapesOut>(tools.find_shapes, {
				query: '',
				limit: 2,
			})
			expect(out.matches).toHaveLength(2)
		})

		it('returns an empty match list when nothing fits', async () => {
			const tools = buildTools(makeRoomStub({ canvasShapes: shapes }))
			const out = await callTool<FindShapesOut>(tools.find_shapes, {
				query: 'nothing-matches',
			})
			expect(out.count).toBe(0)
			expect(out.matches).toEqual([])
		})
	})

	describe('count_links', () => {
		const actionHistory: Action[] = [
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'counters' },
			{ type: 'link_nodes', from: 'd1', to: 'p1', kind: 'decides' },
			{ type: 'link_nodes', from: 'p1', to: 'p3', kind: 'supports' },
			// Non-link action should be ignored.
			{
				type: 'create_note',
				id: 'n1',
				content: 'ignore me',
			},
		]

		it('returns incoming, outgoing, total counts + neighbor details', async () => {
			const tools = buildTools(makeRoomStub({ actionHistory }))
			const out = await callTool<CountLinksOut>(tools.count_links, {
				id: 'p1',
			})
			expect(out.id).toBe('p1')
			expect(out.incoming).toBe(1)
			expect(out.outgoing).toBe(2)
			expect(out.total).toBe(3)
			expect(out.neighbors.incoming).toEqual([
				{ from: 'd1', kind: 'decides' },
			])
			expect(out.neighbors.outgoing.map((n) => n.to).sort()).toEqual([
				'p2',
				'p3',
			])
		})

		it('returns zeros for a shape that has no links', async () => {
			const tools = buildTools(makeRoomStub({ actionHistory }))
			const out = await callTool<CountLinksOut>(tools.count_links, {
				id: 'never-linked',
			})
			expect(out.total).toBe(0)
			expect(out.neighbors.incoming).toEqual([])
			expect(out.neighbors.outgoing).toEqual([])
		})
	})

	describe('read_memory', () => {
		it('signals empty:true when room has no memory row yet', async () => {
			const tools = buildTools(makeRoomStub({ memory: null }))
			const out = await callTool<ReadMemoryOut>(tools.read_memory, {})
			expect(out.empty).toBe(true)
			if (out.empty) {
				expect(out.note).toMatch(/no long-term memory/)
			}
		})

		it('returns voice/chat/shared blocks + coverage when memory exists', async () => {
			const tools = buildTools(
				makeRoomStub({
					memory: {
						canvasId: 'c1',
						voiceThread: { narrative: 'V', key_moments: ['m1'] },
						chatThread: { narrative: 'C', intents_pursued: ['i1'] },
						sharedMeta: {
							open_tensions: ['t1'],
							recurring_themes: [],
							abandoned_paths: [],
							pending_followups: [],
						},
						voiceMsgsCovered: 12,
						chatMsgsCovered: 5,
						isSummarizing: false,
					},
				}),
			)
			const out = await callTool<ReadMemoryOut>(tools.read_memory, {})
			expect(out.empty).toBe(false)
			if (!out.empty) {
				expect(out.voiceThread.narrative).toBe('V')
				expect(out.chatThread.intents_pursued).toEqual(['i1'])
				expect(out.sharedMeta.open_tensions).toEqual(['t1'])
				expect(out.coverage).toEqual({
					voiceMsgsCovered: 12,
					chatMsgsCovered: 5,
				})
			}
		})
	})

	describe('read_transcript_window', () => {
		it('caps to the last `limit` segments', async () => {
			const segs = Array.from({ length: 30 }, (_, i) => ({
				speaker: 'S0',
				text: `seg ${i}`,
				isFinal: true as const,
				ts: 1000 + i * 100,
			}))
			const tools = buildTools(makeRoomStub({ bufferSegments: segs }))
			const out = await callTool<ReadTranscriptOut>(
				tools.read_transcript_window,
				{ limit: 5 },
			)
			expect(out.count).toBe(5)
			expect(out.segments.map((s) => s.text)).toEqual([
				'seg 25',
				'seg 26',
				'seg 27',
				'seg 28',
				'seg 29',
			])
		})

		it('defaults to 20 segments when no limit is supplied', async () => {
			const segs = Array.from({ length: 25 }, (_, i) => ({
				speaker: 'S0',
				text: `s${i}`,
				isFinal: true as const,
				ts: i,
			}))
			const tools = buildTools(makeRoomStub({ bufferSegments: segs }))
			const out = await callTool<ReadTranscriptOut>(
				tools.read_transcript_window,
				{},
			)
			expect(out.count).toBe(20)
			expect(out.segments[0].text).toBe('s5')
		})

		it('returns an empty array on a silent canvas', async () => {
			const tools = buildTools(makeRoomStub())
			const out = await callTool<ReadTranscriptOut>(
				tools.read_transcript_window,
				{},
			)
			expect(out.count).toBe(0)
			expect(out.segments).toEqual([])
		})
	})

	describe('emit_action', () => {
		it('returns ok:true + the validated action on a clean payload', async () => {
			const room = makeRoomStub()
			const tools = buildTools(room)
			const out = await callTool<EmitActionOut>(tools.emit_action, {
				action: {
					type: 'create_note',
					id: 'agent-n1',
					content: 'remember to follow up',
				},
			})
			expect(out.ok).toBe(true)
			if (out.ok) {
				expect(out.id).toBe('agent-n1')
				expect(out.type).toBe('create_note')
			}
			expect(room.recordAction).toHaveBeenCalledOnce()
			expect(room.broadcast).toHaveBeenCalledOnce()
		})

		it('returns ok:false with a readable error on schema failure', async () => {
			const room = makeRoomStub()
			const tools = buildTools(room)
			const out = await callTool<EmitActionOut>(tools.emit_action, {
				action: { type: 'create_unicorn', id: 'x' },
			})
			expect(out.ok).toBe(false)
			if (!out.ok) {
				expect(out.error).toMatch(/invalid action/)
			}
			expect(room.recordAction).not.toHaveBeenCalled()
		})

		it('normalizes a "create_blocker" alias before validation', async () => {
			const room = makeRoomStub()
			const tools = buildTools(room)
			const out = await callTool<EmitActionOut>(tools.emit_action, {
				action: {
					type: 'create_blocker',
					id: 'agent-b1',
					content: 'awaiting legal review',
				},
			})
			expect(out.ok).toBe(true)
			if (out.ok) expect(out.type).toBe('create_blocker_card')
		})
	})
})
