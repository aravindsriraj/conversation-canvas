import type { WebSocket } from 'ws'
import type { Action } from '@/lib/actions/schema'
import { appendAction, listActions } from '@/lib/db/actions'
import { appendChatTurn, listChatTurns } from '@/lib/db/chat'
import {
	type CanvasMemory,
	commitSummary,
	countChatTurns,
	countVoiceActions,
	fetchChatTurnsWindow,
	fetchVoiceActionsWindow,
	getOrCreateMemory,
	releaseSummarizerLock,
	tryAcquireSummarizerLock,
} from '@/lib/db/memories'
import {
	summarizeChatBatch,
	summarizeVoiceBatch,
} from '@/lib/memory/summarizer'
import type { TranscriptSegment } from '@/lib/speechmatics/client'
import { TranscriptBuffer } from '@/lib/orchestrator/buffer'

// When unsummarized raw messages exceed this threshold for a path, we
// trigger an async summarizer pass that compresses the OLDEST 50 into
// the long-term memory. The window keeps the most recent 50 raw so the
// prompts always have high-signal short-term context PLUS the long-term
// summary.
const MEMORY_WINDOW = 50
const MEMORY_BATCH_SIZE = 50

export interface RoomClient {
	socket: WebSocket
	speakerId?: string
	displayName?: string
	color?: string
}

