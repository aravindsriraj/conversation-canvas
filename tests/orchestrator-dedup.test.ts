import { describe, expect, it } from 'vitest'
import { filterDuplicateCreates } from '@/lib/orchestrator/loop'
import type { Action } from '@/lib/actions/schema'
import type { Room } from '@server/room'

// Minimal Room stub — filterDuplicateCreates only reads `actionHistory`, so
// we don't need to spin up the full class. Cast keeps the types honest at
// the call site without dragging in WS/buffer/db plumbing.
function roomFromHistory(actionHistory: Action[]): Room {
	return { actionHistory } as unknown as Room
}

describe('filterDuplicateCreates — link_nodes dedup (Pass 1 E)', () => {
	it('drops a link_nodes that matches a past (from, to, kind) tuple', () => {
		const past: Action[] = [
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'counters' },
		]
		const tick: Action[] = [
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'counters' },
		]
		const out = filterDuplicateCreates(tick, roomFromHistory(past))
		expect(out).toEqual([])
	})

	it('keeps a link with the same endpoints but a different kind', () => {
		const past: Action[] = [
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'counters' },
		]
		const tick: Action[] = [
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'supports' },
		]
		const out = filterDuplicateCreates(tick, roomFromHistory(past))
		expect(out).toEqual(tick)
	})

	it('treats (from→to) as DIRECTED — a→b is not the same as b→a', () => {
		const past: Action[] = [
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'supports' },
		]
		const tick: Action[] = [
			{ type: 'link_nodes', from: 'p2', to: 'p1', kind: 'supports' },
		]
		const out = filterDuplicateCreates(tick, roomFromHistory(past))
		// Reverse direction → not a dupe, keep it.
		expect(out).toEqual(tick)
	})

	it('dedupes a link emitted twice within the SAME tick', () => {
		const tick: Action[] = [
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'depends_on' },
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'depends_on' },
		]
		const out = filterDuplicateCreates(tick, roomFromHistory([]))
		expect(out).toHaveLength(1)
		expect(out[0]).toEqual(tick[0])
	})

	it('keeps a link_nodes that has no prior or local duplicate', () => {
		const past: Action[] = [
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'counters' },
		]
		const tick: Action[] = [
			{ type: 'link_nodes', from: 'p3', to: 'p4', kind: 'depends_on' },
		]
		const out = filterDuplicateCreates(tick, roomFromHistory(past))
		expect(out).toEqual(tick)
	})
})
