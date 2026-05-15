import { sql } from './client'

/*
 * Canvas memory record — see db/schema.sql canvas_memories for the full
 * rationale. In short: the canvas itself (canvas_actions + tldraw store)
 * is the structured memory; this record holds the COMPRESSED soft-signal
 * memory — prose narratives + cross-mode meta. Two threads (voice + chat)
 * because they have different cadences and tones; one shared_meta because
 * themes / tensions / followups are mode-agnostic.
 */

export interface VoiceThread {
	narrative: string
	key_moments: string[]
}

export interface ChatThread {
	narrative: string
	intents_pursued: string[]
}

export interface SharedMeta {
	open_tensions: string[]
	recurring_themes: string[]
	abandoned_paths: string[]
	pending_followups: string[]
}

export interface CanvasMemory {
	canvasId: string
	voiceThread: VoiceThread
	chatThread: ChatThread
	sharedMeta: SharedMeta
	voiceMsgsCovered: number
	chatMsgsCovered: number
	isSummarizing: boolean
}

const EMPTY_VOICE_THREAD: VoiceThread = { narrative: '', key_moments: [] }
const EMPTY_CHAT_THREAD: ChatThread = { narrative: '', intents_pursued: [] }
const EMPTY_SHARED_META: SharedMeta = {
	open_tensions: [],
	recurring_themes: [],
	abandoned_paths: [],
	pending_followups: [],
}

/**
 * Load this canvas's memory, lazily creating an empty row if one doesn't
 * exist. Read-on-write semantics so the caller never has to handle a
 * missing-row case — first hydrate of a brand-new canvas just gets all
 * empty defaults.
 */
export async function getOrCreateMemory(
	canvasId: string,
): Promise<CanvasMemory> {
	// INSERT … ON CONFLICT DO NOTHING then SELECT keeps this as one trip
	// to Postgres if the row exists. The defaults in the schema produce
	// the empty-state shape on first creation.
	await sql`
		INSERT INTO canvas_memories (canvas_id)
		VALUES (${canvasId}::uuid)
		ON CONFLICT (canvas_id) DO NOTHING
	`
	const rows = await sql<
		{
			canvas_id: string
			voice_thread: unknown
			chat_thread: unknown
			shared_meta: unknown
			voice_msgs_covered: number
			chat_msgs_covered: number
			is_summarizing: boolean
		}[]
	>`
		SELECT canvas_id, voice_thread, chat_thread, shared_meta,
		       voice_msgs_covered, chat_msgs_covered, is_summarizing
		FROM canvas_memories
		WHERE canvas_id = ${canvasId}::uuid
	`
	const r = rows[0]
	if (!r) {
		// Should be impossible after the INSERT above, but defensive
		// fallback returns an in-memory empty memory so callers can keep
		// going if the DB is flaky.
		return {
			canvasId,
			voiceThread: { ...EMPTY_VOICE_THREAD },
			chatThread: { ...EMPTY_CHAT_THREAD },
			sharedMeta: { ...EMPTY_SHARED_META },
			voiceMsgsCovered: 0,
			chatMsgsCovered: 0,
			isSummarizing: false,
		}
	}
	return {
		canvasId: r.canvas_id,
		voiceThread: { ...EMPTY_VOICE_THREAD, ...(r.voice_thread as object) },
		chatThread: { ...EMPTY_CHAT_THREAD, ...(r.chat_thread as object) },
		sharedMeta: { ...EMPTY_SHARED_META, ...(r.shared_meta as object) },
		voiceMsgsCovered: r.voice_msgs_covered ?? 0,
		chatMsgsCovered: r.chat_msgs_covered ?? 0,
		isSummarizing: r.is_summarizing,
	}
}

/**
 * Try to acquire the summarizer lock for this canvas. Returns true if
 * the lock was acquired (caller should run the summarizer); false if a
 * summarizer is already in flight (caller should skip).
 *
 * Atomic via Postgres UPDATE … WHERE is_summarizing = FALSE — two
 * parallel calls can't both flip the flag.
 */
export async function tryAcquireSummarizerLock(
	canvasId: string,
): Promise<boolean> {
	const rows = await sql<{ canvas_id: string }[]>`
		UPDATE canvas_memories
		SET is_summarizing = TRUE,
		    updated_at = NOW()
		WHERE canvas_id = ${canvasId}::uuid
		  AND is_summarizing = FALSE
		RETURNING canvas_id
	`
	return rows.length === 1
}

