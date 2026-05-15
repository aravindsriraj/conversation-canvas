import type { ChatTurn } from '@server/room'
import { sql } from './client'

/**
 * Append one chat turn (user OR assistant) for this canvas. Returns the
 * assigned per-canvas seq.
 *
 * Race-safe the same way `appendAction` is — Postgres advisory lock keyed
 * on canvas_id serializes concurrent appends to the same canvas. Different
 * canvases never block each other.
 *
 * We tolerate `text` being empty (e.g. an assistant turn where the model
 * emitted only actions and no chat reply) by storing the empty string;
 * `listChatTurns` returns it unchanged. The LLM context builder filters
 * its display, not the storage.
 */
export async function appendChatTurn(
	canvasId: string,
	turn: ChatTurn,
): Promise<number> {
	return sql.begin(async (tx) => {
		await tx`
			SELECT pg_advisory_xact_lock(hashtext(${`chat:${canvasId}`})::bigint)
		`
		const rows = await tx<{ next_seq: number }[]>`
			SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
			FROM canvas_chat_turns
			WHERE canvas_id = ${canvasId}::uuid
		`
		const nextSeq = rows[0]?.next_seq ?? 1
		await tx`
			INSERT INTO canvas_chat_turns (canvas_id, seq, role, text, action_ids, ts)
			VALUES (
				${canvasId}::uuid,
				${nextSeq},
				${turn.role},
				${turn.text},
				${sql.json((turn.actionIds ?? []) as unknown as never)},
				${turn.ts}
			)
		`
		return nextSeq
	}) as Promise<number>
}

/**
 * Load this canvas's chat history in seq order (oldest → newest).
 *
 * Capped at `limit` (default 40 — matches the in-memory cap in Room) so a
 * runaway canvas with thousands of turns doesn't bloat the hydration step.
 * The LLM context builder slices the last 8 from this anyway, but we keep
 * the extra so the chat panel UI can render a longer scrollback.
 *
 * Errors return `[]` rather than throw — we prefer a clean empty panel to
 * a 500 on every page load if the DB hiccups.
 */
export async function listChatTurns(
	canvasId: string,
	limit = 40,
): Promise<ChatTurn[]> {
	try {
		// We want the LAST N turns in seq order. Postgres returns them in
		// descending seq with LIMIT N, then we reverse client-side. (A
		// subquery with ORDER BY DESC + outer ORDER BY ASC would do the same
		// thing server-side, but this is one row trip either way.)
		const rows = await sql<
			{
				role: 'user' | 'assistant'
				text: string
				action_ids: string[] | null
				ts: string | number | bigint
			}[]
		>`
			SELECT role, text, action_ids, ts
			FROM canvas_chat_turns
			WHERE canvas_id = ${canvasId}::uuid
			ORDER BY seq DESC
			LIMIT ${limit}
		`
		// postgres-js returns BIGINT as either number or bigint depending on
		// driver flags; we coerce to number for the JS-side ChatTurn shape.
		return rows
			.map((r) => ({
				role: r.role,
				text: r.text,
				actionIds: Array.isArray(r.action_ids) ? r.action_ids : undefined,
				ts: typeof r.ts === 'bigint' ? Number(r.ts) : Number(r.ts),
			}))
			.reverse()
	} catch (err) {
		console.error(`[db/chat] listChatTurns failed:`, err)
		return []
	}
}
