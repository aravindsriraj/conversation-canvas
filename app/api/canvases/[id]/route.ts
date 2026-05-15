import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { deleteCanvas, renameCanvas } from '@/lib/db/canvases'

export const dynamic = 'force-dynamic'

// Both PATCH and DELETE pass the userId through to the DB helper, so the
// ownership check is enforced server-side at the query level (not just at the
// route boundary). Returns 404 on either not-found OR not-owner — matches
// the rule in getCanvasIfOwned.

export async function PATCH(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { userId } = await auth()
	if (!userId) {
		return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
	}
	const { id } = await params

	let body: { name?: unknown }
	try {
		body = await req.json()
	} catch {
		return NextResponse.json({ error: 'bad json' }, { status: 400 })
	}
	const name = typeof body.name === 'string' ? body.name.trim() : ''
	if (!name || name.length > 120) {
		return NextResponse.json(
			{ error: 'name is required (1–120 chars)' },
			{ status: 400 },
		)
	}

	try {
		const updated = await renameCanvas(id, userId, name)
		if (!updated) {
			return NextResponse.json({ error: 'not found' }, { status: 404 })
		}
		return NextResponse.json({
			id: updated.id,
			name: updated.name,
			createdAt: updated.created_at,
			updatedAt: updated.updated_at,
		})
	} catch (err) {
		console.error('[api/canvases PATCH] failed:', err)
		return NextResponse.json({ error: 'internal error' }, { status: 500 })
	}
}

export async function DELETE(
	_req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { userId } = await auth()
	if (!userId) {
		return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
	}
	const { id } = await params

	try {
		const ok = await deleteCanvas(id, userId)
		if (!ok) {
			return NextResponse.json({ error: 'not found' }, { status: 404 })
		}
		return NextResponse.json({ ok: true })
	} catch (err) {
		console.error('[api/canvases DELETE] failed:', err)
		return NextResponse.json({ error: 'internal error' }, { status: 500 })
	}
}
