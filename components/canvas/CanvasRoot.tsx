'use client'

import { useAuth } from '@clerk/nextjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type Editor, Tldraw } from 'tldraw'
import { BlockerCardUtil } from '@/components/canvas/shapes/BlockerCard'
import { BudgetAllocatorUtil } from '@/components/canvas/shapes/BudgetAllocator'
import { CommitmentCardUtil } from '@/components/canvas/shapes/CommitmentCard'
import { DecisionCardUtil } from '@/components/canvas/shapes/DecisionCard'
import { PriorityMatrixUtil } from '@/components/canvas/shapes/PriorityMatrix'
import { ProposalCardUtil } from '@/components/canvas/shapes/ProposalCard'
import { QuestionCardUtil } from '@/components/canvas/shapes/QuestionCard'
import { TranscriptDrawer } from '@/components/room/TranscriptDrawer'
import { applyAction } from '@/lib/actions/apply'
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
	const { isLoaded, isSignedIn, getToken } = useAuth()
	// We keep a ref alongside the state so the WS message handler reads the
	// latest registry without forcing the WS effect to re-run (which would
	// tear down the socket on every speaker update — undesired).
	const speakersRef = useRef<SpeakerRegistry>({})

	useEffect(() => {
		speakersRef.current = speakers
	}, [speakers])

	const onMount = useCallback((editor: Editor) => {
		editorRef.current = editor
	}, [])

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
				// Auto-enroll using the Clerk-derived identity (server resolved
				// firstName/fullName/username/email + deterministic color). No
				// manual form anymore now that we have a real authenticated user.
				ws?.send(
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
				if (m.kind === 'history' || m.kind === 'actions') {
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
			<Tldraw onMount={onMount} shapeUtils={customShapeUtils} />
			<TranscriptDrawer wsRef={wsRef} roomId={roomId} />
			{canvasName && (
				<div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-50 px-3 py-1 bg-paper/80 border border-hairline rounded-sm font-display text-[11px] uppercase tracking-[0.18em] text-ink">
					{canvasName}
				</div>
			)}
		</div>
	)
}
