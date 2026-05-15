'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
	startSpeechmaticsStream,
	type TranscriptSegment,
} from '@/lib/speechmatics/client'

interface Props {
	// React 19's `RefObject<T | null>` is the canonical writable ref type now —
	// `MutableRefObject` was unified into `RefObject` in the new @types/react.
	wsRef: React.RefObject<WebSocket | null>
	roomId: string
	// The agent panel toggle lives in the same top-center toolbar group as the
	// mic + transcript buttons. We delegate state up to CanvasRoot so the
	// panel and the toolbar pill stay in sync.
	agentOpen?: boolean
	onToggleAgent?: () => void
}

/*
 * TranscriptDrawer — minimal chrome.
 *
 *   · Top-center mic pill (idle "Listen" · recording shows live oscilloscope).
 *   · A small "Show transcript" toggle next to the pill.
 *   · Transcript drawer is HIDDEN by default. When opened, it slides up from
 *     the bottom edge as a 240px strip with backdrop-blur so canvas peeks
 *     through. Click anywhere on the close button (or press Esc) to dismiss.
 *
 * Transcript content is aggregated into utterance bubbles:
 *   · Consecutive segments from the same speaker within 2.5s of each other
 *     are merged into a single sentence-paragraph. No more "Travel / Policy /
 *     Update" three-line fragments — they become "...Travel Policy Update".
 *   · Speaker chip on the left, sentence text on the right.
 *   · No line numbers. Whitespace and paragraph breaks carry the structure.
 */
