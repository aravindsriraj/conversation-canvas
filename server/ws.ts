import { verifyToken } from '@clerk/backend'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { getCanvasIfOwned } from '@/lib/db/canvases'
import type { RoomClient, RoomRegistry } from './room'

interface IncomingMsg {
	kind: 'join' | 'transcript' | 'enroll'
	roomId: string
	// Only present on `join`. A Clerk session JWT minted client-side via
	// `useAuth().getToken()`. The server validates it once and caches the
	// resolved Clerk userId on the RoomClient so subsequent messages on the
	// same socket don't pay the verify cost.
	token?: string
	// biome-ignore lint/suspicious/noExplicitAny: payload is per-kind and typed at use site
	payload?: any
}

interface AuthedRoomClient extends RoomClient {
	clerkUserId?: string
}

/**
 * Validate a Clerk-issued JWT and return the userId (`sub` claim). Returns
 * null on any failure — never logs the token (it's a credential).
 */
async function authenticateToken(token: string): Promise<string | null> {
	if (!token) return null
	const secretKey = process.env.CLERK_SECRET_KEY
	if (!secretKey) {
		console.error('[ws] CLERK_SECRET_KEY missing — cannot verify tokens')
		return null
	}
	try {
		const result = await verifyToken(token, { secretKey })
		// `withLegacyReturn` wrapper still returns the payload directly on
		// success and throws on failure, but we type-guard for both shapes.
		// biome-ignore lint/suspicious/noExplicitAny: legacy/new return shapes union
		const payload = (result as any)?.data ?? (result as any)
		const sub = payload?.sub
		return typeof sub === 'string' ? sub : null
	} catch (err) {
		// Log only the error class, not the message — Clerk error messages can
		// echo claims back. The token itself never reaches a log statement.
		console.warn(
			'[ws] token verify failed:',
			(err as Error)?.name ?? 'error',
		)
		return null
	}
}

export function buildWsServer(registry: RoomRegistry) {
	const wss = new WebSocketServer({ noServer: true })

	wss.on('connection', (socket: WebSocket, _req: IncomingMessage) => {
		const client: AuthedRoomClient = { socket }
		let currentRoomId: string | null = null
		console.log('[ws] client connected')

		socket.on('message', async (raw) => {
			let msg: IncomingMsg
			try {
				msg = JSON.parse(raw.toString())
			} catch {
				console.warn('[ws] malformed JSON')
				return
			}
			if (
				!msg ||
				typeof msg.roomId !== 'string' ||
				typeof msg.kind !== 'string'
			) {
				console.warn('[ws] bad message shape', {
					kind: msg?.kind,
					roomId: msg?.roomId,
				})
				return
			}

			if (msg.kind === 'join') {
				// Two-factor gate:
				//   1. Token must verify against the Clerk backend.
				//   2. Resolved Clerk userId must own this canvas.
				// Either failure → send a generic error and close. We do not
				// distinguish "no such canvas" from "you don't own it" to keep
				// canvas IDs unenumerable.
				const token = typeof msg.token === 'string' ? msg.token : ''
				const userId = await authenticateToken(token)
				if (!userId) {
					socket.send(
						JSON.stringify({
							kind: 'error',
							message: 'authentication required',
						}),
					)
					socket.close()
					return
				}
				const canvas = await getCanvasIfOwned(msg.roomId, userId)
				if (!canvas) {
					socket.send(
						JSON.stringify({
							kind: 'error',
							message: 'canvas not found or access denied',
						}),
					)
					socket.close()
					return
				}

				client.clerkUserId = userId
				currentRoomId = msg.roomId
				const room = registry.getOrCreate(msg.roomId)
				room.addClient(client)
				console.log(
					`[ws] join room=${msg.roomId} user=${userId} (clients=${room.clients.size})`,
				)
				socket.send(
					JSON.stringify({ kind: 'history', actions: room.actionHistory }),
				)
				return
			}

			// Every non-join message requires a successful prior join. We don't
			// re-verify the token here (it would have expired anyway — Clerk
			// templates default to 60s); the in-memory `clerkUserId` is the
			// per-socket capability.
			if (!client.clerkUserId || !currentRoomId || currentRoomId !== msg.roomId) {
				console.warn(
					`[ws] ${msg.kind} before authenticated join (room=${msg.roomId})`,
				)
				return
			}
			const room = registry.getOrCreate(msg.roomId)

			if (msg.kind === 'enroll') {
				const { primary, speakerId, displayName, color } = msg.payload ?? {}
				if (typeof displayName !== 'string' || typeof color !== 'string') return

				if (primary === true) {
					room.primaryUser = { displayName, color }
					console.log(
						`[ws] enroll PRIMARY="${displayName}" in room=${msg.roomId}`,
					)
					client.displayName = displayName
					client.color = color
					room.broadcast({
						kind: 'speakers',
						registry: Object.fromEntries(room.speakers),
					})
					return
				}

				if (typeof speakerId !== 'string') return
				client.speakerId = speakerId
				client.displayName = displayName
				client.color = color
				room.recordSpeaker(speakerId, displayName, color)
				console.log(
					`[ws] enroll ${speakerId}="${displayName}" in room=${msg.roomId}`,
				)
				room.broadcast({
					kind: 'speakers',
					registry: Object.fromEntries(room.speakers),
				})
				return
			}

			if (msg.kind === 'transcript') {
				const p = msg.payload ?? {}
				console.log(
					`[ws] transcript room=${msg.roomId} [${p.speaker}] "${(p.text ?? '').slice(0, 80)}" final=${!!p.isFinal}`,
				)
				room.addTranscript(p)
				return
			}

			console.warn(`[ws] unknown kind=${msg.kind}`)
		})

		socket.on('close', () => {
			console.log('[ws] client disconnected')
			if (currentRoomId) {
				const room = registry.getOrCreate(currentRoomId)
				room.removeClient(client)
			}
		})

		socket.on('error', (err) => {
			console.error('[ws] socket error:', err)
		})
	})

	return wss
}

/**
 * Returns an HTTP upgrade router: send `/ws` to our WS server, everything else
 * (Next.js HMR, etc.) to the provided `fallback` upgrade handler. Path comparison
 * is done on the URL pathname only — query strings on Next's HMR URL are ignored.
 */
export function makeUpgradeRouter(
	wss: WebSocketServer,
	fallback: (
		req: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	) => void | Promise<void>,
) {
	return (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		const url = req.url ?? '/'
		const pathname = url.split('?')[0]
		if (pathname === '/ws') {
			// biome-ignore lint/suspicious/noExplicitAny: ws's Socket type is from net; the upgrade Duplex is structurally compatible
			wss.handleUpgrade(req, socket as any, head, (ws) => {
				wss.emit('connection', ws, req)
			})
			return
		}
		void fallback(req, socket, head)
	}
}
