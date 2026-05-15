import { RealtimeClient } from '@speechmatics/real-time-client'

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

/**
 * Opens a direct WebSocket to Speechmatics Realtime, captures mic audio at 16kHz
 * mono float32 PCM, and invokes `onTranscript` for every partial + final segment.
 *
 * Token is fetched from `/api/speechmatics-token` (server mints a short-lived JWT).
 * Diarization is on, so each segment carries a speaker label (e.g. "S1").
 *
 * Browser-only — relies on `navigator.mediaDevices` and `AudioContext`.
 */
export async function startSpeechmaticsStream(
	onTranscript: TranscriptHandler,
): Promise<SpeechmaticsStreamHandle> {
	const tokenRes = await fetch('/api/speechmatics-token')
	if (!tokenRes.ok) {
		throw new Error(`speechmatics token request failed: ${tokenRes.status}`)
	}
	const { token } = (await tokenRes.json()) as { token: string }

	const client = new RealtimeClient()

	const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

	// Asking the AudioContext for 16kHz lets the browser downsample for us so we
	// can ship pcm_f32le @ 16kHz to Speechmatics without writing our own resampler.
	const AudioCtor: typeof AudioContext =
		window.AudioContext ??
		(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
	const ctx = new AudioCtor({ sampleRate: 16000 })
	const source = ctx.createMediaStreamSource(stream)
	// ScriptProcessorNode is deprecated but adequate for hackathon-speed work.
	const processor = ctx.createScriptProcessor(4096, 1, 1)
	source.connect(processor)
	processor.connect(ctx.destination)

	// `receiveMessage` is the single firehose event for every server message.
	// We branch on `data.message` to handle partial/final transcripts.
	client.addEventListener('receiveMessage', (evt: any) => {
		const data = evt?.data
		if (!data) return
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

	await client.start(token, {
		transcription_config: {
			language: 'en',
			operating_point: 'enhanced',
			diarization: 'speaker',
			max_delay: 2,
			enable_partials: true,
		},
		audio_format: { type: 'raw', encoding: 'pcm_f32le', sample_rate: 16000 },
	})

	processor.onaudioprocess = (e) => {
		const channel = e.inputBuffer.getChannelData(0)
		// Float32Array buffers are transferable; sendAudio accepts ArrayBuffer-like data.
		client.sendAudio(channel.buffer.slice(0))
	}

	let stopped = false
	return {
		stop: async () => {
			if (stopped) return
			stopped = true
			try {
				processor.onaudioprocess = null
				processor.disconnect()
				source.disconnect()
			} catch {
				// best-effort teardown
			}
			for (const track of stream.getTracks()) {
				track.stop()
			}
			try {
				await client.stopRecognition()
			} catch {
				// Server may already be closed; ignore.
			}
			try {
				await ctx.close()
			} catch {
				// already closed
			}
		},
	}
}
