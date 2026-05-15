'use client'

import { useCallback } from 'react'
import { type Editor, Tldraw } from 'tldraw'
import { TranscriptDrawer } from '@/components/room/TranscriptDrawer'

interface CanvasRootProps {
	roomId: string
}

export function CanvasRoot({ roomId }: CanvasRootProps) {
	const onMount = useCallback(
		(editor: Editor) => {
			// Subscriber wiring lands in Task 2.x — for now just confirm mount.
			console.log('Canvas mounted for room', roomId, editor)
		},
		[roomId],
	)

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw onMount={onMount} />
			<TranscriptDrawer />
		</div>
	)
}
