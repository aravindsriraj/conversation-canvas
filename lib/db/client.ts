// NOTE: This module is server-only. Never import it from a 'use client'
// file or any component bundled to the browser — it would leak the
// DATABASE_URL into the client. We deliberately don't import 'server-only'
// here so that off-build scripts (scripts/smoke-db.ts) can exercise the
// helpers directly; convention enforced by reviewers.
import postgres from 'postgres'

// Singleton postgres-js client. Cached on globalThis so Next's hot-reload
// (which re-evaluates module files on every dev edit) doesn't blow the
// Neon free-tier connection cap. `max: 5` matches Neon's recommendation for
// the pooled connection string; bump only if we observe pool exhaustion.
//
// Never log `process.env.DATABASE_URL` — it embeds the password. Same for
// the `sql` instance: `console.log(sql)` would print the connection URL.

declare global {
	// biome-ignore lint/style/noVar: globalThis augmentation requires var
	var __ccSql: ReturnType<typeof postgres> | undefined
}

function buildClient() {
	const url = process.env.DATABASE_URL
	if (!url) {
		throw new Error('DATABASE_URL is not set')
	}
	return postgres(url, {
		ssl: 'require',
		max: 5,
		// Neon's pooler closes idle connections aggressively; mirror that
		// here so we don't try to reuse a dead one.
		idle_timeout: 20,
		connect_timeout: 10,
	})
}

export const sql: ReturnType<typeof postgres> =
	globalThis.__ccSql ?? (globalThis.__ccSql = buildClient())
