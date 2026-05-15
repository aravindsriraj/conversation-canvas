import type { WebSocket } from 'ws'
import type { Action } from '@/lib/actions/schema'
import { appendAction, listActions } from '@/lib/db/actions'
import type { TranscriptSegment } from '@/lib/speechmatics/client'
import { TranscriptBuffer } from '@/lib/orchestrator/buffer'

export interface RoomClient {
	socket: WebSocket
	speakerId?: string
	displayName?: string
	color?: string
}

/**
 * One turn in the agent-chat history for a canvas. Kept in-memory only —
 * chat history is best-effort across server restarts (transcripts and the
 * canvas itself persist, so the agent always has fresh context regardless).
 *
 * `actionIds` lets us show "you asked X → here's what I did" lineage in the
 * chat panel without re-walking the action log.
 */
export interface ChatTurn {
	role: 'user' | 'assistant'
	text: string
	actionIds?: string[]
	ts: number
}

export class Room {
	id: string
	clients: Set<RoomClient> = new Set()
	buffer: TranscriptBuffer
	canvasShapes: Map<string, { type: string; summary: string }> = new Map()
	speakers: Map<string, { displayName: string; color: string }> = new Map()
	// Single-user mode: the primary identity for this room. Every Speechmatics
	// speaker label (S0/S1/S2/…) that shows up gets mapped to this identity by
	// the orchestrator. Set via an `enroll` WS message with `primary: true`.
	primaryUser: { displayName: string; color: string } | null = null
	actionHistory: Action[] = []
	// In-memory chat history for the agent panel. Cap at 40 turns (20 user +
	// 20 assistant pairs) per room so a long session doesn't balloon memory
	// or LLM context. Oldest-first; new turns push, the oldest get sliced off.
	chatHistory: ChatTurn[] = []
	onTick: () => Promise<void>
	// True once the first DB hydration completes. Until then, recordAction
	// would race with the replay and possibly insert before existing history
	// is loaded — we gate appends behind this flag.
	hydrated = false
	private hydrationPromise: Promise<void> | null = null

	constructor(id: string, onTick: (room: Room) => Promise<void>) {
		this.id = id
		this.onTick = () => onTick(this)
		this.buffer = new TranscriptBuffer({
			windowSeconds: 90,
			debounceMs: 3000,
			onTick: () => this.onTick(),
		})
	}

	/**
	 * Load existing action history from Postgres. Called once per Room
	 * instance lifetime (rooms are evicted from the registry when idle and
	 * re-created on next join). Subsequent calls are idempotent.
	 */
	hydrate(): Promise<void> {
		if (this.hydrationPromise) return this.hydrationPromise
		this.hydrationPromise = (async () => {
			try {
				const stored = await listActions(this.id)
				this.actionHistory = stored
				// Rebuild the canvasShapes summary index so the orchestrator's
				// snapshot prompt has full context after a server restart.
				for (const action of stored) {
					if ('id' in action && typeof action.id === 'string') {
						const summary = summarizeAction(action)
						this.canvasShapes.set(action.id, {
							type: action.type,
							summary,
						})
					}
				}
				console.log(
					`[room ${this.id}] hydrated ${stored.length} action(s) from DB`,
				)
			} catch (err) {
				console.error(`[room ${this.id}] hydrate failed:`, err)
				// Continue with an empty history — better to lose replay than
				// to block the join entirely.
				this.actionHistory = []
			} finally {
				this.hydrated = true
			}
		})()
		return this.hydrationPromise
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
		// Persist asynchronously. If the write fails we keep the in-memory
		// history so the live session continues, but the action won't replay
		// after a reload — acceptable for hackathon, surface in logs.
		void appendAction(this.id, action).catch((err) => {
			console.error(`[room ${this.id}] appendAction failed:`, err)
		})
	}

	/**
	 * Append a chat turn for this canvas. Trims to the most-recent 40 turns
	 * to bound memory. Chat history is in-memory only — see ChatTurn docstring.
	 */
	recordChatTurn(turn: ChatTurn) {
		this.chatHistory.push(turn)
		const MAX = 40
		if (this.chatHistory.length > MAX) {
			this.chatHistory = this.chatHistory.slice(-MAX)
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
	// Summary length is intentionally generous (~200 chars) — Gemini needs the
	// full content visible in the canvas snapshot to decide whether an existing
	// card already covers a new utterance (prevents duplicate decisions).
	switch (a.type) {
		case 'create_proposal_card':
			return `proposal: "${a.content.slice(0, 200)}"`
		case 'create_decision_card':
			return `decision: "${a.content.slice(0, 200)}"`
		case 'create_commitment_card':
			return `commit: ${a.ownerSpeakerId} "${a.action.slice(0, 200)}"`
		case 'create_blocker_card':
			return `blocker: "${a.content.slice(0, 200)}"`
		case 'create_question_card':
			return `question: "${a.content.slice(0, 200)}"`
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
