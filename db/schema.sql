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
