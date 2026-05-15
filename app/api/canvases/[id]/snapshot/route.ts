import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { saveSnapshot } from '@/lib/db/canvases'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/canvases/:id/snapshot
 *
 * Replaces the canvas's serialized tldraw `document` snapshot. Body shape:
 *
 *   { document: <whatever getSnapshot(editor.store).document returns> }
 *
 * The client calls this every ~2s during active editing (debounced) and on
 * tab close (via sendBeacon, which fires-and-forgets even during page unload).
 *
 * Auth: must be signed in via Clerk AND own the canvas. 401 on no auth, 404
 * on either "no such canvas" OR "not owner" (collapsed to prevent ID
 * enumeration).
 */
export async function PUT(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { userId } = await auth()
	if (!userId) {
		return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
	}

	const { id } = await params
	let body: unknown
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'invalid json' }, { status: 400 })
	}

	const document = (body as { document?: unknown })?.document
	if (document === undefined || document === null) {
		return NextResponse.json(
			{ error: 'missing document in body' },
			{ status: 400 },
		)
	}

	const ok = await saveSnapshot(id, userId, document)
	if (!ok) {
		return NextResponse.json({ error: 'not found' }, { status: 404 })
	}

	return NextResponse.json({ ok: true })
}
