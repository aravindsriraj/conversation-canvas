import { describe, expect, it, vi } from 'vitest'
import { isModeBCommand } from '@/lib/orchestrator/loop'
import { dedupSingleAction } from '@/lib/orchestrator/voice-agent'
import type { Action } from '@/lib/actions/schema'
import type { Room } from '@server/room'
import type { TranscriptSegment } from '@/lib/speechmatics/client'

// --- Test helpers -----------------------------------------------------------

function seg(text: string, ts = 1000, speaker = 'S0'): TranscriptSegment {
	return { speaker, text, isFinal: true, ts }
}

function roomFromHistory(actionHistory: Action[]): Room {
	return { actionHistory } as unknown as Room
}

// --- Classifier -------------------------------------------------------------

describe('isModeBCommand — voice MODE-B classifier', () => {
	it('matches "draw a flowchart with arrows"', () => {
		expect(
			isModeBCommand([seg('Can you draw a flowchart with three boxes and arrows?')]),
		).toBe(true)
	})

	it('matches "rank these by impact and effort"', () => {
		expect(
			isModeBCommand([seg('Rank these proposals by impact and effort.')]),
		).toBe(true)
	})

	it('matches "delete the blocker"', () => {
		expect(isModeBCommand([seg('Delete the blocker card about hiring.')])).toBe(
			true,
		)
	})

	it('matches "align all the proposals to the left"', () => {
		expect(
			isModeBCommand([seg('Align all the proposal cards to the left.')]),
		).toBe(true)
	})

	it('matches "add a yellow sticky"', () => {
		expect(isModeBCommand([seg('Add a yellow sticky note for next week.')])).toBe(
			true,
		)
	})

	it('matches compound hint "with arrows" even without a verb noun pair', () => {
		expect(
			isModeBCommand([seg('Three steps connecting them with arrows.')]),
		).toBe(true)
	})

	it('does NOT match passive conversation', () => {
		expect(
			isModeBCommand([
				seg('I think we should focus on enterprise customers in Q3.'),
				seg("That's a strong argument."),
			]),
		).toBe(false)
	})

	it('does NOT match a proposal statement', () => {
		expect(
			isModeBCommand([seg('Let me propose we hire two engineers next quarter.')]),
		).toBe(false)
	})

	it('does NOT match a question-card style utterance', () => {
		expect(
			isModeBCommand([seg('How are we tracking against the Q3 commit?')]),
		).toBe(false)
	})

	it('returns false on an empty transcript window', () => {
		expect(isModeBCommand([])).toBe(false)
	})

	it('classifies based on the MOST-RECENT utterance, not stale ones', () => {
		// First utterance was a command — but it was 60s ago. The classifier
		// should look at the recent tail, not the full window.
		const old = seg('Draw me a flowchart with arrows.', 1000)
		const recentChat = [
			seg("Actually let's think about this differently.", 60_000),
			seg("Pricing is the real issue here.", 62_000),
			seg("Anyway the engineering budget is fine.", 64_000),
		]
		expect(isModeBCommand([old, ...recentChat])).toBe(false)
	})
})

// --- dedupSingleAction ------------------------------------------------------

describe('dedupSingleAction — voice MODE-B per-action dedup', () => {
	it('passes a fresh link_nodes through', () => {
		const dedup = new Set<string>()
		const result = dedupSingleAction(
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'counters' },
			roomFromHistory([]),
			dedup,
		)
		expect(result.ok).toBe(true)
	})

	it('rejects a duplicate link_nodes in the same tick', () => {
		const dedup = new Set<string>()
		const action: Action = {
			type: 'link_nodes',
			from: 'p1',
			to: 'p2',
			kind: 'counters',
		}
		const first = dedupSingleAction(action, roomFromHistory([]), dedup)
		expect(first.ok).toBe(true)
		const second = dedupSingleAction(action, roomFromHistory([]), dedup)
		expect(second.ok).toBe(false)
		if (!second.ok) {
			expect(second.reason).toMatch(/already emitted in this tick/)
		}
	})

	it('rejects a link_nodes that already exists in actionHistory', () => {
		const past: Action[] = [
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'supports' },
		]
		const result = dedupSingleAction(
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'supports' },
			roomFromHistory(past),
			new Set<string>(),
		)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.reason).toMatch(/already exists on the canvas/)
		}
	})

	it('passes a reverse-direction link as distinct', () => {
		const past: Action[] = [
			{ type: 'link_nodes', from: 'p1', to: 'p2', kind: 'supports' },
		]
		const result = dedupSingleAction(
			{ type: 'link_nodes', from: 'p2', to: 'p1', kind: 'supports' },
			roomFromHistory(past),
			new Set<string>(),
		)
		expect(result.ok).toBe(true)
	})

	it('rejects a second create_priority_matrix in the same tick', () => {
		const dedup = new Set<string>()
		const first = dedupSingleAction(
			{ type: 'create_priority_matrix', id: 'm1', items: [] },
			roomFromHistory([]),
			dedup,
		)
		expect(first.ok).toBe(true)
		const second = dedupSingleAction(
			{ type: 'create_priority_matrix', id: 'm2', items: [] },
			roomFromHistory([]),
			dedup,
		)
		expect(second.ok).toBe(false)
		if (!second.ok) {
			expect(second.reason).toMatch(/already emitted/)
		}
	})

	it('rejects a create_priority_matrix when one is already on the canvas, and surfaces existingId', () => {
		const past: Action[] = [
			{ type: 'create_priority_matrix', id: 'm-existing', items: [] },
		]
		const result = dedupSingleAction(
			{ type: 'create_priority_matrix', id: 'm-new', items: [] },
			roomFromHistory(past),
			new Set<string>(),
		)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.reason).toMatch(/update_card/)
			expect(result.existingId).toBe('m-existing')
		}
	})

	it('passes a create_budget_allocator through when none exists, then rejects the second', () => {
		const dedup = new Set<string>()
		const first = dedupSingleAction(
			{
				type: 'create_budget_allocator',
				id: 'ba1',
				total: 100,
				currency: '%',
				splits: [],
			},
			roomFromHistory([]),
			dedup,
		)
		expect(first.ok).toBe(true)
		const second = dedupSingleAction(
			{
				type: 'create_budget_allocator',
				id: 'ba2',
				total: 200,
				currency: '%',
				splits: [],
			},
			roomFromHistory([]),
			dedup,
		)
		expect(second.ok).toBe(false)
	})

	it('passes a plain create_note through unaffected', () => {
		const result = dedupSingleAction(
			{ type: 'create_note', id: 'n1', content: 'sticky' },
			roomFromHistory([]),
			new Set<string>(),
		)
		expect(result.ok).toBe(true)
	})
})
