import { describe, expect, it } from 'vitest'
import { BroadcastThrottle } from '@/lib/agent/broadcast-throttle'

// Helper: returns a function that captures the ms-since-construction at
// each call. Used to assert relative timings without coupling to wall clock.
function makeStopwatch() {
	const t0 = Date.now()
	const marks: number[] = []
	return {
		mark() {
			marks.push(Date.now() - t0)
		},
		marks,
	}
}

describe('BroadcastThrottle', () => {
	it('releases the first caller immediately', async () => {
		const t = new BroadcastThrottle(100)
		const sw = makeStopwatch()
		await t.awaitTurn()
		sw.mark()
		// First caller takes the resolved chain head — should release in
		// well under one event-loop tick.
		expect(sw.marks[0]).toBeLessThan(20)
	})

	it('serializes 3 parallel callers with the configured gap', async () => {
		const t = new BroadcastThrottle(80)
		const sw = makeStopwatch()
		await Promise.all([
			t.awaitTurn().then(() => sw.mark()),
			t.awaitTurn().then(() => sw.mark()),
			t.awaitTurn().then(() => sw.mark()),
		])
		// Expected timings: ~0, ~80, ~160 (with setTimeout jitter).
		// Asserts BELOW upper bounds to catch missing serialization
		// (would all be near 0) and ABOVE lower bounds to catch
		// over-delay.
		const [a, b, c] = sw.marks
		expect(a).toBeLessThan(30)
		expect(b).toBeGreaterThanOrEqual(60)
		expect(b).toBeLessThan(150)
		expect(c).toBeGreaterThanOrEqual(140)
		expect(c).toBeLessThan(250)
	})

	it('preserves arrival order (FIFO)', async () => {
		// We tag each caller with an id and assert that the marks land
		// in the order awaitTurn() was first called.
		const t = new BroadcastThrottle(40)
		const order: number[] = []
		const a = t.awaitTurn().then(() => order.push(1))
		const b = t.awaitTurn().then(() => order.push(2))
		const c = t.awaitTurn().then(() => order.push(3))
		await Promise.all([a, b, c])
		expect(order).toEqual([1, 2, 3])
	})

	it('does not delay a caller arriving after a long idle gap', async () => {
		const t = new BroadcastThrottle(50)
		await t.awaitTurn()
		// Wait longer than the gap, then call again.
		await new Promise((r) => setTimeout(r, 80))
		const sw = makeStopwatch()
		await t.awaitTurn()
		sw.mark()
		// Second call should release ~immediately — chain head has long
		// since resolved.
		expect(sw.marks[0]).toBeLessThan(20)
	})

	it('is a no-op with gapMs=0 (parallel batch path)', async () => {
		const t = new BroadcastThrottle(0)
		const sw = makeStopwatch()
		await Promise.all([
			t.awaitTurn().then(() => sw.mark()),
			t.awaitTurn().then(() => sw.mark()),
			t.awaitTurn().then(() => sw.mark()),
		])
		// All three callers should release in the same microtask cluster
		// — under 20ms even on slow runners.
		for (const m of sw.marks) {
			expect(m).toBeLessThan(20)
		}
	})

	it('isolates separate throttle instances (one per turn)', async () => {
		// Two throttles serve two separate "turns". A long-running turn
		// on instance A must not affect a fresh turn on instance B.
		const a = new BroadcastThrottle(100)
		const b = new BroadcastThrottle(100)

		// Saturate A with three callers.
		const aPromises = [a.awaitTurn(), a.awaitTurn(), a.awaitTurn()]

		// Meanwhile, B's first caller should fire immediately.
		const sw = makeStopwatch()
		await b.awaitTurn()
		sw.mark()
		expect(sw.marks[0]).toBeLessThan(20)

		await Promise.all(aPromises) // drain A so the test exits cleanly
	})
})
