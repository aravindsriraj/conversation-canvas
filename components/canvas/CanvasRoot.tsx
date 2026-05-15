'use client'

import { useAuth } from '@clerk/nextjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type Editor, getSnapshot, loadSnapshot, Tldraw } from 'tldraw'
import { BlockerCardUtil } from '@/components/canvas/shapes/BlockerCard'
import { BudgetAllocatorUtil } from '@/components/canvas/shapes/BudgetAllocator'
import { CommitmentCardUtil } from '@/components/canvas/shapes/CommitmentCard'
import { DecisionCardUtil } from '@/components/canvas/shapes/DecisionCard'
import { PriorityMatrixUtil } from '@/components/canvas/shapes/PriorityMatrix'
import { ProposalCardUtil } from '@/components/canvas/shapes/ProposalCard'
import { QuestionCardUtil } from '@/components/canvas/shapes/QuestionCard'
import { AgentPanel } from '@/components/room/AgentPanel'
import { TranscriptDrawer } from '@/components/room/TranscriptDrawer'
import { applyAction, rebuildIdMapFromEditor } from '@/lib/actions/apply'
import type { Action } from '@/lib/actions/schema'

const customShapeUtils = [
	ProposalCardUtil,
	DecisionCardUtil,
	CommitmentCardUtil,
	BlockerCardUtil,
	QuestionCardUtil,
	PriorityMatrixUtil,
	BudgetAllocatorUtil,
]

type SpeakerRegistry = Record<string, { displayName: string; color: string }>

interface CanvasRootProps {
	roomId: string
	canvasName?: string
	enrollment: { name: string; color: string }
}

