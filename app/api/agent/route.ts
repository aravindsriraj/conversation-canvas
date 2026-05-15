import { auth } from '@clerk/nextjs/server'
import type { Action } from '@/lib/actions/schema'
import { ActionSchema } from '@/lib/actions/schema'
import { getCanvasIfOwned } from '@/lib/db/canvases'
import { getRegistry } from '@server/registry-singleton'

// Always dynamic — every response depends on the Clerk auth context and the
// live in-memory Room state. Never cacheable.
export const dynamic = 'force-dynamic'

/**
 * Phase 1 stub for the agent chat endpoint.
 *
 * Contract:
 *   POST /api/agent
 *   Body: { canvasId: string, message: string }
 *
 *   Response: 200 application/x-ndjson, newline-separated JSON events.
 *   Each line is one of:
 *     { kind: 'text', delta: string }              — chat reply token
 *     { kind: 'action', action: Action }           — typed action emitted
 *     { kind: 'done' }                             — end of stream
 *     { kind: 'error', message: string }           — terminal error
 *
 * Auth: Clerk session via `auth()`. 401 if not signed in. Then
 * `getCanvasIfOwned` ensures the user owns the target canvas (404 otherwise —
 * collapsed with "not found" to keep canvas ids unenumerable).
 *
 * For each emitted action we ALSO write it through the shared `RoomRegistry`
 * so the WS server broadcasts it to all connected clients (same path the
 * voice orchestrator uses). The HTTP client only receives a notification
 * event for display in the chat panel; it does NOT need to round-trip the
 * action through its own WS.
 *
 * Phase 1 behavior: echoes a hardcoded question_card action so the wiring
 * (auth → registry → broadcast) can be verified end to end before plugging
 * in the real LLM in Phase 3.
 */
export async function POST(req: Request) {
	const { userId } = await auth()
	if (!userId) {
		return new Response(JSON.stringify({ error: 'unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	let body: { canvasId?: unknown; message?: unknown }
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

	// Ownership check. Collapses "not found" and "not yours" into 404 so
	// canvas ids stay unenumerable.
	const canvas = await getCanvasIfOwned(canvasId, userId)
	if (!canvas) {
		return new Response(JSON.stringify({ error: 'not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	const registry = getRegistry()
	if (!registry) {
		// Server boot race — extremely unlikely in practice. Return 503 so the
		// client can retry; we don't want to silently drop the chat turn.
		return new Response(
			JSON.stringify({ error: 'service starting, retry' }),
			{ status: 503, headers: { 'Content-Type': 'application/json' } },
		)
	}
	const room = registry.getOrCreate(canvasId)
	// Make sure the action history is loaded before we start emitting — Phase
	// 2 will use it for prompt context. Also avoids racing recordAction
	// against the initial hydrate sequence the WS join handler does.
	await room.hydrate()

	const encoder = new TextEncoder()
	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: Record<string, unknown>) => {
				controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
			}
			try {
				// Phase 1: emit a single echo text token + a single hardcoded
				// question card so the full pipe (HTTP → registry → WS) is
				// exercised. Phase 3 swaps this for the real Gemini call.
				const reply = `Echo: ${message}`
				for (const chunk of chunkString(reply, 24)) {
					send({ kind: 'text', delta: chunk })
					// Small spacing so the UI reads as "streaming" rather than
					// instant. 30ms is below the perceptual threshold for "fast
					// typing", which feels alive without being annoying.
					await sleep(30)
				}

				const stubAction: Action = ActionSchema.parse({
					type: 'create_question_card',
					id: `agent-q-${Date.now().toString(36)}`,
					askedBySpeakerId: 'S1',
					content: `Agent echo: ${message.slice(0, 200)}`,
				})

				// Persist + broadcast through the same Room the WS server owns.
				// Voice orchestrator uses this exact pair (recordAction +
				// broadcast({kind:'actions'})) so the client's existing
				// applyAction path handles agent-emitted shapes for free.
				room.recordAction(stubAction)
				room.broadcast({ kind: 'actions', actions: [stubAction] })
				send({ kind: 'action', action: stubAction })

				send({ kind: 'done' })
			} catch (err) {
				console.error('[api/agent] stream error', err)
				send({
					kind: 'error',
					message:
						err instanceof Error ? err.message : 'unknown error',
				})
			} finally {
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

function chunkString(s: string, size: number): string[] {
	const out: string[] = []
	for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
	return out
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms))
}
