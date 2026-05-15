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

/*
 * TranscriptDrawer — recording-FAB + right-side drawer.
 *
 * Scriptorium pass:
 *   · FAB pill: idle reads "Listen"; recording swaps to a live oscilloscope
 *     drawn from the PCMRecorder's AnalyserNode, plus a "Recording" label.
 *   · Drawer header: Fraunces small-caps title · mono `mm:ss` timer · stop
 *     button retreats to a hairline icon button on the right.
 *   · Body: mono transcript, line numbers in the gutter, speaker tag in small
 *     caps Fraunces, hairline column separator. Partials use text-faded-ink
 *     ("ink not yet dry"). Background = repeating ruled-paper hairlines.
 *   · Collapsed state: Fraunces small-caps vertical label.
 *   · Errors: crimson on paper, never red-on-red.
 */
export function TranscriptDrawer({ wsRef, roomId }: Props) {
	const [segments, setSegments] = useState<TranscriptSegment[]>([])
	const [recording, setRecording] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [isOpen, setIsOpen] = useState(true)
	const [elapsedSec, setElapsedSec] = useState(0)
	const stopRef = useRef<(() => Promise<void>) | null>(null)
	const endRef = useRef<HTMLDivElement>(null)
	const analyserRef = useRef<AnalyserNode | null>(null)
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const rafRef = useRef<number | null>(null)
	const startTsRef = useRef<number | null>(null)

	useEffect(() => {
		// Auto-scroll to bottom when new segments arrive.
		endRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [segments])

	useEffect(() => {
		// Make sure mic + audio context get released if the component unmounts mid-recording.
		return () => {
			stopRef.current?.().catch(() => undefined)
			stopRef.current = null
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
		}
	}, [])

	// ── recording timer ────────────────────────────────────────────────
	useEffect(() => {
		if (!recording) return
		startTsRef.current = Date.now()
		setElapsedSec(0)
		const id = window.setInterval(() => {
			if (startTsRef.current != null) {
				setElapsedSec(Math.floor((Date.now() - startTsRef.current) / 1000))
			}
		}, 500)
		return () => {
			window.clearInterval(id)
			startTsRef.current = null
		}
	}, [recording])

	// ── oscilloscope animation ────────────────────────────────────────
	useEffect(() => {
		if (!recording || !analyserRef.current || !canvasRef.current) return
		const analyser = analyserRef.current
		const canvas = canvasRef.current
		const ctx = canvas.getContext('2d')
		if (!ctx) return

		// 128 samples is more than enough for a 28×14 px trace. We use the byte
		// time-domain endpoint (cheaper than float, zero-allocation per frame).
		analyser.fftSize = 256
		const sampleCount = 128
		const buffer = new Uint8Array(sampleCount)

		// Crisp on hi-DPI — paint at the device pixel ratio, then draw in CSS px.
		const dpr = window.devicePixelRatio || 1
		const cssW = canvas.clientWidth || 28
		const cssH = canvas.clientHeight || 14
		canvas.width = Math.round(cssW * dpr)
		canvas.height = Math.round(cssH * dpr)
		ctx.scale(dpr, dpr)

		const draw = () => {
			analyser.getByteTimeDomainData(buffer)
			ctx.clearRect(0, 0, cssW, cssH)

			// Hairline midline — the "rule" on the precision instrument.
			ctx.strokeStyle = 'rgba(220, 211, 192, 0.6)' // hairline @ 60%
			ctx.lineWidth = 0.5
			ctx.beginPath()
			ctx.moveTo(0, cssH / 2)
			ctx.lineTo(cssW, cssH / 2)
			ctx.stroke()

			// Crimson trace.
			ctx.strokeStyle = '#B82626'
			ctx.lineWidth = 1.5
			ctx.lineJoin = 'round'
			ctx.lineCap = 'round'
			ctx.beginPath()
			const step = cssW / (sampleCount - 1)
			for (let i = 0; i < sampleCount; i++) {
				// Byte time-domain values run 0..255 centered at 128.
				const v = (buffer[i] - 128) / 128
				const x = i * step
				const y = cssH / 2 + v * (cssH / 2) * 0.9
				if (i === 0) ctx.moveTo(x, y)
				else ctx.lineTo(x, y)
			}
			ctx.stroke()

			rafRef.current = requestAnimationFrame(draw)
		}
		rafRef.current = requestAnimationFrame(draw)
		return () => {
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
			rafRef.current = null
		}
	}, [recording])

	async function start() {
		setError(null)
		try {
			const handle = await startSpeechmaticsStream((seg) => {
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
			stopRef.current = handle.stop
			analyserRef.current = handle.analyser ?? null
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
		analyserRef.current = null
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

	// Reset line numbering each session by collapsing speakers per line.
	return (
		<>
			{/* ── Mic FAB (idle: "Listen" · recording: oscilloscope) ────── */}
			<button
				type="button"
				onClick={recording ? stop : start}
				aria-label={recording ? 'Stop recording' : 'Start recording'}
				style={{ right: fabRight, transition: 'right 300ms ease' }}
				className={[
					'fixed top-4 z-[500]',
					'px-4 py-2 rounded-sm border',
					'flex items-center gap-2.5',
					'font-display text-[11px] uppercase tracking-[0.18em]',
					'transition-colors',
					recording
						? 'bg-paper border-crimson text-crimson'
						: 'bg-ink border-ink text-paper hover:bg-[#2a2723]',
				].join(' ')}
			>
				{recording ? (
					<>
						<canvas
							ref={canvasRef}
							width={28}
							height={14}
							style={{ width: 28, height: 14, display: 'block' }}
							aria-hidden="true"
						/>
						<span>Recording</span>
					</>
				) : (
					<>
						<span
							className="w-1.5 h-1.5 bg-crimson rounded-full"
							aria-hidden="true"
						/>
						<span>Listen</span>
					</>
				)}
			</button>

			<div
				style={{ width: drawerWidth, transition: 'width 300ms ease' }}
				className="fixed right-0 top-0 h-screen bg-paper/95 backdrop-blur border-l border-hairline z-[400] flex flex-col overflow-hidden"
			>
				{isOpen ? (
					<>
						{/* Header: small caps title · mono timer · collapse / stop icons */}
						<div className="px-4 pt-4 pb-3 border-b border-hairline flex items-center gap-3">
							<button
								type="button"
								onClick={() => setIsOpen(false)}
								aria-label="Collapse transcript"
								className="text-faded-ink hover:text-ink text-sm leading-none"
								title="Collapse"
							>
								›
							</button>
							<span className="font-display text-[11px] uppercase tracking-[0.22em] text-ink">
								Transcript
							</span>
							<span className="ml-auto font-mono text-[11px] text-faded-ink tabular-nums">
								{formatElapsed(elapsedSec)}
							</span>
							{recording && (
								<button
									type="button"
									onClick={stop}
									aria-label="Stop recording"
									title="Stop"
									className="w-5 h-5 grid place-items-center border border-crimson text-crimson hover:bg-crimson hover:text-paper transition-colors"
								>
									<span
										className="w-2 h-2 bg-crimson"
										style={{ display: 'block' }}
										aria-hidden="true"
									/>
								</button>
							)}
						</div>
						{error ? (
							<div className="px-4 py-2 text-[11px] font-mono text-crimson bg-paper border-b border-crimson">
								{error}
							</div>
						) : null}
						{/* Ruled-paper body: hairline rule every 28 px. */}
						<div
							className="flex-1 overflow-y-auto py-3"
							style={{
								backgroundImage:
									'repeating-linear-gradient(to bottom, transparent 0, transparent 27px, rgba(220,211,192,0.45) 27px, rgba(220,211,192,0.45) 28px)',
							}}
						>
							{segments.length === 0 ? (
								<div className="px-4 text-faded-ink text-[11px] font-mono italic">
									Click "Listen" to begin transcribing.
								</div>
							) : null}
							<ol className="m-0 p-0 list-none">
								{segments.map((s, i) => (
									<li
										// biome-ignore lint/suspicious/noArrayIndexKey: append-only list, index is stable
										key={i}
										className="grid grid-cols-[28px_28px_1fr] items-baseline px-3"
										style={{ minHeight: 28 }}
									>
										<span className="font-mono text-[10px] text-faded-ink text-right pr-2 leading-[28px] tabular-nums">
											{String(i + 1).padStart(2, '0')}
										</span>
										<span className="font-display text-[11px] uppercase tracking-[0.12em] text-ink border-r border-hairline pr-2 leading-[28px]">
											{s.speaker}
										</span>
										<span
											className={`font-mono text-[12px] pl-2 leading-[28px] ${
												s.isFinal ? 'text-ink' : 'text-faded-ink'
											}`}
										>
											{s.text}
										</span>
									</li>
								))}
							</ol>
							<div ref={endRef} />
						</div>
					</>
				) : (
					// Collapsed sliver: 40px wide with a vertical small-caps Fraunces
					// "Transcript" label. Clicking expands the drawer.
					<button
						type="button"
						onClick={() => setIsOpen(true)}
						aria-label="Expand transcript"
						className="w-full h-full flex flex-col items-center gap-4 py-4 hover:bg-paper/80 transition-colors"
						title="Expand transcript"
					>
						<span className="text-faded-ink text-sm" aria-hidden="true">
							‹
						</span>
						<span
							className="font-display text-[11px] uppercase tracking-[0.32em] text-ink"
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

/**
 * `mm:ss` for short sessions, `hh:mm:ss` once we cross an hour. Pads the way
 * a stopwatch does so the digits don't jitter as the clock advances.
 */
function formatElapsed(totalSec: number): string {
	const s = totalSec % 60
	const m = Math.floor(totalSec / 60) % 60
	const h = Math.floor(totalSec / 3600)
	const pad = (n: number) => String(n).padStart(2, '0')
	return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