export function TranscriptDrawer({
	wsRef,
	roomId,
	agentOpen,
	onToggleAgent,
}: Props) {
	const [segments, setSegments] = useState<TranscriptSegment[]>([])
	const [recording, setRecording] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [isOpen, setIsOpen] = useState(false)
	const [elapsedSec, setElapsedSec] = useState(0)
	const stopRef = useRef<(() => Promise<void>) | null>(null)
	const bodyRef = useRef<HTMLDivElement>(null)
	const analyserRef = useRef<AnalyserNode | null>(null)
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const rafRef = useRef<number | null>(null)
	const startTsRef = useRef<number | null>(null)

	const utterances = useMemo(() => aggregateUtterances(segments, 2500), [segments])

	useEffect(() => {
		// Auto-scroll to bottom when new content arrives — only while open.
		if (!isOpen) return
		bodyRef.current?.scrollTo({
			top: bodyRef.current.scrollHeight,
			behavior: 'smooth',
		})
	}, [utterances, isOpen])

	useEffect(() => {
		// Make sure mic + audio context get released if the component unmounts mid-recording.
		return () => {
			stopRef.current?.().catch(() => undefined)
			stopRef.current = null
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
		}
	}, [])

	// Esc closes the drawer.
	useEffect(() => {
		if (!isOpen) return
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setIsOpen(false)
		}
		window.addEventListener('keydown', handler)
		return () => window.removeEventListener('keydown', handler)
	}, [isOpen])

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

		analyser.fftSize = 256
		const sampleCount = 128
		const buffer = new Uint8Array(sampleCount)

		const dpr = window.devicePixelRatio || 1
		const cssW = canvas.clientWidth || 28
		const cssH = canvas.clientHeight || 14
		canvas.width = Math.round(cssW * dpr)
		canvas.height = Math.round(cssH * dpr)
		ctx.scale(dpr, dpr)

		const draw = () => {
			analyser.getByteTimeDomainData(buffer)
			ctx.clearRect(0, 0, cssW, cssH)

			ctx.strokeStyle = 'rgba(220, 211, 192, 0.6)'
			ctx.lineWidth = 0.5
			ctx.beginPath()
			ctx.moveTo(0, cssH / 2)
			ctx.lineTo(cssW, cssH / 2)
			ctx.stroke()

			ctx.strokeStyle = '#B82626'
			ctx.lineWidth = 1.5
			ctx.lineJoin = 'round'
			ctx.lineCap = 'round'
			ctx.beginPath()
			const step = cssW / (sampleCount - 1)
			for (let i = 0; i < sampleCount; i++) {
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
					if (prev.length > 0 && !prev[prev.length - 1].isFinal) {
						return [...prev.slice(0, -1), seg]
					}
					return [...prev, seg]
				})
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

	return (
		<>
			{/* ── Top-center toolbar: mic FAB + transcript toggle ────────── */}
			<div className="fixed top-4 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-2">
				<button
					type="button"
					onClick={recording ? stop : start}
					aria-label={recording ? 'Stop recording' : 'Start recording'}
					className={[
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
							<span className="font-mono text-[10px] tabular-nums opacity-70 ml-1">
								{formatElapsed(elapsedSec)}
							</span>
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

				{/* Show-transcript toggle. Quietly available; not the loud part of the UI. */}
				<button
					type="button"
					onClick={() => setIsOpen((v) => !v)}
					aria-label={isOpen ? 'Hide transcript' : 'Show transcript'}
					aria-pressed={isOpen}
					title={isOpen ? 'Hide transcript (Esc)' : 'Show transcript'}
					className={[
						'px-3 py-2 rounded-sm border bg-paper',
						'font-display text-[10px] uppercase tracking-[0.22em]',
						'transition-colors',
						isOpen
							? 'border-ink text-ink'
							: 'border-hairline text-faded-ink hover:text-ink hover:border-ink',
					].join(' ')}
				>
					{utterances.length > 0 && (
						<span className="font-mono text-faded-ink mr-1.5 tabular-nums">
							{utterances.length}
						</span>
					)}
					Transcript
				</button>

				{/*
					"Ask AI" pill — third member of the toolbar group, opens the
					right-side agent panel. The leading ochre dot mirrors the
					crimson recording dot pattern but in a more reflective
					editorial tone so the agent feels like a different kind of
					presence than the microphone.
				*/}
				{onToggleAgent ? (
					<button
						type="button"
						onClick={onToggleAgent}
						aria-label={agentOpen ? 'Hide AI panel' : 'Show AI panel'}
						aria-pressed={!!agentOpen}
						title={agentOpen ? 'Hide AI (Esc)' : 'Ask AI'}
						className={[
							'px-3 py-2 rounded-sm border bg-paper',
							'flex items-center gap-2',
							'font-display text-[10px] uppercase tracking-[0.22em]',
							'transition-colors',
							agentOpen
								? 'border-ink text-ink'
								: 'border-hairline text-faded-ink hover:text-ink hover:border-ink',
						].join(' ')}
					>
						<span
							className="w-1.5 h-1.5 bg-ochre rounded-full"
							aria-hidden="true"
						/>
						Ask AI
					</button>
				) : null}
			</div>

			{/* ── Bottom slide-up drawer ─────────────────────────────────── */}
			<div
				className="fixed left-0 right-0 bottom-0 z-[400] border-t border-hairline bg-paper/95 backdrop-blur flex flex-col"
				style={{
					height: 240,
					transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
					transition: 'transform 280ms cubic-bezier(.22,.61,.36,1)',
					boxShadow: isOpen
						? '0 -8px 30px -20px rgba(26,24,21,0.25)'
						: 'none',
				}}
				aria-hidden={!isOpen}
			>
				{/* Header */}
				<div className="px-6 py-3 border-b border-hairline flex items-center gap-3 shrink-0">
					<span className="font-display text-[11px] uppercase tracking-[0.22em] text-ink">
						Transcript
					</span>
					<span className="font-mono text-[11px] text-faded-ink tabular-nums">
						{recording ? formatElapsed(elapsedSec) : '—'}
					</span>
					{utterances.length > 0 && (
						<span className="font-mono text-[10px] text-faded-ink uppercase tracking-[0.18em] ml-2">
							· {utterances.length} utterance{utterances.length === 1 ? '' : 's'}
						</span>
					)}
					<button
						type="button"
						onClick={() => setIsOpen(false)}
						aria-label="Close transcript"
						className="ml-auto font-mono text-[11px] uppercase tracking-[0.18em] text-faded-ink hover:text-ink"
					>
						Close · Esc
					</button>
				</div>

				{error ? (
					<div className="px-6 py-2 text-[11px] font-mono text-crimson bg-paper border-b border-crimson shrink-0">
						{error}
					</div>
				) : null}

				{/* Body — aggregated utterance bubbles. */}
				<div
					ref={bodyRef}
					className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3"
				>
					{utterances.length === 0 ? (
						<div className="text-faded-ink text-[11px] font-mono italic">
							{recording
								? 'Listening — speak to begin transcribing.'
								: 'Click "Listen" above to start recording.'}
						</div>
					) : (
						// Single-user mode: every utterance is the logged-in user, so
						// we drop the speaker chip — it'd just be the same name (or
						// "S1") repeated on every line. The body reads cleanly as one
						// voice now. Diarization stays ON internally so the
						// orchestrator can still cluster fragments into utterances.
						utterances.map((u) => (
							<p
								key={u.key}
								className={`font-mono text-[13px] leading-[1.55] m-0 ${
									u.isFinal ? 'text-ink' : 'text-faded-ink'
								}`}
							>
								{u.text}
							</p>
						))
					)}
				</div>
			</div>
		</>
	)
}

interface Utterance {
	key: string
	speaker: string
	text: string
	isFinal: boolean
	ts: number
}

/**
 * Group consecutive same-speaker segments within `gapMs` into a single
 * utterance. Punctuation tokens merge without a leading space; word tokens
 * get one space of separation. The trailing partial (if any) stays its own
 * utterance so the reader sees ink-not-yet-dry styling on the live row.
 */
function aggregateUtterances(
	segments: readonly TranscriptSegment[],
	gapMs: number,
): Utterance[] {
	if (segments.length === 0) return []
	const out: Utterance[] = []

	for (const seg of segments) {
		const last = out[out.length - 1]
		const isPunct = /^[.,!?;:]+$/.test(seg.text.trim())
		const canMerge =
			last !== undefined &&
			last.isFinal === seg.isFinal &&
			last.speaker === seg.speaker &&
			seg.ts - last.ts <= gapMs

		if (canMerge) {
			last.text = isPunct ? last.text + seg.text : `${last.text} ${seg.text}`
			last.ts = seg.ts
		} else {
			out.push({
				key: `${seg.speaker}-${seg.ts}-${out.length}`,
				speaker: seg.speaker,
				text: seg.text,
				isFinal: seg.isFinal,
				ts: seg.ts,
			})
		}
	}

	return out
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
