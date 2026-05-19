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

// One-time, per-browser flag for the first-canvas tutorial. We store the
// literal '1' rather than a JSON-encoded boolean so the absence-of-key vs.
// false-value distinction is unambiguous, and to keep the value tiny so it
// doesn't bloat the localStorage quota on shared devices.
const TUTORIAL_SEEN_KEY = 'conversation-canvas:tutorial-seen'

export function CanvasRoot({ roomId, canvasName, enrollment }: CanvasRootProps) {
	const editorRef = useRef<Editor | null>(null)
	const wsRef = useRef<WebSocket | null>(null)
	const [speakers, setSpeakers] = useState<SpeakerRegistry>({})
	const [accessError, setAccessError] = useState<string | null>(null)
	const [agentOpen, setAgentOpen] = useState(false)
	// Autosave status pill — flips through 'saving' → 'saved' → 'idle'
	// as the snapshot debouncer fires. Visible near the canvas-name pill
	// so users can see persistence happening without taking it on faith.
	const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>(
		'idle',
	)
	// True once the canvas has at least one shape (either from history
	// replay or from a fresh user edit). Drives the empty-canvas hint
	// overlay below.
	const [hasShapes, setHasShapes] = useState(false)
	// First-canvas tutorial: shown ONCE per browser (localStorage-gated)
	// for users who've never used the app before. Sits in the bottom-left
	// so it doesn't fight with the centered empty-canvas hint; auto-dismisses
	// the moment a shape appears OR on explicit close. Default false; the
	// effect below flips it on for first-time visitors.
	const [showTutorial, setShowTutorial] = useState(false)
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

	// Track whether the canvas has any shapes. Drives the empty-state hint.
	// We poll for the editor to mount (the prop callback fires async after
	// <Tldraw> renders), then attach a document-scope listener that
	// recomputes after every shape change.
	useEffect(() => {
		let attachInterval: ReturnType<typeof setInterval> | null = null
		let unsubscribe: (() => void) | null = null
		const tick = () => {
			const editor = editorRef.current
			if (!editor) return
			setHasShapes(editor.getCurrentPageShapes().length > 0)
		}
		attachInterval = setInterval(() => {
			const editor = editorRef.current
			if (!editor) return
			if (attachInterval) clearInterval(attachInterval)
			attachInterval = null
			tick()
			unsubscribe = editor.store.listen(tick, { scope: 'document' })
		}, 80)
		return () => {
			if (attachInterval) clearInterval(attachInterval)
			unsubscribe?.()
		}
	}, [])

	// First-canvas tutorial gate. Reads the localStorage flag once on mount;
	// if the user has never seen the tutorial, show it. We don't gate on
	// hasShapes because a returning user with prior canvases (i.e. has
	// content here) shouldn't see the walkthrough — we ALSO check hasShapes
	// in the render path so the tutorial never overlays an active canvas.
	useEffect(() => {
		if (typeof window === 'undefined') return
		try {
			if (window.localStorage.getItem(TUTORIAL_SEEN_KEY) !== '1') {
				setShowTutorial(true)
			}
		} catch {
			// localStorage can throw in private browsing — degrade silently;
			// the tutorial won't show but the app still works.
		}
	}, [])

	const dismissTutorial = useCallback(() => {
		setShowTutorial(false)
		try {
			window.localStorage.setItem(TUTORIAL_SEEN_KEY, '1')
		} catch {}
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

		// Auto-hide timer for the "Saved" status pill. We don't want it
		// flashing every 1.5s during a busy edit session — only when the
		// burst has actually settled.
		let savedTimer: ReturnType<typeof setTimeout> | null = null

		const saveNow = async () => {
			if (cancelled) return
			const editor = editorRef.current
			if (!editor) return
			if (!hasLoadedRef.current) return
			setSaveStatus('saving')
			try {
				const { document } = getSnapshot(editor.store)
				const token = await getToken().catch(() => null)
				if (!token) {
					setSaveStatus('idle')
					return
				}
				await fetch(`/api/canvases/${roomId}/snapshot`, {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ document }),
				})
				setSaveStatus('saved')
				if (savedTimer) clearTimeout(savedTimer)
				savedTimer = setTimeout(() => {
					if (!cancelled) setSaveStatus('idle')
				}, 1800)
			} catch (err) {
				console.warn('[canvas] snapshot save failed', err)
				setSaveStatus('idle')
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
					console.log(
						`[canvas] WS ${m.kind} n=${actions.length} editor=${!!editor}`,
					)
					if (!editor) {
						// If the editor hasn't mounted yet (race during page load), the
						// history is dropped. The server replays history only on join,
						// so this only matters when there's pre-existing room state at
						// load time. Demo flows start with an empty room, so acceptable.
						console.warn(
							`[canvas] WS ${m.kind} arrived BEFORE editor mounted — dropping ${actions.length} action(s). This is the bug if you see it on a fresh empty room.`,
						)
						return
					}
					let appliedAny = false
					// Wrap the batch in editor.run so all shape changes from
					// one server message land as a single undo entry — three
					// agent-emitted cards = one Ctrl+Z to reverse, not three.
					editor.run(() => {
						for (const a of actions) {
							try {
								applyAction(editor, a, speakersRef.current)
								appliedAny = true
								console.log(
									`[canvas] applied ${a.type}${'id' in a ? ` ${a.id}` : ''}`,
								)
							} catch (err) {
								console.error('[canvas] applyAction failed', err, a)
							}
						}
					})
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
				<Tldraw
					onMount={onMount}
					shapeUtils={customShapeUtils}
					// tldraw v5 added a production licensing model. Without a
					// licenseKey you get a console warning and a "Get a
					// license" watermark on the canvas. Set
					// NEXT_PUBLIC_TLDRAW_LICENSE_KEY in env (free non-commercial
					// keys at tldraw.dev/community/license) to clear both.
					// Falls back to no key, which still renders normally but
					// keeps the watermark.
					licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
				/>
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
				editorRef={editorRef}
			/>
			{/*
				Top-left navigation pill: back link to dashboard + canvas name
				+ autosave status. Sits above tldraw's z-stack so it stays
				clickable even when the editor has focus.
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
				{/*
					Autosave indicator — visible while a snapshot save is in
					flight ("Saving") and for ~1.8s after a successful save
					("Saved"). Hidden in idle state so the pill doesn't carry
					a permanent low-signal label.
				*/}
				{saveStatus !== 'idle' && (
					<>
						<span className="w-px h-3 bg-hairline" aria-hidden="true" />
						<span
							className={`font-mono text-[10px] uppercase tracking-[0.18em] flex items-center gap-1.5 transition-opacity ${
								saveStatus === 'saving' ? 'text-faded-ink' : 'text-olive'
							}`}
						>
							<span
								className={`w-1.5 h-1.5 rounded-full ${
									saveStatus === 'saving' ? 'bg-ochre' : 'bg-olive'
								}`}
								aria-hidden="true"
							/>
							{saveStatus === 'saving' ? 'Saving' : 'Saved'}
						</span>
					</>
				)}
			</div>

			{/*
				Empty-canvas hint — visible only when the canvas truly has no
				shapes yet. Auto-dismisses the moment the first shape lands
				(via the `hasShapes` listener above). Centered overlay,
				pointer-events: none so the user can still pan/zoom through
				it. Lives below tldraw's z-stack so the toolbars float above.
			*/}
			{!hasShapes && (
				<div
					className="absolute inset-0 pointer-events-none flex items-center justify-center"
					style={{ right: agentOpen ? 360 : 0, transition: 'right 280ms cubic-bezier(.22,.61,.36,1)' }}
				>
					<div className="max-w-[440px] text-center px-8">
						<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-4">
							§ Empty canvas
						</div>
						<h2 className="font-display italic text-[28px] leading-[1.25] tracking-tight text-ink mb-5">
							Hit <span className="not-italic">Listen</span> and start talking.
						</h2>
						<p className="font-sans text-[14px] leading-[1.55] text-faded-ink mb-6">
							The canvas will turn what you say into typed cards as
							you go. Or click <span className="text-ink">Ask AI</span>{' '}
							to type instructions instead.
						</p>
						<div className="font-mono text-[11px] leading-[1.7] text-faded-ink/80">
							<div>"Draw a flowchart from idea to launch."</div>
							<div>"Add a sticky for the post-Q3 review."</div>
							<div>"Rank these by impact and effort."</div>
						</div>
					</div>
				</div>
			)}

			{/*
				First-canvas tutorial. Visible only on a first-time visit
				(localStorage gated) AND while the canvas is still empty.
				Sits in the bottom-left so it doesn't fight with the
				centered empty-canvas hint. Pointer-events: auto on the
				card itself so the dismiss button works, but the wrapper
				is transparent and lets clicks fall through to tldraw.
			*/}
			{showTutorial && !hasShapes && (
				<div className="absolute left-6 bottom-6 pointer-events-none z-30">
					<div
						className="pointer-events-auto bg-paper border border-hairline shadow-[0_4px_24px_rgba(0,0,0,0.06)] rounded-sm w-[280px] tutorial-in"
					>
						<div className="px-4 py-3 border-b border-hairline flex items-center justify-between">
							<span className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink">
								§ First time here
							</span>
							<button
								type="button"
								onClick={dismissTutorial}
								aria-label="Dismiss tutorial"
								className="font-mono text-[10px] uppercase tracking-[0.18em] text-faded-ink hover:text-ink"
							>
								Close
							</button>
						</div>
						<ol className="px-4 py-4 flex flex-col gap-3 font-sans text-[13px] leading-[1.45] text-ink/85">
							<li className="flex gap-3">
								<span className="font-mono text-[10px] tracking-[0.1em] text-olive shrink-0 mt-[2px]">
									01
								</span>
								<span>
									Hit <span className="font-medium">Listen</span> (top right) so the canvas can hear what you're saying.
								</span>
							</li>
							<li className="flex gap-3">
								<span className="font-mono text-[10px] tracking-[0.1em] text-olive shrink-0 mt-[2px]">
									02
								</span>
								<span>
									Talk normally — proposals, decisions and action items show up as you speak.
								</span>
							</li>
							<li className="flex gap-3">
								<span className="font-mono text-[10px] tracking-[0.1em] text-olive shrink-0 mt-[2px]">
									03
								</span>
								<span>
									Open <span className="font-medium">Ask AI</span> to refine the board by typing.
								</span>
							</li>
						</ol>
						<div className="px-4 pb-4">
							<button
								type="button"
								onClick={dismissTutorial}
								className="w-full font-mono text-[11px] uppercase tracking-[0.18em] text-paper bg-ink hover:bg-olive transition-colors py-2 rounded-sm"
							>
								Got it
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
