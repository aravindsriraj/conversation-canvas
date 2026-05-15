'use client'

import { useAuth } from '@clerk/nextjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Action } from '@/lib/actions/schema'

interface Props {
	roomId: string
	isOpen: boolean
	onClose: () => void
}

interface ChatTurn {
	id: string
	role: 'user' | 'assistant'
	text: string
	actions: { type: string; summary: string }[]
	streaming?: boolean
}

/*
 * AgentPanel — right-side slide-in chat for asking the canvas AI questions.
 *
 * Side panel that doesn't cover the canvas (canvas just gets narrower when
 * open — handled by the parent shifting tldraw via padding-right). 360px wide.
 * Slides in on a 280ms transform-translateX, mirroring the transcript drawer.
 *
 * The streaming protocol over /api/agent is application/x-ndjson — we read
 * the response body via getReader() and parse one JSON event per newline.
 *
 *   { kind: 'text', delta }   — append to in-flight assistant message
 *   { kind: 'action', action} — show as inline chip in the same message
 *   { kind: 'done' }          — close the in-flight assistant turn
 *   { kind: 'error', message} — surface inline as a faded-ink note
 *
 * Action chips are display-only here — the server already broadcasts the
 * action through the room's WS, so the canvas updates via the existing
 * applyAction path. The chat panel is just a transcript of "what got done".
 */
