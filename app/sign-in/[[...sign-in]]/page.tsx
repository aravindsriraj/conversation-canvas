import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'

// Catch-all `[[...sign-in]]` so Clerk can mount its own internal routes for
// MFA / verification / SSO callback paths under /sign-in. Same pattern for
// /sign-up below.
export default function SignInPage() {
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
						Sign in
					</div>
				</div>
			</header>
			<main className="flex-1 flex items-center justify-center px-8 py-16">
				<SignIn />
			</main>
		</div>
	)
}
