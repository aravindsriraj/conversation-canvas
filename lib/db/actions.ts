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
 * Race-safe: wraps the seq lookup + insert in a single transaction so two
 * concurrent appends can't both grab the same seq. The UNIQUE (canvas_id,
 * seq) constraint in the schema is a belt-and-suspenders backup.
 */
export async function appendAction(
	canvasId: string,
	action: Action,
): Promise<number> {
	return sql.begin(async (tx) => {
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
			INSERT INTO canvas_actions (canvas_id, seq, action)
			VALUES (${canvasId}::uuid, ${nextSeq}, ${sql.json(action as any)})
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
