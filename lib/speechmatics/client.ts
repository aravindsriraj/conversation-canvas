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
		if (messageCount <= 5 || data.message === 'Error') {
			console.log(`${LOG} recv #${messageCount}:`, data.message, data.type ?? '')
		}
		if (data.message === 'Error') {
			console.error(`${LOG} server Error:`, data)
		}
		if (data.message === 'AddPartialTranscript' || data.message === 'AddTranscript') {
			const isFinal = data.message === 'AddTranscript'
			for (const r of data.results ?? []) {
				const alt = r.alternatives?.[0]
				if (!alt?.content) continue
				onTranscript({
					speaker: alt.speaker ?? 'UU',
					text: alt.content,
					isFinal,
					ts: Date.now(),
				})
			}
		}
	})

	// 3. PCM frames from the worklet → Speechmatics socket. The worklet emits
	//    `audio` events with Float32Array payloads (32-bit float PCM). We forward
	//    each chunk verbatim; `sendAudio` accepts BufferSource on the browser side.
	recorder.addEventListener('audio', (evt) => {
		try {
			client.sendAudio(evt.data.buffer.slice(0))
			audioFramesSent += 1
			if (audioFramesSent === 1) {
				console.log(`${LOG} first audio frame sent (${evt.data.length} samples)`)
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

	// 5. Start the official AudioWorklet recorder. It internally handles
	//    permission prompt, AudioWorklet registration, and PCM extraction.
	await recorder.startRecording({
		audioContext,
		// Speechmatics' defaults: noiseSuppression, echoCancellation, autoGainControl all on
		// (optimal for ASR). Override here only if we hit problems.
	})

	let stopped = false
	return {
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
