import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'
import type { RoomRegistry, RoomClient } from './room'

interface IncomingMsg {
	kind: 'join' | 'transcript' | 'enroll'
	roomId: string
	// biome-ignore lint/suspicious/noExplicitAny: payload is per-kind and typed at use site
	payload?: any
}

/**
 * Build a WebSocketServer in `noServer` mode and a `handleUpgrade` callback the
 * custom server can route to when the upgrade URL matches `/ws`. Other paths
 * (notably Next.js's `/_next/webpack-hmr`) must NOT come through here, otherwise
 * the `ws` library kills them.
 */
export function buildWsServer(registry: RoomRegistry) {
	const wss = new WebSocketServer({ noServer: true })

	wss.on('connection', (socket: WebSocket, _req: IncomingMessage) => {
		const client: RoomClient = { socket }
		let currentRoomId: string | null = null
		console.log('[ws] client connected')

		socket.on('message', (raw) => {
			let msg: IncomingMsg
			try {
				msg = JSON.parse(raw.toString())
			} catch {
				console.warn('[ws] malformed JSON')
				return
			}
			if (!msg || typeof msg.roomId !== 'string' || typeof msg.kind !== 'string') {
				console.warn('[ws] bad message shape', { kind: msg?.kind, roomId: msg?.roomId })
				return
			}
			const room = registry.getOrCreate(msg.roomId)
			currentRoomId = msg.roomId

			if (msg.kind === 'join') {
				room.addClient(client)
				console.log(`[ws] join room=${msg.roomId} (clients=${room.clients.size})`)
				socket.send(JSON.stringify({ kind: 'history', actions: room.actionHistory }))
				return
			}

			if (msg.kind === 'enroll') {
				const { speakerId, displayName, color } = msg.payload ?? {}
				if (typeof speakerId !== 'string') return
				client.speakerId = speakerId
				client.displayName = displayName
				client.color = color
				room.recordSpeaker(speakerId, displayName, color)
				console.log(`[ws] enroll ${speakerId}="${displayName}" in room=${msg.roomId}`)
				room.broadcast({ kind: 'speakers', registry: Object.fromEntries(room.speakers) })
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
	fallback: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>,
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
