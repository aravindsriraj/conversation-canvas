import type { Action } from '@/lib/actions/schema'
import { sql } from './client'

export interface CanvasActionRow {
	id: number
	canvas_id: string
	seq: number
	action: Action
	created_at: Date
}

/**
 * Append a typed Action to a canvas's history. Returns the assigned seq.
 *
 * Race-safe via a Postgres advisory lock keyed on canvas_id. The earlier
 * "wrap SELECT+INSERT in a transaction" trick was NOT sufficient — the
 * default READ COMMITTED isolation lets two concurrent transactions both
 * read MAX(seq)=N and both compute N+1; the loser then trips the UNIQUE
 * (canvas_id, seq) constraint. We observed this in practice when the agent
 * emits 3 actions in a single turn.
 *
 * `pg_advisory_xact_lock(bigint)` queues waiters and is auto-released at
 * commit/rollback. The lock key is `hashtext(canvas_id)` so different
 * canvases never block each other.
 */
export async function appendAction(
	canvasId: string,
	action: Action,
	source: 'voice' | 'chat' = 'voice',
): Promise<number> {
	return sql.begin(async (tx) => {
		// Serialize concurrent appends to the SAME canvas. Cast hashtext's
		// int4 → int8 because pg_advisory_xact_lock(bigint) is the form
		// that doesn't conflict with the (int, int) two-key variant.
		await tx`
			SELECT pg_advisory_xact_lock(hashtext(${canvasId})::bigint)
		`
		const rows = await tx<{ next_seq: number }[]>`
			SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
			FROM canvas_actions
			WHERE canvas_id = ${canvasId}::uuid
		`
		const nextSeq = rows[0]?.next_seq ?? 1
		// `sql.json` takes postgres-js's recursive JSONValue. Our Action union
		// has wide `z.any()` fields (the bespoke widget spec), so TS can't prove
		// the value is JSON-safe — but at runtime it's a plain Zod-validated
		// object that JSON.stringify round-trips cleanly. The biome ignore is
		// scoped to the `as` cast for documentation.
		// biome-ignore lint/suspicious/noExplicitAny: postgres-js JSONValue is too narrow for our Action union; see comment above
		await tx`
			INSERT INTO canvas_actions (canvas_id, seq, action, source)
			VALUES (${canvasId}::uuid, ${nextSeq}, ${sql.json(action as any)}, ${source})
		`
		return nextSeq
	}) as Promise<number>
}

/**
 * Replay-ordered action history for a canvas. Used on WS `join` to bring a
 * reconnecting (or fresh) client up to the current canvas state.
 */
export async function listActions(canvasId: string): Promise<Action[]> {
	try {
		const rows = await sql<CanvasActionRow[]>`
			SELECT action FROM canvas_actions
			WHERE canvas_id = ${canvasId}::uuid
			ORDER BY seq ASC
		`
		return rows.map((r) => r.action)
	} catch {
		return []
	}
}
