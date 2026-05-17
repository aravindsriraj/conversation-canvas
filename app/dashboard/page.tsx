import { UserButton } from '@clerk/nextjs'
import { auth } from '@clerk/nextjs/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CanvasCard } from '@/components/dashboard/CanvasCard'
import { NewCanvasButton } from '@/components/dashboard/NewCanvasButton'
import { listCanvasesByOwner } from '@/lib/db/canvases'

// Server component — the auth gate is the redirect below. If Clerk middleware
// is wired correctly, `auth()` returns the userId; if not we punt to /sign-in.
// We deliberately don't render any UI before the auth check.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
	const { userId } = await auth()
	if (!userId) {
		redirect('/sign-in')
	}

	const canvases = await listCanvasesByOwner(userId)

	return (
		<div className="min-h-screen w-full bg-paper text-ink">
			<header className="sticky top-0 z-50 backdrop-blur-[2px] bg-paper/70 border-b border-hairline">
				<div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
					<Link href="/" className="flex items-center gap-3">
						<span className="w-1 h-1 bg-olive" aria-hidden="true" />
						<span className="font-display text-[14px] uppercase tracking-[0.22em] text-ink">
							Conversation Canvas
						</span>
					</Link>
					<div className="flex items-center gap-6">
						<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faded-ink">
							Dashboard
						</span>
						<UserButton />
					</div>
				</div>
			</header>

			<main className="max-w-[1200px] mx-auto px-5 sm:px-8 py-16">
				<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-6">
					No. 01 · Your canvases
				</div>
				<h1
					className="font-display font-light text-ink mb-12"
					style={{
						fontSize: 'clamp(36px, 5vw, 56px)',
						lineHeight: 1,
						letterSpacing: '-0.02em',
					}}
				>
					Library
				</h1>

				<div className="mb-10">
					<NewCanvasButton />
				</div>

				{canvases.length === 0 ? (
					<div className="border-t border-hairline pt-10">
						<div className="font-mono text-[10px] uppercase tracking-[0.18em] text-faded-ink mb-3">
							§ Empty shelf
						</div>
						<p className="text-[17px] leading-[1.55] text-faded-ink max-w-[540px]">
							No canvases yet — start your first meeting and the orchestrator
							will compose a typed record of what was decided.
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{canvases.map((c) => (
							<CanvasCard
								key={c.id}
								canvas={{
									id: c.id,
									name: c.name,
									createdAt: c.created_at.toISOString(),
									updatedAt: c.updated_at.toISOString(),
									stats: {
										actionCount: c.action_count,
										proposals: c.proposals,
										decisions: c.decisions,
										notes: c.notes,
										links: c.links,
									},
								}}
							/>
						))}
					</div>
				)}
			</main>
		</div>
	)
}
