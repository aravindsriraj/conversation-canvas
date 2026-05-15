'use client'

import { useEffect, useRef, useState } from 'react'
import {
	startSpeechmaticsStream,
	type TranscriptSegment,
} from '@/lib/speechmatics/client'

interface Props {
	// React 19's `RefObject<T | null>` is the canonical writable ref type now —
	// `MutableRefObject` was unified into `RefObject` in the new @types/react.
	wsRef: React.RefObject<WebSocket | null>
	roomId: string
}

export function TranscriptDrawer({ wsRef, roomId }: Props) {
	const [segments, setSegments] = useState<TranscriptSegment[]>([])
	const [recording, setRecording] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const stopRef = useRef<(() => Promise<void>) | null>(null)
	const endRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		// Auto-scroll to bottom when new segments arrive.
		endRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [segments])

	useEffect(() => {
		// Make sure mic + audio context get released if the component unmounts mid-recording.
		return () => {
			stopRef.current?.().catch(() => undefined)
			stopRef.current = null
		}
	}, [])

	async function start() {
		setError(null)
		try {
			const { stop } = await startSpeechmaticsStream((seg) => {
				setSegments((prev) => {
					// Replace the trailing partial segment with the new partial or finalize it,
					// otherwise append. This keeps the live row updating in place.
					if (prev.length > 0 && !prev[prev.length - 1].isFinal) {
						return [...prev.slice(0, -1), seg]
					}
					return [...prev, seg]
				})
				// Forward finals to the server so the orchestrator can buffer them.
				// readyState 1 === OPEN; silently skip if the WS hasn't connected yet.
				if (seg.isFinal && wsRef.current?.readyState === 1) {
					wsRef.current.send(
						JSON.stringify({ kind: 'transcript', roomId, payload: seg }),
					)
				}
			})
			stopRef.current = stop
			setRecording(true)
		} catch (err) {
			console.error('[transcript-drawer] failed to start mic stream', err)
			setError(err instanceof Error ? err.message : 'failed to start microphone')
			setRecording(false)
		}
	}

	async function stop() {
		const fn = stopRef.current
		stopRef.current = null
		setRecording(false)
		if (fn) {
			try {
				await fn()
			} catch (err) {
				console.error('[transcript-drawer] stop failed', err)
			}
		}
	}

	return (
		<div className="fixed right-0 top-0 h-screen w-96 bg-white/95 backdrop-blur border-l border-zinc-200 z-50 flex flex-col">
			<div className="p-3 border-b border-zinc-200 flex items-center justify-between">
				<span className="font-semibold text-sm">Transcript</span>
				<button
					type="button"
					onClick={recording ? stop : start}
					className="px-3 py-1 rounded text-sm bg-zinc-900 text-white hover:bg-zinc-700"
				>
					{recording ? 'Stop' : 'Start mic'}
				</button>
			</div>
			{error ? (
				<div className="px-3 py-2 text-xs text-red-700 bg-red-50 border-b border-red-100">
					{error}
				</div>
			) : null}
			<div className="flex-1 overflow-y-auto p-3 space-y-1 text-sm">
				{segments.length === 0 ? (
					<div className="text-zinc-400 text-xs italic">
						Click "Start mic" to begin transcribing.
					</div>
				) : null}
				{segments.map((s, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: append-only list, index is stable
						key={i}
						className={s.isFinal ? '' : 'opacity-60'}
					>
						<span className="font-mono text-xs text-zinc-500 mr-2">[{s.speaker}]</span>
						{s.text}
					</div>
				))}
				<div ref={endRef} />
			</div>
		</div>
	)
}
