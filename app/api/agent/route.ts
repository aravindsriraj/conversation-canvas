import { auth } from '@clerk/nextjs/server'
import { getCanvasIfOwned } from '@/lib/db/canvases'
import { runAgentTurn } from '@/lib/agent/runner'
import { getRegistry } from '@server/registry-singleton'

// Always dynamic — every response depends on Clerk auth context and live
// in-memory Room state. Never cacheable.
export const dynamic = 'force-dynamic'

/**
 * Agent chat endpoint.
 *
 *   POST /api/agent
 *   Body: { canvasId: string, message: string }
 *
 * Response: 200 application/x-ndjson, newline-separated JSON events.
 * Each line is one of:
 *   { kind: 'text', delta: string }              — chat reply token
 *   { kind: 'action', action: Action }           — typed action emitted
 *                                                  (already broadcast via WS)
 *   { kind: 'done' }                             — end of stream
 *   { kind: 'error', message: string }           — non-fatal warning
 *
 * Auth: Clerk session via `auth()`. 401 if unauth'd. `getCanvasIfOwned`
 * collapses "not found" with "not yours" → 404.
 *
 * Side effects: actions emitted by the agent are recorded into the canvas
 * action log (via `Room.recordAction` → Postgres) and broadcast to all
 * connected WS clients (same path the voice orchestrator uses). The HTTP
 * client receives an `action` event mostly for display — the canvas itself
 * updates via the WS round-trip.
 */
export async function POST(req: Request) {
	const { userId } = await auth()
	if (!userId) {
		return new Response(JSON.stringify({ error: 'unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	let body: {
		canvasId?: unknown
		message?: unknown
		canvasImage?: unknown
	}
	try {
		body = await req.json()
	} catch {
		return new Response(JSON.stringify({ error: 'bad json' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	const canvasId =
		typeof body.canvasId === 'string' ? body.canvasId.trim() : ''
	const message =
		typeof body.message === 'string' ? body.message.trim() : ''
	if (!canvasId || !message) {
		return new Response(
			JSON.stringify({ error: 'canvasId and message required' }),
			{ status: 400, headers: { 'Content-Type': 'application/json' } },
		)
	}
	if (message.length > 2000) {
		return new Response(
			JSON.stringify({ error: 'message too long (max 2000 chars)' }),
			{ status: 400, headers: { 'Content-Type': 'application/json' } },
		)
	}
	// Optional multimodal grounding: client may attach a PNG screenshot of
	// the live canvas as a data URL. We only accept data-URL form (so we
	// don't accidentally fetch a remote URL on the server), and we cap
	// total payload at ~3 MB to keep the model call cheap and predictable.
	const canvasImage =
		typeof body.canvasImage === 'string' &&
		body.canvasImage.startsWith('data:image/') &&
		body.canvasImage.length <= 4_000_000
			? body.canvasImage
			: undefined

	const canvas = await getCanvasIfOwned(canvasId, userId)
	if (!canvas) {
		return new Response(JSON.stringify({ error: 'not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	const registry = getRegistry()
	if (!registry) {
		// Server boot race — extremely unlikely in practice. Return 503 so
		// the client can retry; we don't want to silently drop the chat turn.
		return new Response(
			JSON.stringify({ error: 'service starting, retry' }),
			{ status: 503, headers: { 'Content-Type': 'application/json' } },
		)
	}
	const room = registry.getOrCreate(canvasId)
	// Ensure history is loaded before we read it in `buildAgentContext`.
	// `hydrate()` is idempotent — subsequent calls resolve immediately.
	await room.hydrate()

	const encoder = new TextEncoder()
	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: Record<string, unknown>) => {
				controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
			}

			// Accumulate text + emitted action ids for the chat-history record.
			let assistantText = ''
			const emittedActionIds: string[] = []
			room.recordChatTurn({
				role: 'user',
				text: message,
				ts: Date.now(),
			})

			try {
				for await (const evt of runAgentTurn(room, message, {
					canvasImage,
				})) {
					if (evt.kind === 'text') {
						assistantText += evt.delta
						send({ kind: 'text', delta: evt.delta })
					} else if (evt.kind === 'action') {
						if ('id' in evt.action) {
							emittedActionIds.push(evt.action.id)
						}
						send({ kind: 'action', action: evt.action })
					} else if (evt.kind === 'error') {
						send({ kind: 'error', message: evt.message })
					} else if (evt.kind === 'done') {
						send({ kind: 'done' })
					}
				}
			} catch (err) {
				console.error('[api/agent] stream error', err)
				send({
					kind: 'error',
					message:
						err instanceof Error
							? err.message
							: 'unknown error',
				})
				send({ kind: 'done' })
			} finally {
				room.recordChatTurn({
					role: 'assistant',
					text: assistantText,
					actionIds:
						emittedActionIds.length > 0
							? emittedActionIds
							: undefined,
					ts: Date.now(),
				})
				controller.close()
			}
		},
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson; charset=utf-8',
			'Cache-Control': 'no-store',
			// Disable buffering at intermediate proxies — we want the client
			// to see deltas in real time.
			'X-Accel-Buffering': 'no',
		},
	})
}
