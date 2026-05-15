/**
 * Module-level shared RoomRegistry.
 *
 * The custom Node server (server/index.ts) owns the websocket server, which is
 * where `Room` instances normally get created and cached. But the `/api/agent`
 * HTTP route — handled by Next.js inside the same Node process — also needs to
 * write into the same Room (record actions, broadcast, read transcript buffer
 * + canvas snapshot). Both code paths must end up pointing at the same
 * `RoomRegistry` instance.
 *
 * Why `globalThis` instead of a plain module-level `let`:
 *   tsx loads server/index.ts via Node's native module system, but Next's
 *   Turbopack bundles route handlers with their OWN copy of every imported
 *   module — so a naive `let registry` lives in two different memory spaces
 *   and `getRegistry()` from /api/agent returns null even though server/index
 *   set it on boot. Pinning the reference onto `globalThis` is the documented
 *   Next.js escape hatch (the same pattern used for shared Prisma clients in
 *   dev — see https://nextjs.org/docs/messages/duplicate-module-load).
 *
 * Lifecycle:
 *   - server/index.ts calls `setRegistry(registry)` once after `RoomRegistry`
 *     is constructed (with the orchestrator's `onTick` callback wired in).
 *   - `/api/agent` calls `getRegistry()` per request. If the WS server hasn't
 *     finished booting yet (only possible during the first ~50ms of server
 *     start), it returns null and the route returns 503.
 */
import type { RoomRegistry } from './room'

// Use a Symbol-keyed slot on globalThis so we never collide with another
// library's globals (eg. Prisma's `__db` convention).
const REGISTRY_KEY = Symbol.for('conversation-canvas.RoomRegistry')

type GlobalWithRegistry = typeof globalThis & {
	[REGISTRY_KEY]?: RoomRegistry | null
}

export function setRegistry(r: RoomRegistry): void {
	;(globalThis as GlobalWithRegistry)[REGISTRY_KEY] = r
}

export function getRegistry(): RoomRegistry | null {
	return (globalThis as GlobalWithRegistry)[REGISTRY_KEY] ?? null
}
