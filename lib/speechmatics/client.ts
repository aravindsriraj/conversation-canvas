import { RealtimeClient } from '@speechmatics/real-time-client'
import { PCMRecorder } from '@speechmatics/browser-audio-input'

export interface TranscriptSegment {
	speaker: string
	text: string
	isFinal: boolean
	ts: number
}

export type TranscriptHandler = (segment: TranscriptSegment) => void

export interface SpeechmaticsStreamHandle {
	stop: () => Promise<void>
	/**
	 * Live AnalyserNode tapped off the mic stream. UI layers can read
	 * time-domain data (`getByteTimeDomainData`) to draw a waveform without
	 * doing any extra audio plumbing. Optional because the analyser is wired
	 * up only after the recorder grants mic access — callers should null-check.
	 */
	analyser?: AnalyserNode
}

const LOG = '[speechmatics]'

// Speechmatics' own NextJS example uses the AudioWorklet shipped in
// `@speechmatics/browser-audio-input`. We copied the worklet script to
// `public/js/` so it's served from the same origin (AudioWorklets can't be
// cross-origin).
const WORKLET_URL = '/js/pcm-audio-worklet.min.js'

// Speechmatics recommendation: 16 kHz is the sweet spot for ASR. Higher is
// downsampled server-side; lower is also supported. Firefox doesn't let you
// override the AudioContext sample rate, so we leave it undefined there and
// read the actual rate after construction.
// Source: github.com/speechmatics/speechmatics-js-sdk examples/nextjs-real-time-transcription/lib/constants.ts
const RECORDING_SAMPLE_RATE =
	typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox')
		? undefined
		: 16_000

/**
 * Opens a direct WebSocket to Speechmatics Realtime and captures mic PCM
 * via the official AudioWorklet-based recorder (the ScriptProcessorNode
 * approach is deprecated and chops speech — Speechmatics docs say so
 * explicitly). Invokes `onTranscript` for every partial + final segment.
 *
 * Browser-only — requires `navigator.mediaDevices` and `AudioContext`.
 */