/**
 * Release the lock without changing the threads — used when the
 * summarizer call errors out and we want the next tick to retry.
 */
export async function releaseSummarizerLock(canvasId: string): Promise<void> {
	await sql`
		UPDATE canvas_memories
		SET is_summarizing = FALSE,
		    updated_at = NOW()
		WHERE canvas_id = ${canvasId}::uuid
	`
}

/**
 * Total count of voice-origin actions ever emitted for this canvas.
 * Used by Room to seed the in-memory counter on hydrate so threshold
 * math doesn't require a fresh COUNT each tick.
 */
export async function countVoiceActions(canvasId: string): Promise<number> {
	const rows = await sql<{ count: string }[]>`
		SELECT COUNT(*)::text AS count FROM canvas_actions
		WHERE canvas_id = ${canvasId}::uuid AND source = 'voice'
	`
	return Number(rows[0]?.count ?? 0)
}

/**
 * Total count of chat turns ever persisted for this canvas.
 */
export async function countChatTurns(canvasId: string): Promise<number> {
	const rows = await sql<{ count: string }[]>`
		SELECT COUNT(*)::text AS count FROM canvas_chat_turns
		WHERE canvas_id = ${canvasId}::uuid
	`
	return Number(rows[0]?.count ?? 0)
}

/**
 * Fetch a window of voice-origin actions in chronological order, used by
 * the summarizer to pull the "next 50 to age out" batch. `offset` is the
 * caller's `voice_msgs_covered`; `limit` is how many to age out (usually
 * 50). Returns actions as their stored JSONB shape.
 */
export async function fetchVoiceActionsWindow(args: {
	canvasId: string
	offset: number
	limit: number
}): Promise<unknown[]> {
	const rows = await sql<{ action: unknown }[]>`
		SELECT action FROM canvas_actions
		WHERE canvas_id = ${args.canvasId}::uuid AND source = 'voice'
		ORDER BY seq ASC
		OFFSET ${args.offset}
		LIMIT ${args.limit}
	`
	return rows.map((r) => r.action)
}

/**
 * Fetch a window of chat turns in chronological order — counterpart to
 * fetchVoiceActionsWindow for the chat path.
 */
export async function fetchChatTurnsWindow(args: {
	canvasId: string
	offset: number
	limit: number
}): Promise<Array<{ role: 'user' | 'assistant'; text: string }>> {
	const rows = await sql<
		{ role: 'user' | 'assistant'; text: string }[]
	>`
		SELECT role, text FROM canvas_chat_turns
		WHERE canvas_id = ${args.canvasId}::uuid
		ORDER BY seq ASC
		OFFSET ${args.offset}
		LIMIT ${args.limit}
	`
	return rows
}

/**
 * Persist a successful summarizer result and release the lock atomically.
 *
 * `kind` selects which thread + cursor gets updated; shared_meta is
 * always rewritten (it's cross-mode). The cursor tells the next prompt
 * "summary covers up to message N" so it can label recent raw entries
 * with their position.
 */
export async function commitSummary(args: {
	canvasId: string
	kind: 'voice' | 'chat'
	thread: VoiceThread | ChatThread
	sharedMeta: SharedMeta
	msgsCoveredAfter: number
}): Promise<void> {
	const { canvasId, kind, thread, sharedMeta, msgsCoveredAfter } = args
	if (kind === 'voice') {
		await sql`
			UPDATE canvas_memories
			SET voice_thread       = ${sql.json(thread as never)},
			    shared_meta        = ${sql.json(sharedMeta as never)},
			    voice_msgs_covered = ${msgsCoveredAfter},
			    is_summarizing     = FALSE,
			    updated_at         = NOW()
			WHERE canvas_id = ${canvasId}::uuid
		`
	} else {
		await sql`
			UPDATE canvas_memories
			SET chat_thread       = ${sql.json(thread as never)},
			    shared_meta       = ${sql.json(sharedMeta as never)},
			    chat_msgs_covered = ${msgsCoveredAfter},
			    is_summarizing    = FALSE,
			    updated_at        = NOW()
			WHERE canvas_id = ${canvasId}::uuid
		`
	}
}
