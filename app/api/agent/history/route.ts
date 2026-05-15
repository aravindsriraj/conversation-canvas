import { auth } from '@clerk/nextjs/server'
import { getCanvasIfOwned } from '@/lib/db/canvases'
import { listChatTurns } from '@/lib/db/chat'

// Always dynamic — the answer depends on Clerk auth + per-canvas DB rows.
export const dynamic = 'force-dynamic'

/**
 * GET /api/agent/history?canvasId=<uuid>
 *
 * Returns this canvas's chat history (last 40 turns, oldest → newest) so
 * AgentPanel can re-populate its bubble list on page reload. The endpoint
 * mirrors the agent-POST auth flow exactly:
 *
 *   1. Clerk `auth()` from the Bearer JWT — 401 if unauth'd
 *   2. `getCanvasIfOwned` — 404 if no match OR not the owner (collapsed
 *      to prevent canvas-id enumeration)
 *
 * Response shape:
 *   { turns: [{ role, text, actionIds?, ts }, ...] }
 *
 * We deliberately do NOT need the in-memory `Room` instance here — the
 * DB is the source of truth and reading directly avoids the registry-
 * boot race that `/api/agent` has to guard against.
 */
export async function GET(req: Request) {
	const { userId } = await auth()
	if (!userId) {
		return new Response(JSON.stringify({ error: 'unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	const url = new URL(req.url)
	const canvasId = url.searchParams.get('canvasId')?.trim() ?? ''
	if (!canvasId) {
		return new Response(
			JSON.stringify({ error: 'canvasId query param required' }),
			{ status: 400, headers: { 'Content-Type': 'application/json' } },
		)
	}

	const canvas = await getCanvasIfOwned(canvasId, userId)
	if (!canvas) {
		return new Response(JSON.stringify({ error: 'not found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	const turns = await listChatTurns(canvasId, 40)
	return new Response(JSON.stringify({ turns }), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		},
	})
}
