/**
 * Module-level shared RoomRegistry.
 *
 * The custom Node server (server/index.ts) owns the websocket server, which is
 * where `Room` instances normally get created and cached. But the `/api/agent`
 * HTTP route — handled by Next.js inside the same Node process — also needs to
 * write into the same Room (record actions, broadcast, read transcript buffer
 * + canvas snapshot). Both code paths import this module, so they end up
 * pointing at the same `RoomRegistry` instance.
 *
 * Why a module singleton instead of dependency injection:
 *   - The Next.js route handler API takes no opaque ctx where we could thread
 *     a registry in. Module-scope state is the documented escape hatch.
 *   - tsx/Node module caching guarantees one instance per process. We do NOT
 *     run multiple workers (the WS upgrade routing wouldn't survive that
 *     anyway — sockets are per-process state).
 *
 * Lifecycle:
 *   - server/index.ts calls `setRegistry(registry)` once after `RoomRegistry`
 *     is constructed (with the orchestrator's `onTick` callback wired in).
 *   - `/api/agent` calls `getRegistry()` per request. If the WS server hasn't
 *     finished booting yet (only possible during the first ~50ms of server
 *     start), it returns null and the route returns 503.
 */
import type { RoomRegistry } from './room'

let registry: RoomRegistry | null = null

export function setRegistry(r: RoomRegistry): void {
	registry = r
}

export function getRegistry(): RoomRegistry | null {
	return registry
}