export function AgentPanel({ roomId, isOpen, onClose }: Props) {
	const [turns, setTurns] = useState<ChatTurn[]>([])
	const [input, setInput] = useState('')
	const [isStreaming, setIsStreaming] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const { getToken, isSignedIn } = useAuth()
	const bodyRef = useRef<HTMLDivElement>(null)
	const abortRef = useRef<AbortController | null>(null)

	// Esc closes when focused inside the panel.
	useEffect(() => {
		if (!isOpen) return
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [isOpen, onClose])

	// Hydrate from DB on first mount (per canvas). The server-side `Room`
	// already loads chat history into memory for the LLM context, but the
	// PANEL UI's `turns` state starts empty on every page load — so we
	// fetch the persisted history once so the user sees their previous
	// conversation re-rendered. Action chips are NOT reconstructed (the
	// canvas itself already has those shapes; chips were a real-time UX
	// affordance, not state). Race-guard: if the user types a message
	// before hydration completes we still take their input — the
	// hydrated turns prepend on arrival.
	const hydratedRef = useRef(false)
	useEffect(() => {
		if (hydratedRef.current || !isSignedIn) return
		hydratedRef.current = true
		;(async () => {
			try {
				const token = await getToken().catch(() => null)
				if (!token) return
				const res = await fetch(
					`/api/agent/history?canvasId=${encodeURIComponent(roomId)}`,
					{ headers: { Authorization: `Bearer ${token}` } },
				)
				if (!res.ok) return
				const body = (await res.json()) as {
					turns?: {
						role: 'user' | 'assistant'
						text: string
						actionIds?: string[]
						ts: number
					}[]
				}
				const fetched = body.turns ?? []
				if (fetched.length === 0) return
				setTurns((prev) => {
					// Prepend the fetched history before any turns the user
					// may have already started in this session. De-dupe by
					// ts so a tab that was open during the persist sees no
					// double bubbles. (Unlikely with our open-on-toggle UX
					// but defensive.)
					const seenTs = new Set(prev.map((t) => t.id))
					const fromDb: ChatTurn[] = fetched.map((t, i) => ({
						id: `db-${t.ts}-${i}`,
						role: t.role,
						text: t.text,
						actions: [],
					}))
					const newOnes = fromDb.filter((t) => !seenTs.has(t.id))
					return [...newOnes, ...prev]
				})
			} catch (err) {
				console.warn('[agent] history fetch failed', err)
			}
		})()
	}, [roomId, isSignedIn, getToken])

	// Auto-scroll on new content.
	useEffect(() => {
		if (!isOpen) return
		bodyRef.current?.scrollTo({
			top: bodyRef.current.scrollHeight,
			behavior: 'smooth',
		})
	}, [turns, isOpen])

	// Cancel any in-flight request when the component unmounts.
	useEffect(() => {
		return () => {
			abortRef.current?.abort()
		}
	}, [])

	const send = useCallback(async () => {
		const message = input.trim()
		if (!message || isStreaming || !isSignedIn) return

		// Append the user turn synchronously so the input clears instantly.
		const userTurn: ChatTurn = {
			id: `u-${Date.now()}`,
			role: 'user',
			text: message,
			actions: [],
		}
		const asstId = `a-${Date.now()}`
		const asstTurn: ChatTurn = {
			id: asstId,
			role: 'assistant',
			text: '',
			actions: [],
			streaming: true,
		}
		setTurns((prev) => [...prev, userTurn, asstTurn])
		setInput('')
		setError(null)
		setIsStreaming(true)

		const ac = new AbortController()
		abortRef.current = ac

		try {
			// Mint a fresh Clerk session JWT and pass it as a Bearer token. The
			// session-cookie path is unreliable for these /api streams in dev
			// (we observed `auth()` returning null userId even with cookies
			// set), but the Bearer path is rock-solid — the same pattern that
			// the snapshot PUT uses successfully.
			const token = await getToken().catch(() => null)
			if (!token) {
				throw new Error('not signed in')
			}
			const res = await fetch('/api/agent', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ canvasId: roomId, message }),
				signal: ac.signal,
			})
			if (!res.ok || !res.body) {
				const text = await res.text().catch(() => '')
				throw new Error(
					`agent request failed (${res.status}): ${text.slice(0, 120)}`,
				)
			}

			const reader = res.body.getReader()
			const decoder = new TextDecoder()
			let buf = ''
			while (true) {
				const { value, done } = await reader.read()
				if (done) break
				buf += decoder.decode(value, { stream: true })
				// Events are newline-delimited; one might span chunks.
				let nl = buf.indexOf('\n')
				while (nl !== -1) {
					const line = buf.slice(0, nl).trim()
					buf = buf.slice(nl + 1)
					nl = buf.indexOf('\n')
					if (!line) continue
					let evt: {
						kind?: string
						delta?: string
						action?: Action
						message?: string
					}
					try {
						evt = JSON.parse(line)
					} catch {
						// Bad line — skip rather than tear down the whole stream.
						console.warn('[agent] bad ndjson line', line.slice(0, 80))
						continue
					}
					if (evt.kind === 'text' && typeof evt.delta === 'string') {
						const delta = evt.delta
						setTurns((prev) =>
							prev.map((t) =>
								t.id === asstId
									? { ...t, text: t.text + delta }
									: t,
							),
						)
					} else if (evt.kind === 'action' && evt.action) {
						const a = evt.action
						const summary = summarizeAction(a)
						setTurns((prev) =>
							prev.map((t) =>
								t.id === asstId
									? {
											...t,
											actions: [
												...t.actions,
												{ type: a.type, summary },
											],
										}
									: t,
							),
						)
					} else if (evt.kind === 'error') {
						setError(evt.message ?? 'agent error')
					}
				}
			}
		} catch (err) {
			if ((err as Error)?.name === 'AbortError') return
			console.error('[agent] stream failed', err)
			setError(err instanceof Error ? err.message : 'unknown error')
		} finally {
			setIsStreaming(false)
			abortRef.current = null
			setTurns((prev) =>
				prev.map((t) =>
					t.id === asstId ? { ...t, streaming: false } : t,
				),
			)
		}
	}, [input, isSignedIn, isStreaming, roomId])

	return (
		<div
			className="fixed top-0 right-0 bottom-0 z-[400] border-l border-hairline bg-paper/95 backdrop-blur flex flex-col"
			style={{
				width: 360,
				transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
				transition: 'transform 280ms cubic-bezier(.22,.61,.36,1)',
				boxShadow: isOpen
					? '-8px 0 30px -20px rgba(26,24,21,0.25)'
					: 'none',
			}}
			aria-hidden={!isOpen}
		>
			{/* Header */}
			<div className="px-5 py-3 border-b border-hairline flex items-center gap-3 shrink-0">
				<span
					className="w-1.5 h-1.5 bg-ochre rounded-full"
					aria-hidden="true"
				/>
				<span className="font-display text-[11px] uppercase tracking-[0.22em] text-ink">
					Ask AI
				</span>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close agent panel"
					className="ml-auto font-mono text-[11px] uppercase tracking-[0.18em] text-faded-ink hover:text-ink"
				>
					Close · Esc
				</button>
			</div>

			{error ? (
				<div className="px-5 py-2 text-[11px] font-mono text-crimson bg-paper border-b border-crimson shrink-0">
					{error}
				</div>
			) : null}

			{/* Body */}
			<div
				ref={bodyRef}
				className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4"
			>
				{turns.length === 0 ? (
					<div className="flex flex-col gap-3 mt-2">
						<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink">
							§ Empty
						</div>
						<p className="font-display italic text-[15px] leading-[1.55] text-faded-ink m-0">
							Ask me to summarize, rearrange, or add to the
							canvas.
						</p>
						<div className="font-mono text-[11px] text-faded-ink mt-2 leading-relaxed">
							<div>“What was decided about the timeline?”</div>
							<div>“Add a question card about the budget.”</div>
							<div>“Summarize the open proposals.”</div>
						</div>
					</div>
				) : (
					turns.map((t) => <TurnBubble key={t.id} turn={t} />)
				)}
			</div>

			{/* Footer */}
			<div className="border-t border-hairline px-4 py-3 shrink-0">
				<textarea
					value={input}
					onChange={(e) => {
						setInput(e.target.value)
						// Clear stale error banner as soon as the user starts
						// composing — the previous failure isn't relevant to
						// what they're about to send.
						if (error) setError(null)
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault()
							void send()
						}
					}}
					placeholder={
						isStreaming
							? 'Thinking…'
							: 'Ask anything about the canvas.'
					}
					disabled={isStreaming}
					rows={2}
					className={[
						'w-full resize-none bg-paper border border-hairline',
						'rounded-sm px-3 py-2',
						'font-mono text-[13px] leading-[1.5] text-ink',
						'placeholder:text-faded-ink placeholder:italic',
						'focus:outline-none focus:border-ink',
						'disabled:opacity-60',
					].join(' ')}
				/>
				<div className="flex items-center justify-between mt-2">
					<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faded-ink">
						{isStreaming ? 'streaming…' : 'enter ↩ to send'}
					</span>
					<button
						type="button"
						onClick={() => void send()}
						disabled={isStreaming || !input.trim()}
						className={[
							'px-3 py-1.5 rounded-sm border',
							'font-display text-[10px] uppercase tracking-[0.22em]',
							'transition-colors',
							isStreaming || !input.trim()
								? 'bg-paper border-hairline text-faded-ink cursor-not-allowed'
								: 'bg-ink border-ink text-paper hover:bg-[#2a2723]',
						].join(' ')}
					>
						Send
					</button>
				</div>
			</div>
		</div>
	)
}