export function CanvasRoot({ roomId, canvasName, enrollment }: CanvasRootProps) {
	const editorRef = useRef<Editor | null>(null)
	const wsRef = useRef<WebSocket | null>(null)
	const [speakers, setSpeakers] = useState<SpeakerRegistry>({})
	const [accessError, setAccessError] = useState<string | null>(null)
	const [agentOpen, setAgentOpen] = useState(false)
	const { isLoaded, isSignedIn, getToken } = useAuth()
	// We keep a ref alongside the state so the WS message handler reads the
	// latest registry without forcing the WS effect to re-run (which would
	// tear down the socket on every speaker update — undesired).
	const speakersRef = useRef<SpeakerRegistry>({})
	// Set to true once the server's initial state (snapshot OR history) has
	// been applied. Snapshot save effect waits on this so we don't overwrite
	// the server's state with an empty editor before initial state arrives.
	const hasLoadedRef = useRef(false)

	useEffect(() => {
		speakersRef.current = speakers
	}, [speakers])

	const onMount = useCallback((editor: Editor) => {
		editorRef.current = editor
	}, [])

	// Snapshot save loop. Subscribes to user-initiated document changes
	// (drag, delete, freehand draw, in-place edit, AND orchestrator-applied
	// shapes — applyAction runs in 'user' source by default) and PUTs a
	// fresh snapshot to the server with a 1500ms debounce.
	//
	// The debounce trades a small data-loss window (refresh within ~1.5s of
	// the last edit will lose that edit) for staying well under Neon's
	// connection budget. Tab close triggers an immediate flush via
	// `visibilitychange` + sendBeacon so a deliberate exit never loses data.
	useEffect(() => {
		if (!isLoaded || !isSignedIn) return

		let timer: ReturnType<typeof setTimeout> | null = null
		let unsubscribe: (() => void) | null = null
		let beaconHandler: (() => void) | null = null
		let cancelled = false

		const scheduleSave = () => {
			if (timer) clearTimeout(timer)
			timer = setTimeout(saveNow, 1500)
		}

		const saveNow = async () => {
			if (cancelled) return
			const editor = editorRef.current
			if (!editor) return
			if (!hasLoadedRef.current) return
			try {
				const { document } = getSnapshot(editor.store)
				const token = await getToken().catch(() => null)
				if (!token) return
				await fetch(`/api/canvases/${roomId}/snapshot`, {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ document }),
				})
			} catch (err) {
				console.warn('[canvas] snapshot save failed', err)
			}
		}

		// Poll for the editor to become available (it mounts after Tldraw
		// renders, which is async). Once it does, attach the listener.
		const attachInterval = setInterval(() => {
			const editor = editorRef.current
			if (!editor) return
			clearInterval(attachInterval)
			unsubscribe = editor.store.listen(scheduleSave, {
				source: 'user',
				scope: 'document',
			})
			// Flush on tab close — visibilitychange fires reliably on tab
			// switch / close / navigation away.
			beaconHandler = () => {
				if (!hasLoadedRef.current) return
				const { document } = getSnapshot(editor.store)
				const blob = new Blob([JSON.stringify({ document })], {
					type: 'application/json',
				})
				// sendBeacon doesn't go through Clerk auth on the wire, so we
				// rely on the cookie-session being valid. (Bearer token in the
				// debounced path is what protects against expired sessions.)
				navigator.sendBeacon?.(`/api/canvases/${roomId}/snapshot`, blob)
			}
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'hidden') beaconHandler?.()
			})
		}, 50)

		return () => {
			cancelled = true
			if (timer) clearTimeout(timer)
			clearInterval(attachInterval)
			unsubscribe?.()
			if (beaconHandler) {
				document.removeEventListener('visibilitychange', beaconHandler)
			}
		}
	}, [roomId, isLoaded, isSignedIn, getToken])

	useEffect(() => {
		// Don't open the WS until Clerk has a session. `getToken()` would
		// return null otherwise and the server would reject our join.
		if (!isLoaded || !isSignedIn) return

		let cancelled = false
		let ws: WebSocket | null = null

		;(async () => {
			// Mint a fresh session JWT right before opening the WS. Clerk's
			// default templates have a 60s TTL, so we can't reuse one across
			// reconnects.
			const token = await getToken().catch(() => null)
			if (cancelled || !token) return

			const url = process.env.NEXT_PUBLIC_WS_URL || `ws://${location.host}/ws`
			ws = new WebSocket(url)
			wsRef.current = ws

			ws.onopen = () => {
				ws?.send(
					JSON.stringify({
						kind: 'join',
						roomId,
						token,
					}),
				)
				// `enroll` is sent AFTER we hear back from the server's join handler
				// (see onmessage below). The join is now async (token verify + DB
				// ownership check + DB hydrate), so firing enroll on `onopen`
				// races ahead of the server's `client.clerkUserId` being set.
			}
			let enrollmentSent = false
			const sendEnrollment = () => {
				if (enrollmentSent || ws?.readyState !== 1) return
				enrollmentSent = true
				ws.send(
					JSON.stringify({
						kind: 'enroll',
						roomId,
						payload: {
							primary: true,
							displayName: enrollment.name,
							color: enrollment.color,
						},
					}),
				)
			}
			ws.onmessage = (evt) => {
				let msg: unknown
				try {
					msg = JSON.parse(typeof evt.data === 'string' ? evt.data : '')
				} catch {
					return
				}
				if (!msg || typeof msg !== 'object') return
				const m = msg as {
					kind?: string
					actions?: Action[]
					registry?: SpeakerRegistry
					message?: string
				}
				if (m.kind === 'error') {
					setAccessError(m.message ?? 'access denied')
					return
				}
				if (m.kind === 'snapshot') {
					// Server returned the saved tldraw store. Restore it BEFORE
					// any actions arrive, then rebuild the apply.ts ID_MAP so
					// future orchestrator actions can reference shapes the
					// snapshot just restored.
					const editor = editorRef.current
					if (editor) {
						const doc = (m as { document?: unknown }).document
						if (doc) {
							try {
								// biome-ignore lint/suspicious/noExplicitAny: tldraw snapshot is structurally opaque on the wire
								loadSnapshot(editor.store, { document: doc as any })
								rebuildIdMapFromEditor(editor)
								hasLoadedRef.current = true
								requestAnimationFrame(() => {
									try {
										editor.zoomToFit({ animation: { duration: 600 } })
									} catch {}
								})
							} catch (err) {
								console.warn('[canvas] loadSnapshot failed', err)
							}
						}
					}
					// Server confirmed our authenticated join — safe to enroll now.
					sendEnrollment()
					return
				}
				if (m.kind === 'history' || m.kind === 'actions') {
					// First `history` reply confirms the join handshake. Enroll now.
					if (m.kind === 'history') sendEnrollment()
					const actions = m.actions ?? []
					const editor = editorRef.current
					if (!editor) {
						// If the editor hasn't mounted yet (race during page load), the
						// history is dropped. The server replays history only on join,
						// so this only matters when there's pre-existing room state at
						// load time. Demo flows start with an empty room, so acceptable.
						return
					}
					let appliedAny = false
					for (const a of actions) {
						try {
							applyAction(editor, a, speakersRef.current)
							appliedAny = true
						} catch (err) {
							console.error('[canvas] applyAction failed', err, a)
						}
					}
					if (appliedAny) {
						hasLoadedRef.current = true
						requestAnimationFrame(() => {
							try {
								editor.zoomToFit({ animation: { duration: 600 } })
							} catch (err) {
								console.warn('[canvas] zoomToFit failed', err)
							}
						})
					}
				} else if (m.kind === 'speakers' && m.registry) {
					setSpeakers(m.registry)
				}
			}
		})()

		return () => {
			cancelled = true
			ws?.close()
			wsRef.current = null
		}
	}, [roomId, enrollment, isLoaded, isSignedIn, getToken])

	if (accessError) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-paper text-ink p-8">
				<div className="max-w-[420px] text-center">
					<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-3">
						§ Server rejected join
					</div>
					<h1 className="font-display text-[28px] tracking-tight mb-4">
						{accessError}
					</h1>
					<a
						href="/dashboard"
						className="font-mono text-[11px] uppercase tracking-[0.18em] text-olive hover:text-ink"
					>
						Back to dashboard →
					</a>
				</div>
			</div>
		)
	}

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			{/*
				When the agent panel is open we narrow the tldraw mount area by
				its width (360px) so the canvas isn't covered. tldraw resizes
				its own ResizeObserver-driven viewport automatically; users
				simply see the canvas shift left by 360px and stay fully
				interactive.
			*/}
			<div
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					bottom: 0,
					right: agentOpen ? 360 : 0,
					transition: 'right 280ms cubic-bezier(.22,.61,.36,1)',
				}}
			>
				<Tldraw onMount={onMount} shapeUtils={customShapeUtils} />
			</div>
			<TranscriptDrawer
				wsRef={wsRef}
				roomId={roomId}
				agentOpen={agentOpen}
				onToggleAgent={() => setAgentOpen((v) => !v)}
			/>
			<AgentPanel
				roomId={roomId}
				isOpen={agentOpen}
				onClose={() => setAgentOpen(false)}
			/>
			{/*
				Top-left navigation pill: back link to dashboard + canvas name.
				Sits above tldraw's z-stack so it stays clickable even when the
				editor has focus. Hairline-framed paper to match the Scriptorium
				chrome — fits in next to tldraw's own toolbar without competing
				visually.
			*/}
			<div className="absolute top-2 left-2 z-[450] flex items-center gap-2 px-3 py-1.5 bg-paper/90 backdrop-blur-[2px] border border-hairline rounded-sm">
				<a
					href="/dashboard"
					title="Back to dashboard"
					className="font-mono text-[11px] uppercase tracking-[0.22em] text-faded-ink hover:text-ink transition-colors flex items-center gap-1.5"
				>
					<span aria-hidden="true">‹</span>
					<span>Dashboard</span>
				</a>
				{canvasName && (
					<>
						<span
							className="w-px h-3 bg-hairline"
							aria-hidden="true"
						/>
						<span className="font-display text-[11px] uppercase tracking-[0.18em] text-ink">
							{canvasName}
						</span>
					</>
				)}
			</div>
		</div>
	)
}
