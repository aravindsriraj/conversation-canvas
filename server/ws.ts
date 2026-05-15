import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage, Server as HttpServer } from 'http'
import type { RoomRegistry, RoomClient } from './room'

interface IncomingMsg {
	kind: 'join' | 'transcript' | 'enroll'
	roomId: string
	// biome-ignore lint/suspicious/noExplicitAny: payload is per-kind and typed at use site
	payload?: any
}

export function attachWsServer(server: HttpServer, registry: RoomRegistry) {
	const wss = new WebSocketServer({ server, path: '/ws' })

	wss.on('connection', (socket: WebSocket, _req: IncomingMessage) => {
		const client: RoomClient = { socket }
		let currentRoomId: string | null = null

		socket.on('message', (raw) => {
			let msg: IncomingMsg
			try {
				msg = JSON.parse(raw.toString())
			} catch {
				return
			}
			if (!msg || typeof msg.roomId !== 'string' || typeof msg.kind !== 'string') {
				return
			}
			const room = registry.getOrCreate(msg.roomId)
			currentRoomId = msg.roomId

			if (msg.kind === 'join') {
				room.addClient(client)
				// Replay action history to the new client so it catches up
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
				room.broadcast({ kind: 'speakers', registry: Object.fromEntries(room.speakers) })
				return
			}

			if (msg.kind === 'transcript') {
				room.addTranscript(msg.payload)
				return
			}
		})

		socket.on('close', () => {
			if (currentRoomId) {
				const room = registry.getOrCreate(currentRoomId)
				room.removeClient(client)
			}
		})
	})

	return wss
}
