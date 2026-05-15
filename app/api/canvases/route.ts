import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import {
	createCanvas,
	ensureUser,
	listCanvasesByOwner,
} from '@/lib/db/canvases'
import { pickColorForClerkId } from '@/lib/db/user-color'

// Always run dynamically — every response depends on the auth context, never
// the prerender cache.
export const dynamic = 'force-dynamic'

function displayNameForUser(user: {
	firstName: string | null
	lastName: string | null
	username: string | null
	emailAddresses?: { emailAddress: string }[]
}): string {
	const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
	if (full) return full
	if (user.username) return user.username
	const email = user.emailAddresses?.[0]?.emailAddress
	if (email) return email.split('@')[0]
	return 'Anonymous'
}

export async function GET() {
	const { userId } = await auth()
	if (!userId) {
		return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
	}

	try {
		const canvases = await listCanvasesByOwner(userId)
		return NextResponse.json({
			canvases: canvases.map((c) => ({
				id: c.id,
				name: c.name,
				createdAt: c.created_at,
				updatedAt: c.updated_at,
			})),
		})
	} catch (err) {
		console.error('[api/canvases GET] failed:', err)
		return NextResponse.json({ error: 'internal error' }, { status: 500 })
	}
}

export async function POST(req: Request) {
	const { userId } = await auth()
	if (!userId) {
		return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
	}

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
		// Mirror the Clerk profile into our users table on first create. We pull
		// the user object directly (not just userId) so we have a display_name
		// and stable color to attribute future canvas actions to.
		const user = await currentUser()
		const displayName = user
			? displayNameForUser(user)
			: 'Anonymous'
		const color = pickColorForClerkId(userId)
		await ensureUser(userId, displayName, color)

		const canvas = await createCanvas(userId, name)
		return NextResponse.json(
			{
				id: canvas.id,
				name: canvas.name,
				createdAt: canvas.created_at,
				updatedAt: canvas.updated_at,
			},
			{ status: 201 },
		)
	} catch (err) {
		console.error('[api/canvases POST] failed:', err)
		return NextResponse.json({ error: 'internal error' }, { status: 500 })
	}
}
