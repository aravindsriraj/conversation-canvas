'use client'

import { useCallback, useRef } from 'react'
import { createShapeId, type Editor, Tldraw } from 'tldraw'
import { ProposalCardUtil } from '@/components/canvas/shapes/ProposalCard'
import { TranscriptDrawer } from '@/components/room/TranscriptDrawer'

const customShapeUtils = [ProposalCardUtil]

interface CanvasRootProps {
	roomId: string
}

export function CanvasRoot({ roomId: _roomId }: CanvasRootProps) {
	const editorRef = useRef<Editor | null>(null)

	const onMount = useCallback((editor: Editor) => {
		editorRef.current = editor
	}, [])

	const testCreate = useCallback(() => {
		const editor = editorRef.current
		if (!editor) return
		editor.createShape({
			id: createShapeId(),
			type: 'proposal-card',
			x: 100 + Math.random() * 300,
			y: 100 + Math.random() * 200,
			props: {
				w: 280,
				h: 140,
				content: 'Target enterprise customers in Q3 — focus on top 100 accounts.',
				proposerName: 'Alice',
				proposerColor: '#6366f1',
				status: 'open',
				ts: Date.now(),
			},
		})
	}, [])

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw onMount={onMount} shapeUtils={customShapeUtils} />
			<button
				type="button"
				onClick={testCreate}
				className="fixed bottom-4 left-4 z-50 px-3 py-2 rounded bg-indigo-600 text-white text-sm shadow"
			>
				+ Test proposal card
			</button>
			<TranscriptDrawer />
		</div>
	)
}
