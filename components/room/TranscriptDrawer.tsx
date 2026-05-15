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
	// Collapsed drawer becomes a thin 40px strip at the right edge so the user
	// can reclaim canvas real estate during demos. Mic FAB stays visible regardless.
	const [isOpen, setIsOpen] = useState(true)
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

	// Drawer geometry: 384px (w-96) when open, 40px sliver when collapsed.
	// We push the mic FAB inwards by that amount so it never sits underneath
	// the drawer panel.
	const drawerWidth = isOpen ? 384 : 40
	const fabRight = drawerWidth + 16

	return (
		<>
			{/*
				Floating mic FAB — moved from top-center to top-right in the Phase-3
				polish pass so it stops obscuring canvas content. It sits just to the
				left of the transcript drawer (offset by drawer width + 16px gutter)
				and follows the drawer when it collapses. Pinned to z-[500] which
				is above tldraw's overlay layer (~300).
			*/}
			<button
				type="button"
				onClick={recording ? stop : start}
				aria-label={recording ? 'Stop recording' : 'Start recording'}
				style={{ right: fabRight, transition: 'right 300ms ease' }}
				className={[
					'fixed top-4 z-[500]',
					'px-5 py-2.5 rounded-full text-sm font-semibold shadow-lg',
					'transition-colors flex items-center gap-2',
					recording
						? 'bg-red-600 text-white hover:bg-red-700 ring-2 ring-red-300 animate-pulse'
						: 'bg-zinc-900 text-white hover:bg-zinc-700',
				].join(' ')}
			>
				<span
					className={[
						'inline-block w-2.5 h-2.5 rounded-full',
						recording ? 'bg-white' : 'bg-red-500',
					].join(' ')}
				/>
				{recording ? 'Stop recording' : 'Start mic'}
			</button>

			<div
				style={{ width: drawerWidth, transition: 'width 300ms ease' }}
				className="fixed right-0 top-0 h-screen bg-white/95 backdrop-blur border-l border-zinc-200 z-[400] flex flex-col overflow-hidden"
			>
				{isOpen ? (
					<>
						<div className="p-3 border-b border-zinc-200 flex items-center justify-between gap-2">
							<button
								type="button"
								onClick={() => setIsOpen(false)}
								aria-label="Collapse transcript"
								className="px-2 py-1 rounded text-zinc-500 hover:bg-zinc-100 text-sm"
								title="Collapse"
							>
								›
							</button>
							<span className="font-semibold text-sm flex-1">Transcript</span>
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
									<span className="font-mono text-xs text-zinc-500 mr-2">
										[{s.speaker}]
									</span>
									{s.text}
								</div>
							))}
							<div ref={endRef} />
						</div>
					</>
				) : (
					// Collapsed sliver: 40px wide with a vertical "Transcript" label
					// and an expand button stacked at the top. Clicking anywhere on
					// the strip expands the drawer.
					<button
						type="button"
						onClick={() => setIsOpen(true)}
						aria-label="Expand transcript"
						className="w-full h-full flex flex-col items-center gap-3 py-3 hover:bg-zinc-50 transition-colors"
						title="Expand transcript"
					>
						<span className="text-zinc-500 text-sm" aria-hidden="true">
							‹
						</span>
						<span
							className="text-xs font-semibold tracking-wider text-zinc-600 uppercase"
							style={{ writingMode: 'vertical-rl' }}
						>
							Transcript
						</span>
					</button>
				)}
			</div>
		</>
	)
}
