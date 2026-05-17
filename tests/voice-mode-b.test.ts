import { describe, expect, it } from 'vitest'
import { dedupSingleAction } from '@/lib/orchestrator/voice-agent'
import { buildClassifierUserPrompt } from '@/lib/orchestrator/classifier'
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

// --- Classifier prompt shape ------------------------------------------------
// We don't unit-test the LLM classifier call itself (that's an integration
// concern — verified via dev-server smoke testing). We do lock down the
// shape of the prompt that gets sent to the model, so a future refactor
// can't accidentally change what the classifier sees.

describe('buildClassifierUserPrompt', () => {
	it('quotes the most recent transcript text', () => {
		const text = buildClassifierUserPrompt([
			seg('Draw a flowchart with three boxes and arrows.'),
		])
		expect(text).toMatch(/Most-recent voice transcript:/)
		expect(text).toMatch(
			/"Draw a flowchart with three boxes and arrows\."/,
		)
	})

	it('uses only the last 3 segments (older context is in action history)', () => {
		const text = buildClassifierUserPrompt([
			seg('one', 1000),
			seg('two', 2000),
			seg('three', 3000),
			seg('four', 4000),
			seg('five', 5000),
		])
		// We slice the tail-3; "one" and "two" should NOT appear in the prompt.
		expect(text).not.toContain('one')
		expect(text).not.toContain('two')
		expect(text).toContain('three four five')
	})

	it('handles an empty transcript', () => {
		const text = buildClassifierUserPrompt([])
		expect(text).toMatch(/Most-recent voice transcript:\n""$/)
	})
})

// --- dedupSingleAction ------------------------------------------------------
// The per-action dedup gate inside the voice ReAct emit tool. This logic is
// unchanged from before the classifier refactor; tests carry over directly.

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
