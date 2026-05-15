import { auth, currentUser } from '@clerk/nextjs/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCanvasIfOwned } from '@/lib/db/canvases'
import { pickColorForClerkId } from '@/lib/db/user-color'
import { RoomShell } from './RoomShell'

// Server-side gate. Three outcomes:
//  - no auth        → redirect to /sign-in (preserves URL via Clerk redirect)
//  - canvas missing → render the "not found / no access" leaflet below
//  - canvas owned   → render the live RoomShell with auto-enrolled identity

export const dynamic = 'force-dynamic'

export default async function RoomPage({
	params,
}: {
	params: Promise<{ roomId: string }>
}) {
	const { roomId } = await params
	const { userId } = await auth()
	if (!userId) {
		redirect('/sign-in')
	}

	const canvas = await getCanvasIfOwned(roomId, userId)
	if (!canvas) {
		return <CanvasNotFound />
	}

	// Pull Clerk profile for the auto-enroll display name. We don't push the
	// session token from here — the client fetches a fresh one via useAuth()
	// on the WS open handler (Clerk tokens have a 60s TTL).
	const user = await currentUser()
	const displayName = displayNameForUser(user)
	const color = pickColorForClerkId(userId)

	return (
		<RoomShell
			roomId={roomId}
			canvasName={canvas.name}
			enrollment={{ name: displayName, color }}
		/>
	)
}

function displayNameForUser(
	user: {
		firstName: string | null
		lastName: string | null
		username: string | null
		emailAddresses?: { emailAddress: string }[]
	} | null,
): string {
	if (!user) return 'Anonymous'
	const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
	if (full) return full
	if (user.username) return user.username
	const email = user.emailAddresses?.[0]?.emailAddress
	if (email) return email.split('@')[0]
	return 'Anonymous'
}

function CanvasNotFound() {
	return (
		<div className="min-h-screen w-full bg-paper text-ink flex flex-col">
			<header className="border-b border-hairline">
				<div className="max-w-[1200px] mx-auto px-8 py-4 flex items-center justify-between">
					<Link href="/" className="flex items-center gap-3">
						<span className="w-1 h-1 bg-olive" aria-hidden="true" />
						<span className="font-display text-[14px] uppercase tracking-[0.22em] text-ink">
							Conversation Canvas
						</span>
					</Link>
					<div className="font-mono text-[10px] uppercase tracking-[0.18em] text-faded-ink">
						404
					</div>
				</div>
			</header>
			<main className="flex-1 flex items-center justify-center px-8">
				<div className="max-w-[480px] text-center">
					<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-6">
						§ Out of scope
					</div>
					<h1
						className="font-display font-light text-ink mb-6"
						style={{ fontSize: '40px', lineHeight: 1, letterSpacing: '-0.02em' }}
					>
						Canvas not found.
					</h1>
					<p className="text-[15px] leading-[1.55] text-faded-ink mb-10">
						This canvas doesn’t exist, or it isn’t yours. The library only shows
						canvases you own.
					</p>
					<Link href="/dashboard" className="cta-primary group">
						<span className="cta-bar" aria-hidden="true" />
						<span>Back to dashboard</span>
					</Link>
				</div>
			</main>
		</div>
	)
}
