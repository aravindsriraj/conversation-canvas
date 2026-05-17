import { sql } from './client'

// All helpers in this module enforce ownership via WHERE clauses — never trust
// a client-supplied owner_id without cross-checking against the Clerk session.
// The route handlers do that check; here we just thread it through.

export interface UserRow {
	clerk_id: string
	display_name: string
	color: string
	created_at: Date
	updated_at: Date
}

export interface CanvasRow {
	id: string
	owner_id: string
	name: string
	created_at: Date
	updated_at: Date
}

/**
 * `CanvasRow` + per-canvas activity tally, used by the dashboard list view to
 * render a tiny preview ("12 shapes · 3 decisions · 5 links") next to each
 * row without paying the cost of a full snapshot fetch.
 *
 * All counts are int-cast to JS `number` in SQL because postgres-js returns
 * `bigint` for `COUNT(*)` and our rows hand-off to JSON serialisation in the
 * Server Component.
 */
export interface CanvasRowWithStats extends CanvasRow {
	action_count: number
	proposals: number
	decisions: number
	notes: number
	links: number
}

/**
 * Upsert a user. Called on every authenticated request that needs a user row
 * to exist (e.g. first canvas create). Idempotent: subsequent calls with
 * different display_name/color won't overwrite — only the first one wins for
 * those fields, so a user's later profile updates from Clerk don't clobber
 * a color they may have explicitly chosen in our app.
 */
export async function ensureUser(
	clerkId: string,
	displayName: string,
	color: string,
): Promise<UserRow> {
	const rows = await sql<UserRow[]>`
		INSERT INTO users (clerk_id, display_name, color)
		VALUES (${clerkId}, ${displayName}, ${color})
		ON CONFLICT (clerk_id) DO UPDATE SET
			updated_at = NOW()
		RETURNING *
	`
	return rows[0]
}

export async function createCanvas(
	ownerId: string,
	name: string,
): Promise<CanvasRow> {
	const rows = await sql<CanvasRow[]>`
		INSERT INTO canvases (owner_id, name)
		VALUES (${ownerId}, ${name})
		RETURNING *
	`
	return rows[0]
}

export async function listCanvasesByOwner(
	ownerId: string,
): Promise<CanvasRowWithStats[]> {
	// LATERAL aggregation so each canvas is paired with its own per-type
	// tally in a single round-trip. COUNT(*) FILTER is the standard SQL way
	// to do conditional counts in one pass; cheaper than running multiple
	// scans of canvas_actions per canvas.
	//
	// `::int` casts: postgres-js maps SQL bigint to JS bigint (not number)
	// by default; we cast at the source so the row hits JS as a plain number
	// and round-trips through JSON without surprises.
	return sql<CanvasRowWithStats[]>`
		SELECT
			c.*,
			COALESCE(stats.total, 0)::int     AS action_count,
			COALESCE(stats.proposals, 0)::int AS proposals,
			COALESCE(stats.decisions, 0)::int AS decisions,
			COALESCE(stats.notes, 0)::int     AS notes,
			COALESCE(stats.links, 0)::int     AS links
		FROM canvases c
		LEFT JOIN LATERAL (
			SELECT
				COUNT(*)                                                            AS total,
				COUNT(*) FILTER (WHERE action->>'type' = 'create_proposal_card')    AS proposals,
				COUNT(*) FILTER (WHERE action->>'type' = 'create_decision_card')    AS decisions,
				COUNT(*) FILTER (WHERE action->>'type' = 'create_note')             AS notes,
				COUNT(*) FILTER (WHERE action->>'type' = 'link_nodes')              AS links
			FROM canvas_actions
			WHERE canvas_id = c.id
		) stats ON true
		WHERE c.owner_id = ${ownerId}
		ORDER BY c.updated_at DESC
	`
}

export async function getCanvas(id: string): Promise<CanvasRow | null> {
	const rows = await sql<CanvasRow[]>`
		SELECT * FROM canvases WHERE id = ${id}::uuid LIMIT 1
	`
	return rows[0] ?? null
}

/**
 * Returns the canvas only if it belongs to `ownerId`. Used as the single
 * authoritative authorization check for `/room/<id>` and the WS join handler.
 * Returns null on either "doesn't exist" OR "exists but owned by someone
 * else" — collapsing the two cases prevents enumeration of canvas IDs.
 */
export async function getCanvasIfOwned(
	id: string,
	ownerId: string,
): Promise<CanvasRow | null> {
	// UUID cast is wrapped in a try/catch because an invalid uuid string
	// (e.g. someone typing "demo" into the URL) makes postgres throw rather
	// than return no rows. We want to treat that as "not found".
	try {
		const rows = await sql<CanvasRow[]>`
			SELECT * FROM canvases
			WHERE id = ${id}::uuid AND owner_id = ${ownerId}
			LIMIT 1
		`
		return rows[0] ?? null
	} catch {
		return null
	}
}

export async function renameCanvas(
	id: string,
	ownerId: string,
	name: string,
): Promise<CanvasRow | null> {
	try {
		const rows = await sql<CanvasRow[]>`
			UPDATE canvases
			SET name = ${name}
			WHERE id = ${id}::uuid AND owner_id = ${ownerId}
			RETURNING *
		`
		return rows[0] ?? null
	} catch {
		return null
	}
}

export async function deleteCanvas(
	id: string,
	ownerId: string,
): Promise<boolean> {
	try {
		const rows = await sql<CanvasRow[]>`
			DELETE FROM canvases
			WHERE id = ${id}::uuid AND owner_id = ${ownerId}
			RETURNING id
		`
		return rows.length > 0
	} catch {
		return false
	}
}

/**
 * Fetch the serialized tldraw store for a canvas, after ownership check.
 * Returns the `document` part of `getSnapshot()` — `null` when the canvas
 * hasn't been snapshotted yet (fresh canvas).
 */
export async function getSnapshot(
	id: string,
	ownerId: string,
): Promise<unknown | null> {
	try {
		const rows = await sql<{ tldraw_snapshot: unknown | null }[]>`
			SELECT tldraw_snapshot FROM canvases
			WHERE id = ${id}::uuid AND owner_id = ${ownerId}
			LIMIT 1
		`
		return rows[0]?.tldraw_snapshot ?? null
	} catch {
		return null
	}
}

/**
 * Persist the serialized tldraw `document` snapshot. Updates `updated_at`
 * implicitly via the canvases_touch_updated_at trigger so the dashboard
 * "last modified" timestamp reflects real activity (not just renames).
 *
 * Returns true on success, false if the canvas doesn't exist or isn't owned
 * by `ownerId`.
 */
export async function saveSnapshot(
	id: string,
	ownerId: string,
	document: unknown,
): Promise<boolean> {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: postgres-js JSONValue type is overly strict; document is a Zod-validated serializable object
		const rows = await sql<{ id: string }[]>`
			UPDATE canvases
			SET tldraw_snapshot = ${sql.json(document as any)}
			WHERE id = ${id}::uuid AND owner_id = ${ownerId}
			RETURNING id
		`
		return rows.length > 0
	} catch (err) {
		console.error('[db] saveSnapshot failed:', (err as Error).message)
		return false
	}
}