/**
 * One turn in the agent-chat history for a canvas. Persisted to
 * `canvas_chat_turns` (see lib/db/chat.ts) so the LLM still has context
 * after a server restart, and so reopening the canvas surfaces the prior
 * conversation in the panel.
 *
 * `actionIds` lets us show "you asked X → here's what I did" lineage in the
 * chat panel and in the LLM context blob without re-walking the action log.
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
	// Chat history for the agent panel. Hydrated from `canvas_chat_turns` on
	// first join and persisted asynchronously on every recordChatTurn. Cap at
	// 40 turns in-memory (20 user + 20 assistant pairs) so a long session
	// doesn't balloon memory or LLM context; the DB keeps everything older.
	// Oldest-first; new turns push, the oldest get sliced off.
	chatHistory: ChatTurn[] = []
	// Long-term compressed memory for this canvas — both voice and chat
	// threads plus shared meta. Hydrated from `canvas_memories` (or
	// created empty) on first join. Read by buildUserPrompt /
	// buildAgentContext; written by the async summarizer dispatched
	// from afterVoiceTick / afterChatTurn.
	memory: CanvasMemory | null = null
	// Total counts of voice-origin actions and chat turns EVER for this
	// canvas (across sessions). Initialized on hydrate from DB COUNT
	// queries; incremented in-process on every record. The threshold
	// check is `total - msgs_covered > MEMORY_WINDOW`.
	voiceActionsTotal = 0
	chatTurnsTotal = 0
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
				// Load actions, chat history, long-term memory, AND the
				// total counts in parallel. The counts seed the threshold
				// math so we don't have to COUNT(*) on every tick.
				const [stored, chat, memory, voiceTotal, chatTotal] =
					await Promise.all([
						listActions(this.id),
						listChatTurns(this.id, 40),
						getOrCreateMemory(this.id),
						countVoiceActions(this.id),
						countChatTurns(this.id),
					])
				this.actionHistory = stored
				this.chatHistory = chat
				this.memory = memory
				this.voiceActionsTotal = voiceTotal
				this.chatTurnsTotal = chatTotal
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
					`[room ${this.id}] hydrated ${stored.length} action(s) + ${chat.length} chat turn(s) + memory(voice=${voiceTotal}/${memory.voiceMsgsCovered}, chat=${chatTotal}/${memory.chatMsgsCovered}) from DB`,
				)
			} catch (err) {
				console.error(`[room ${this.id}] hydrate failed:`, err)
				// Continue with empty state — better to lose replay than to
				// block the join entirely.
				this.actionHistory = []
				this.chatHistory = []
				this.memory = null
				this.voiceActionsTotal = 0
				this.chatTurnsTotal = 0
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

	recordAction(action: Action, source: 'voice' | 'chat' = 'voice') {
		this.actionHistory.push(action)
		if ('id' in action && typeof action.id === 'string') {
			const summary = summarizeAction(action)
			this.canvasShapes.set(action.id, { type: action.type, summary })
		}
		// Track per-source totals — used to decide when to roll over the
		// long-term memory summary for that path.
		if (source === 'voice') {
			this.voiceActionsTotal += 1
			this.maybeRolloverVoice()
		}
		// Persist asynchronously. If the write fails we keep the in-memory
		// history so the live session continues, but the action won't replay
		// after a reload — acceptable for hackathon, surface in logs.
		void appendAction(this.id, action, source).catch((err) => {
			console.error(`[room ${this.id}] appendAction failed:`, err)
		})
	}

	/**
	 * Append a chat turn for this canvas. Trims the in-memory copy to the
	 * most-recent 40 turns to bound memory; the full history persists in
	 * Postgres (see lib/db/chat.ts) so older turns can be re-fetched from
	 * the DB on a page reload via /api/agent/history.
	 */
	recordChatTurn(turn: ChatTurn) {
		this.chatHistory.push(turn)
		const MAX = 40
		if (this.chatHistory.length > MAX) {
			this.chatHistory = this.chatHistory.slice(-MAX)
		}
		this.chatTurnsTotal += 1
		this.maybeRolloverChat()
		// Fire-and-forget DB persistence. If the write fails we keep the
		// in-memory turn so the live session continues, but it won't
		// survive a restart — surface in logs.
		void appendChatTurn(this.id, turn).catch((err) => {
			console.error(`[room ${this.id}] appendChatTurn failed:`, err)
		})
	}

	/*
	 * Check whether the voice memory needs to roll over and dispatch an
	 * async summarizer if so. Fire-and-forget: the live tick path
	 * continues unblocked while compression runs in the background.
	 *
	 * The lock acquisition is the concurrency guard — if another tick is
	 * already summarizing, this call no-ops. The lock is released when
	 * the summarizer commits its result OR errors out.
	 */
	private maybeRolloverVoice(): void {
		if (!this.memory) return
		const unsummarized = this.voiceActionsTotal - this.memory.voiceMsgsCovered
		if (unsummarized <= MEMORY_WINDOW) return
		void this.rolloverVoice().catch((err) => {
			console.error(`[room ${this.id}] voice rollover failed:`, err)
		})
	}

	private maybeRolloverChat(): void {
		if (!this.memory) return
		const unsummarized = this.chatTurnsTotal - this.memory.chatMsgsCovered
		if (unsummarized <= MEMORY_WINDOW) return
		void this.rolloverChat().catch((err) => {
			console.error(`[room ${this.id}] chat rollover failed:`, err)
		})
	}

	private async rolloverVoice(): Promise<void> {
		if (!this.memory) return
		const acquired = await tryAcquireSummarizerLock(this.id)
		if (!acquired) {
			console.log(`[room ${this.id}] voice rollover skipped (lock held)`)
			return
		}
		try {
			const offset = this.memory.voiceMsgsCovered
			const rawWindow = await fetchVoiceActionsWindow({
				canvasId: this.id,
				offset,
				limit: MEMORY_BATCH_SIZE,
			})
			if (rawWindow.length === 0) {
				await releaseSummarizerLock(this.id)
				return
			}
			console.log(
				`[room ${this.id}] voice rollover dispatching: offset=${offset} batch=${rawWindow.length}`,
			)
			const groundTruth = this.canvasGroundTruth()
			const result = await summarizeVoiceBatch({
				existingThread: this.memory.voiceThread,
				existingMeta: this.memory.sharedMeta,
				canvasGroundTruth: groundTruth,
				items: rawWindow as Action[],
			})
			const covered = offset + rawWindow.length
			await commitSummary({
				canvasId: this.id,
				kind: 'voice',
				thread: result.thread,
				sharedMeta: result.meta,
				msgsCoveredAfter: covered,
			})
			// Update in-memory cached memory state so the next prompt sees
			// the new summary without re-fetching.
			this.memory.voiceThread = result.thread
			this.memory.sharedMeta = result.meta
			this.memory.voiceMsgsCovered = covered
			console.log(
				`[room ${this.id}] voice rollover committed: msgs_covered=${covered}`,
			)
		} catch (err) {
			console.error(`[room ${this.id}] voice rollover error:`, err)
			await releaseSummarizerLock(this.id).catch(() => {})
		}
	}

	private async rolloverChat(): Promise<void> {
		if (!this.memory) return
		const acquired = await tryAcquireSummarizerLock(this.id)
		if (!acquired) {
			console.log(`[room ${this.id}] chat rollover skipped (lock held)`)
			return
		}
		try {
			const offset = this.memory.chatMsgsCovered
			const rawWindow = await fetchChatTurnsWindow({
				canvasId: this.id,
				offset,
				limit: MEMORY_BATCH_SIZE,
			})
			if (rawWindow.length === 0) {
				await releaseSummarizerLock(this.id)
				return
			}
			console.log(
				`[room ${this.id}] chat rollover dispatching: offset=${offset} batch=${rawWindow.length}`,
			)
			const groundTruth = this.canvasGroundTruth()
			const result = await summarizeChatBatch({
				existingThread: this.memory.chatThread,
				existingMeta: this.memory.sharedMeta,
				canvasGroundTruth: groundTruth,
				items: rawWindow,
			})
			const covered = offset + rawWindow.length
			await commitSummary({
				canvasId: this.id,
				kind: 'chat',
				thread: result.thread,
				sharedMeta: result.meta,
				msgsCoveredAfter: covered,
			})
			this.memory.chatThread = result.thread
			this.memory.sharedMeta = result.meta
			this.memory.chatMsgsCovered = covered
			console.log(
				`[room ${this.id}] chat rollover committed: msgs_covered=${covered}`,
			)
		} catch (err) {
			console.error(`[room ${this.id}] chat rollover error:`, err)
			await releaseSummarizerLock(this.id).catch(() => {})
		}
	}

	/*
	 * Render the live canvas as a compact text snapshot for the
	 * summarizer's "ground truth" block. Same shape the orchestrator's
	 * prompt builder emits — listed (id, type, summary) per shape.
	 * Lets the summarizer LLM avoid contradicting locked decisions /
	 * existing cards.
	 */
	private canvasGroundTruth(): string {
		if (this.canvasShapes.size === 0) return '(empty)'
		const lines: string[] = []
		for (const [id, v] of this.canvasShapes.entries()) {
			lines.push(`- ${id} (${v.type}): ${v.summary}`)
		}
		return lines.join('\n')
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
		case 'create_note':
			return `note: "${a.content.slice(0, 200)}"`
		case 'create_geo':
			return `${a.geo}${a.content ? `: "${a.content.slice(0, 160)}"` : ''}`
		case 'create_text':
			return `text: "${a.content.slice(0, 200)}"`
		case 'create_priority_matrix':
			return `matrix: ${a.items.length} items`
		case 'create_budget_allocator':
			return `budget: ${a.splits.map((s) => `${s.label} ${s.amountPct}%`).join(', ')}`
		case 'create_gantt':
			return `gantt: ${a.items.length} items`
		case 'create_bespoke_widget':
			return `bespoke widget`
		case 'delete_shapes':
			return `delete ${a.ids.join(',')}`
		case 'move_shape':
			return `move ${a.id}`
		case 'resize_shape':
			return `resize ${a.id} → ${a.w ?? '?'}×${a.h ?? '?'}`
		case 'set_shape_style':
			return `style ${a.id}`
		case 'align_shapes':
			return `align ${a.op}`
		case 'distribute_shapes':
			return `distribute ${a.op}`
		case 'reorder_shapes':
			return `${a.op.replace('_', ' ')}`
		case 'zoom_to_shapes':
			return `zoom${a.ids?.length ? ' to subset' : ' to fit'}`
		case 'create_arrow':
			return `arrow: (${a.start.x},${a.start.y}) → (${a.end.x},${a.end.y})`
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