function TurnBubble({ turn }: { turn: ChatTurn }) {
	if (turn.role === 'user') {
		return (
			<div className="flex justify-end">
				<div className="max-w-[85%] border border-hairline rounded-sm px-3 py-2 font-mono text-[13px] leading-[1.55] text-ink">
					{turn.text}
				</div>
			</div>
		)
	}
	return (
		<div className="flex justify-start">
			<div className="max-w-[95%] flex flex-col gap-2">
				{turn.text ? (
					<p
						className={[
							'font-mono text-[13px] leading-[1.55] m-0 whitespace-pre-wrap',
							turn.streaming ? 'text-faded-ink' : 'text-ink',
						].join(' ')}
					>
						{turn.text}
					</p>
				) : turn.streaming && turn.actions.length === 0 ? (
					<div className="flex items-center gap-2 m-0">
						<span
							className="w-1.5 h-1.5 bg-ochre rounded-full agent-pulse"
							aria-hidden="true"
						/>
						<span className="font-mono text-[12px] italic text-faded-ink">
							Thinking…
						</span>
					</div>
				) : null}
				{turn.actions.length > 0 ? (
					<div className="flex flex-col gap-1.5">
						{turn.actions.map((a, i) => (
							<span
								key={`${a.type}-${i}`}
								className="inline-flex items-center gap-2 self-start font-mono text-[11px] text-ink border border-hairline rounded-sm px-2 py-1"
							>
								<span
									className="w-1 h-1 bg-ochre rounded-full"
									aria-hidden="true"
								/>
								<span className="text-faded-ink uppercase tracking-[0.14em] text-[10px]">
									{prettyType(a.type)}
								</span>
								<span className="text-ink truncate max-w-[220px]">
									{a.summary}
								</span>
							</span>
						))}
					</div>
				) : null}
			</div>
		</div>
	)
}

