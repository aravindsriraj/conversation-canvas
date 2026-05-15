-- Conversation Canvas — Postgres schema
--
-- Run via:  psql "$DATABASE_URL" -f db/schema.sql
-- (Idempotent: each statement uses IF NOT EXISTS / OR REPLACE.)

-- Users are owned by Clerk; we mirror the bits we need locally so we can
-- join without round-tripping Clerk's API on every render. The clerk_id is
-- the source of truth — display_name and color come from Clerk profile or
-- the user's first enrollment.
CREATE TABLE IF NOT EXISTS users (
	clerk_id      TEXT        PRIMARY KEY,
	display_name  TEXT        NOT NULL,
	color         TEXT        NOT NULL DEFAULT '#6366f1',
	created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A canvas is owned by exactly one user. The id is a uuid we hand back to
-- the URL — `/room/<id>`. Names are user-chosen and can collide across
-- users (it's just a label).
CREATE TABLE IF NOT EXISTS canvases (
	id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
	owner_id        TEXT        NOT NULL REFERENCES users(clerk_id) ON DELETE CASCADE,
	name            TEXT        NOT NULL,
	-- Serialized tldraw store. Whole-document snapshots so that manual edits
	-- (drag, delete, freehand annotation, in-place text edit) survive a reload —
	-- the action log only captures what the orchestrator emits.
	tldraw_snapshot JSONB,
	created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent migration for existing databases.
ALTER TABLE canvases ADD COLUMN IF NOT EXISTS tldraw_snapshot JSONB;

CREATE INDEX IF NOT EXISTS canvases_owner_id_idx ON canvases(owner_id);

-- Action history is the source of truth for canvas state. Whenever the
-- orchestrator broadcasts a typed Action, we append it here. On reconnect
-- the client replays everything in seq order.
--
-- Schema is intentionally JSONB rather than a normalized table per action
-- type because (a) the Zod schema in lib/actions/schema.ts is the contract
-- and we don't want to mirror it in SQL twice, (b) we never query inside
-- the action payload — we only replay it.
CREATE TABLE IF NOT EXISTS canvas_actions (
	id            BIGSERIAL   PRIMARY KEY,
	canvas_id     UUID        NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
	seq           INTEGER     NOT NULL,
	action        JSONB       NOT NULL,
	created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE (canvas_id, seq)
);

CREATE INDEX IF NOT EXISTS canvas_actions_canvas_seq_idx
	ON canvas_actions(canvas_id, seq);

-- Chat history for the Ask-AI panel. Same per-canvas append-only model as
-- canvas_actions — one row per user/assistant turn, ordered by seq.
--
-- Why persisted: the agent's `buildAgentContext` reads the last 8 turns
-- as conversation memory; without DB-backed storage, a dev-server restart
-- (or any room eviction we add later) wipes that memory and the next user
-- message lands with no recollection of what was just discussed. Same
-- two-track persistence philosophy as the rest of the canvas: live state
-- in memory, durable replay in Postgres.
--
-- `action_ids` is JSONB so we can store the list of Action.id values the
-- assistant emitted on that turn (used for "you asked X → I created p1, d2"
-- chat-history lineage in the LLM prompt).
CREATE TABLE IF NOT EXISTS canvas_chat_turns (
	id            BIGSERIAL   PRIMARY KEY,
	canvas_id     UUID        NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
	seq           INTEGER     NOT NULL,
	role          TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
	text          TEXT        NOT NULL,
	action_ids    JSONB       NOT NULL DEFAULT '[]'::jsonb,
	ts            BIGINT      NOT NULL,
	created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	UNIQUE (canvas_id, seq)
);

CREATE INDEX IF NOT EXISTS canvas_chat_turns_canvas_seq_idx
	ON canvas_chat_turns(canvas_id, seq);

-- Action provenance — track WHICH path emitted each action so the memory
-- summarizer can group "what was said in the meeting" (source='voice')
-- vs "what was asked via the chat panel" (source='chat'). Backfilled to
-- 'voice' on the assumption that pre-provenance rows were all from the
-- orchestrator (the chat agent shipped later in the session). Optional
-- (NULL allowed) so legacy code paths that haven't been updated yet
-- still work.
ALTER TABLE canvas_actions ADD COLUMN IF NOT EXISTS source TEXT;
UPDATE canvas_actions SET source = 'voice' WHERE source IS NULL;
ALTER TABLE canvas_actions ADD CONSTRAINT canvas_actions_source_check
	CHECK (source IS NULL OR source IN ('voice', 'chat')) NOT VALID;

-- Per-canvas memory record. ONE row per canvas; holds the rolling
-- summarized "what happened in this canvas so far" projection for both
-- the voice and chat paths. The buffer of recent raw messages lives in
-- canvas_actions / canvas_chat_turns (already persistent) — this table
-- only stores the *compressed* older history.
--
-- Why this design (vs duplicating decisions/commitments/etc here):
--   The canvas itself IS the structured memory — canvas_actions and the
--   live tldraw snapshot capture every decision, blocker, commitment,
--   etc. perfectly. What's MISSING from those structures is the soft
--   context: WHY a decision was reached, what lines of thought got
--   pursued and dropped, recurring themes, unresolved tensions,
--   implicit deferred follow-ups. That's what the threads hold.
--
-- Fields are JSONB so we can iterate the summary schema without DDL
-- migrations. The runtime always validates the structure with Zod
-- before reading.
CREATE TABLE IF NOT EXISTS canvas_memories (
	canvas_id           UUID         PRIMARY KEY REFERENCES canvases(id) ON DELETE CASCADE,

	-- Prose narrative + key-moment bullets for what was SAID in voice.
	voice_thread        JSONB        NOT NULL DEFAULT '{"narrative":"","key_moments":[]}'::jsonb,

	-- Same shape for what was ASKED via chat panel.
	chat_thread         JSONB        NOT NULL DEFAULT '{"narrative":"","intents_pursued":[]}'::jsonb,

	-- Shared meta — themes / tensions / abandoned / pending. Same shape
	-- across both threads since these are cross-mode observations.
	shared_meta         JSONB        NOT NULL DEFAULT '{"open_tensions":[],"recurring_themes":[],"abandoned_paths":[],"pending_followups":[]}'::jsonb,

	-- Cursors: how many voice ticks / chat turns the threads cover. The
	-- summarizer increments these atomically with the thread updates so
	-- the prompt can announce "summary covers up to msg N, raw is N+1.."
	voice_msgs_covered  INTEGER      NOT NULL DEFAULT 0,
	chat_msgs_covered   INTEGER      NOT NULL DEFAULT 0,

	-- Concurrency guard — set true when a summarizer call is in flight,
	-- cleared on success/error. Prevents two parallel ticks from
	-- racing each other's update.
	is_summarizing      BOOLEAN      NOT NULL DEFAULT FALSE,

	updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on any canvas row mutation.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
	NEW.updated_at = NOW();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS canvases_touch_updated_at ON canvases;
CREATE TRIGGER canvases_touch_updated_at
	BEFORE UPDATE ON canvases
	FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS users_touch_updated_at ON users;
CREATE TRIGGER users_touch_updated_at
	BEFORE UPDATE ON users
	FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