export async function startSpeechmaticsStream(
	onTranscript: TranscriptHandler,
): Promise<SpeechmaticsStreamHandle> {
	// 1. Mint an ephemeral JWT via our server-side endpoint.
	const tokenRes = await fetch('/api/speechmatics-token')
	if (!tokenRes.ok) {
		throw new Error(`speechmatics token request failed: ${tokenRes.status}`)
	}
	const { token } = (await tokenRes.json()) as { token: string }

	// 2. Build the Speechmatics realtime client + AudioContext (16 kHz) +
	//    PCMRecorder pointing at our copy of the worklet.
	const AudioCtor: typeof AudioContext =
		window.AudioContext ??
		(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
	const audioContext = new AudioCtor(
		RECORDING_SAMPLE_RATE ? { sampleRate: RECORDING_SAMPLE_RATE } : undefined,
	)
	const actualSampleRate = audioContext.sampleRate
	console.log(`${LOG} AudioContext sampleRate=${actualSampleRate} Hz`)

	const client = new RealtimeClient()
	const recorder = new PCMRecorder(WORKLET_URL)

	let messageCount = 0
	let audioFramesSent = 0

	client.addEventListener('socketStateChange', (evt: any) => {
		console.log(`${LOG} socket state →`, evt?.socketState)
	})

	client.addEventListener('receiveMessage', (evt: any) => {
		const data = evt?.data
		if (!data) return
		messageCount += 1
		// Log ALL messages except AudioAdded (which is acked-per-chunk and noisy).
		// In particular ALWAYS log AddPartialTranscript / AddTranscript so we can
		// see exactly what the server thinks we said (and confirm they arrive at all).
		if (data.message !== 'AudioAdded') {
			console.log(`${LOG} recv #${messageCount}:`, data.message, data)
		}
		if (data.message === 'Error') {
			console.error(`${LOG} server Error:`, data)
		}
		if (data.message === 'AddPartialTranscript' || data.message === 'AddTranscript') {
			const isFinal = data.message === 'AddTranscript'
			// Format 2.9 (current Speechmatics protocol) does NOT include a top-level
			// `transcript` string — we have to assemble the sentence from
			// `results[].alternatives[0].content`, mirroring the official Speechmatics
			// NextJS example's transcriptReducer. Punctuation results get no leading
			// space; word results get a single leading space (except the first token).
			const results: any[] = Array.isArray(data.results) ? data.results : []
			if (results.length === 0) return // no new content, skip

			let text = ''
			let firstSpeaker: string | undefined
			for (const r of results) {
				const alt = r?.alternatives?.[0]
				if (!alt?.content) continue
				if (!firstSpeaker && typeof alt.speaker === 'string') {
					firstSpeaker = alt.speaker
				}
				const isPunct = r.type === 'punctuation'
				text += isPunct || text.length === 0 ? alt.content : ` ${alt.content}`
			}

			text = text.trim()
			if (!text) return

			onTranscript({
				speaker: firstSpeaker ?? 'UU',
				text,
				isFinal,
				ts: Date.now(),
			})
		}
	})

	// 3. PCM frames from the worklet → Speechmatics socket. The worklet emits
	//    Float32Array payloads (32-bit float PCM). Per the Speechmatics official
	//    Next.js example, we pass the Float32Array DIRECTLY — not its underlying
	//    .buffer — so the bytes sent match the view's range exactly and don't
	//    accidentally include adjacent slots from a pooled ArrayBuffer.
	recorder.addEventListener('audio', (evt) => {
		try {
			// Copy into a tight, zero-offset ArrayBuffer. The worklet's Float32Array
			// may be a view into a larger pooled buffer (non-zero byteOffset, or
			// buffer.byteLength > byteLength). Sending the raw view is supposed to
			// only transmit `byteLength` bytes, but some WebSocket implementations
			// send the whole buffer. A tight copy removes all ambiguity.
			const tight = new ArrayBuffer(evt.data.byteLength)
			new Float32Array(tight).set(evt.data)
			client.sendAudio(tight)
			audioFramesSent += 1
			if (audioFramesSent === 1) {
				console.log(
					`${LOG} first audio frame sent (${evt.data.length} samples, ${evt.data.byteLength} bytes)`,
				)
			} else if (audioFramesSent % 200 === 0) {
				// Heartbeat every ~5s at 128 samples × 16kHz. Also report RMS / peak
				// so we can spot a silent or near-silent feed (which is what makes
				// Speechmatics return no transcripts).
				let peak = 0
				let sumSq = 0
				for (let i = 0; i < evt.data.length; i++) {
					const v = Math.abs(evt.data[i])
					if (v > peak) peak = v
					sumSq += evt.data[i] * evt.data[i]
				}
				const rms = Math.sqrt(sumSq / evt.data.length)
				console.log(
					`${LOG} ${audioFramesSent} frames sent  peak=${peak.toFixed(3)}  rms=${rms.toFixed(4)}  ${peak < 0.005 ? '⚠️ SILENT' : ''}`,
				)
			}
		} catch (err) {
			if (audioFramesSent === 0) {
				console.warn(`${LOG} sendAudio failed:`, err)
			}
		}
	})

	// 4. Open WS + send StartRecognition + wait for RecognitionStarted BEFORE
	//    starting the recorder. This guarantees no frames are produced while
	//    the socket isn't ready.
	console.log(`${LOG} starting recognition at ${actualSampleRate} Hz…`)
	await client.start(token, {
		transcription_config: {
			language: 'en',
			operating_point: 'enhanced',
			diarization: 'speaker',
			max_delay: 1,
			enable_partials: true,
		},
		audio_format: {
			type: 'raw',
			encoding: 'pcm_f32le',
			sample_rate: actualSampleRate,
		},
	})
	console.log(`${LOG} RecognitionStarted — starting recorder`)

	// 5. Start the official AudioWorklet recorder. PCMRecorder's defaults are
	//    { noiseSuppression: true, echoCancellation: true, autoGainControl: true }
	//    but `echoCancellation: true` is hostile to ASR when there's no far-end
	//    audio: Chrome's EC will aggressively flag your own voice as echo and
	//    near-silence the mic. Disabling it is critical.
	await recorder.startRecording({
		audioContext,
		recordingOptions: {
			echoCancellation: false,
			noiseSuppression: true,
			autoGainControl: true,
		},
	})

	let stopped = false
	return {
		// PCMRecorder builds its own AnalyserNode internally (see
		// node_modules/@speechmatics/browser-audio-input dist .d.ts: `get analyser`).
		// We expose it so the FAB can paint a live oscilloscope without spinning up
		// a second audio pipeline.
		analyser: recorder.analyser,
		stop: async () => {
			if (stopped) return
			stopped = true
			console.log(
				`${LOG} stopping (sent ${audioFramesSent} frames, recv ${messageCount} msgs)`,
			)
			try {
				recorder.stopRecording()
			} catch {
				// best-effort
			}
			try {
				await client.stopRecognition()
			} catch {
				// already closed
			}
			try {
				if (audioContext.state !== 'closed') await audioContext.close()
			} catch {
				// already closed
			}
		},
	}
}