function prettyType(type: string): string {
	return type
		.replace(/^create_/, '+ ')
		.replace(/_/g, ' ')
}

function summarizeAction(a: Action): string {
	switch (a.type) {
		case 'create_proposal_card':
			return a.content.slice(0, 80)
		case 'create_decision_card':
			return a.content.slice(0, 80)
		case 'create_commitment_card':
			return `${a.action.slice(0, 60)}${a.deadline ? ` · ${a.deadline}` : ''}`
		case 'create_blocker_card':
			return a.content.slice(0, 80)
		case 'create_question_card':
			return a.content.slice(0, 80)
		case 'create_note':
			return a.content.slice(0, 80)
		case 'create_geo':
			return `${a.geo}${a.content ? ` — ${a.content.slice(0, 60)}` : ''}`
		case 'create_text':
			return a.content.slice(0, 80)
		case 'create_priority_matrix':
			return `${a.items.length} item${a.items.length === 1 ? '' : 's'}`
		case 'create_budget_allocator':
			return a.splits
				.map((s) => `${s.label} ${s.amountPct}%`)
				.join(', ')
				.slice(0, 80)
		case 'create_gantt':
			return `${a.items.length} task${a.items.length === 1 ? '' : 's'}`
		case 'link_nodes':
			return `${a.from} → ${a.to} (${a.kind})`
		case 'lock_decision':
			return `locked ${a.id}`
		case 'update_card':
			return `updated ${a.id}`
		case 'group_into_frame':
			return a.label
		case 'create_bespoke_widget':
			return 'bespoke widget'
		case 'delete_shapes':
			return a.ids.join(', ').slice(0, 80)
		case 'move_shape':
			return `${a.id}`
		case 'resize_shape':
			return `${a.id} → ${a.w ?? '?'}×${a.h ?? '?'}`
		case 'set_shape_style':
			return `${a.id} · ${[a.color, a.fill, a.dash, a.size, a.font].filter(Boolean).join(' ')}`.slice(0, 80)
		case 'align_shapes':
			return `${a.op} · ${a.ids.length} shapes`
		case 'distribute_shapes':
			return `${a.op} · ${a.ids.length} shapes`
		case 'reorder_shapes':
			return `${a.op.replace('_', ' ')} · ${a.ids.length} shapes`
		case 'zoom_to_shapes':
			return a.ids?.length ? `→ ${a.ids.length} shape${a.ids.length === 1 ? '' : 's'}` : 'fit all'
		case 'create_arrow':
			return `(${a.start.x},${a.start.y}) → (${a.end.x},${a.end.y})`
		default:
			return ''
	}
}
