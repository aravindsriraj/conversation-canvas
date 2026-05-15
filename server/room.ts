import type { WebSocket } from 'ws'
import type { Action } from '@/lib/actions/schema'
import type { TranscriptSegment } from '@/lib/speechmatics/client'
import { TranscriptBuffer } from '@/lib/orchestrator/buffer'

export interface RoomClient {
	socket: WebSocket
	speakerId?: string
	displayName?: string
	color?: string
}

export class Room {
	id: string
	clients: Set<RoomClient> = new Set()
	buffer: TranscriptBuffer
	canvasShapes: Map<string, { type: string; summary: string }> = new Map()
	speakers: Map<string, { displayName: string; color: string }> = new Map()
	actionHistory: Action[] = []
	onTick: () => Promise<void>

	constructor(id: string, onTick: (room: Room) => Promise<void>) {
		this.id = id
		this.onTick = () => onTick(this)
		this.buffer = new TranscriptBuffer({
			windowSeconds: 90,
			debounceMs: 3000,
			onTick: () => this.onTick(),
		})
	}

	addClient(client: RoomClient) {
		this.clients.add(client)
	}

	removeClient(client: RoomClient) {
		this.clients.delete(client)
	}

	addTranscript(seg: TranscriptSegment) {
		this.buffer.add(seg)
	}

	recordSpeaker(speakerId: string, displayName: string, color: string) {
		this.speakers.set(speakerId, { displayName, color })
	}

	recordAction(action: Action) {
		this.actionHistory.push(action)
		if ('id' in action && typeof action.id === 'string') {
			const summary = summarizeAction(action)
			this.canvasShapes.set(action.id, { type: action.type, summary })
		}
	}

	broadcast(payload: unknown) {
		const msg = JSON.stringify(payload)
		for (const c of this.clients) {
			if (c.socket.readyState === 1) c.socket.send(msg)
		}
	}
}

function summarizeAction(a: Action): string {
	switch (a.type) {
		case 'create_proposal_card':
			return `proposal: "${a.content.slice(0, 60)}"`
		case 'create_decision_card':
			return `decision: "${a.content.slice(0, 60)}"`
		case 'create_commitment_card':
			return `commit: ${a.ownerSpeakerId} "${a.action.slice(0, 50)}"`
		case 'create_blocker_card':
			return `blocker: "${a.content.slice(0, 60)}"`
		case 'create_question_card':
			return `question: "${a.content.slice(0, 60)}"`
		case 'create_priority_matrix':
			return `matrix: ${a.items.length} items`
		case 'create_budget_allocator':
			return `budget: ${a.splits.map((s) => `${s.label} ${s.amountPct}%`).join(', ')}`
		case 'create_gantt':
			return `gantt: ${a.items.length} items`
		case 'create_bespoke_widget':
			return `bespoke widget`
		default:
			return a.type
	}
}

export class RoomRegistry {
	private rooms = new Map<string, Room>()
	constructor(private onTick: (room: Room) => Promise<void>) {}

	getOrCreate(id: string): Room {
		let r = this.rooms.get(id)
		if (!r) {
			r = new Room(id, this.onTick)
			this.rooms.set(id, r)
		}
		return r
	}
}
