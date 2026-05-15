'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { type Editor, Tldraw } from 'tldraw'
import { BlockerCardUtil } from '@/components/canvas/shapes/BlockerCard'
import { CommitmentCardUtil } from '@/components/canvas/shapes/CommitmentCard'
import { DecisionCardUtil } from '@/components/canvas/shapes/DecisionCard'
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
]

type SpeakerRegistry = Record<string, { displayName: string; color: string }>

interface CanvasRootProps {
	roomId: string
}

export function CanvasRoot({ roomId }: CanvasRootProps) {
	const editorRef = useRef<Editor | null>(null)
	const wsRef = useRef<WebSocket | null>(null)
	const [speakers, setSpeakers] = useState<SpeakerRegistry>({})
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
		const url = process.env.NEXT_PUBLIC_WS_URL || `ws://${location.host}/ws`
		const ws = new WebSocket(url)
		wsRef.current = ws

		ws.onopen = () => {
			ws.send(JSON.stringify({ kind: 'join', roomId }))
		}
		ws.onmessage = (evt) => {
			let msg: unknown
			try {
				msg = JSON.parse(typeof evt.data === 'string' ? evt.data : '')
			} catch {
				return
			}
			if (!msg || typeof msg !== 'object') return
			const m = msg as { kind?: string; actions?: Action[]; registry?: SpeakerRegistry }
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
				for (const a of actions) {
					try {
						applyAction(editor, a, speakersRef.current)
					} catch (err) {
						console.error('[canvas] applyAction failed', err, a)
					}
				}
			} else if (m.kind === 'speakers' && m.registry) {
				setSpeakers(m.registry)
			}
		}
		return () => {
			ws.close()
			wsRef.current = null
		}
	}, [roomId])

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw onMount={onMount} shapeUtils={customShapeUtils} />
			<TranscriptDrawer wsRef={wsRef} roomId={roomId} />
		</div>
	)
}
