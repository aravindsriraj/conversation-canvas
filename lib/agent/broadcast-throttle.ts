/**
 * Per-turn broadcast serializer.
 *
 * Why: both ToolLoopAgents (chat + voice MODE-B) can emit several
 * `emit_action` tool calls in PARALLEL within a single step — that's how
 * the SDK runs concurrent tool calls. Without serialization, all those
 * `execute()` promises resolve nearly simultaneously, all broadcasts go
 * out within microseconds of each other, and the WS client sees a
 * "burst dump" rather than shapes appearing one at a time.
 *
 * What this is: a tiny FIFO scheduler. Each caller takes its turn off
 * the chain; the chain advances by `gapMs` per release. Whether the
 * callers arrive in parallel or sequentially, they're released in
 * arrival order, with a fixed gap between consecutive releases.
 *
 * What this is NOT: a global rate limiter. Each turn (chat) or tick
 * (voice MODE-B) gets its own fresh throttle instance — turns don't
 * interfere with each other. If 120ms has already elapsed since the
 * previous caller, the next call resolves immediately; there's no
 * artificial waiting on a quiet stream.
 *
 * Implementation: a promise chain. The trick is that
 * `chain.then(() => sleep(gap))` produces a new promise that resolves
 * `gap` ms after the previous chain element. Each caller receives the
 * CURRENT chain head and atomically appends a new sleep to the tail.
 *
 * Correctness sketch:
 *   t=0   caller A: head = resolved(P0). new chain = P0.then(sleep g).
 *                   A receives P0 → resolves immediately. A broadcasts.
 *   t=10  caller B: head = (resolves at g). new chain = (g).then(sleep g).
 *                   B receives (resolves at g) → wakes at t=g.
 *   t=20  caller C: head = (resolves at 2g). C wakes at t=2g.
 *
 * Yields broadcast cadence: A at 0, B at g, C at 2g — exactly the
 * staggered appearance the user wants to see.
 */
export class BroadcastThrottle {
	private chain: Promise<void> = Promise.resolve()

	/**
	 * @param gapMs Minimum delay between consecutive broadcasts. Pick a
	 * value visible to the eye but not artificial: 80-200ms is the
	 * sweet spot. Pass 0 to disable (useful for tests).
	 */
	constructor(private readonly gapMs: number = 120) {}

	/**
	 * Reserve this caller's turn. Resolves immediately for the first
	 * caller (or after a long idle gap); subsequent parallel callers
	 * resolve `gapMs` apart in arrival order.
	 */
	awaitTurn(): Promise<void> {
		const wait = this.chain
		this.chain =
			this.gapMs > 0
				? wait.then(
						() => new Promise((resolve) => setTimeout(resolve, this.gapMs)),
					)
				: wait
		return wait
	}
}
