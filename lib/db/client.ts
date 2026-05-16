// NOTE: This module is server-only. Never import it from a 'use client'
// file or any component bundled to the browser — it would leak the
// DATABASE_URL into the client. We deliberately don't import 'server-only'
// here so that off-build scripts (scripts/smoke-db.ts) can exercise the
// helpers directly; convention enforced by reviewers.
import { setDefaultResultOrder } from 'node:dns'
import postgres from 'postgres'

// Neon's DNS returns BOTH IPv4 and IPv6 records. Node's default DNS resolve
// order on linux is "verbatim" which means it tries IPv6 first if AAAA
// records came back ahead of A records. Our Vultr VM has no IPv6
// connectivity, so every IPv6 attempt instantly fails with `ENETUNREACH`
// — visible noise in the logs and a wasted ~30s of fall-through latency
// during transient network blips. Forcing ipv4-first eliminates this.
//
// Safe on hosts WITH IPv6 too: Node still falls back to AAAA on A failure.
// Called at module load (not per-request) so the entire process inherits
// the order — including the WS server and any other Node networking.
setDefaultResultOrder('ipv4first')

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
