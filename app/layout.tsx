import type { Metadata } from 'next'
import { Fraunces, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import 'tldraw/tldraw.css'
import './globals.css'

// Fraunces — variable axis display face (headings, category labels, stamps).
// Carries the editorial / 19th-century court-reporter feel.
const fraunces = Fraunces({
	subsets: ['latin'],
	variable: '--font-fraunces',
	display: 'swap',
	axes: ['opsz', 'SOFT'],
})

// IBM Plex Sans — workhorse body. Hand-set humanist sans, reads on paper.
const plex = IBM_Plex_Sans({
	subsets: ['latin'],
	variable: '--font-plex',
	display: 'swap',
	weight: ['300', '400', '500', '600'],
})

// JetBrains Mono — utility: timestamps, IDs, transcript, numeric columns.
const jetbrains = JetBrains_Mono({
	subsets: ['latin'],
	variable: '--font-mono',
	display: 'swap',
})

export const metadata: Metadata = {
	title: 'Conversation Canvas',
	description: 'Speak. The canvas listens, structures, and draws.',
}

// Clerk's prebuilt components ship their own visual language. We override the
// pieces that show through (card chrome, primary buttons, headings, inputs) to
// match Scriptorium's paper + ink + hairline-border tokens. We can't reference
// CSS variables here because Clerk's `appearance.elements` evaluates strings
// at render time inside its own shadow boundary, so the hex values are
// duplicated from globals.css — keep them in sync.
const clerkAppearance = {
	elements: {
		rootBox: 'font-sans',
		card: 'bg-paper border border-hairline shadow-none rounded-sm',
		headerTitle: 'font-display tracking-tight text-ink',
		headerSubtitle: 'text-faded-ink',
		socialButtonsBlockButton:
			'border border-hairline bg-paper text-ink hover:border-ink',
		formButtonPrimary:
			'bg-ink text-paper hover:bg-ink/90 rounded-sm font-display uppercase tracking-[0.15em] text-[12px]',
		formFieldInput:
			'border border-hairline bg-paper text-ink rounded-sm focus:border-ink',
		footerActionLink: 'text-olive hover:text-ink',
		dividerLine: 'bg-hairline',
		dividerText: 'text-faded-ink font-mono uppercase tracking-[0.18em]',
		userButtonAvatarBox: 'rounded-full',
		userButtonPopoverCard: 'bg-paper border border-hairline rounded-sm',
	},
}

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html
			lang="en"
			className={`h-full ${fraunces.variable} ${plex.variable} ${jetbrains.variable}`}
		>
			<body className="min-h-full flex flex-col bg-paper text-ink font-sans antialiased">
				<ClerkProvider appearance={clerkAppearance} afterSignOutUrl="/">
					{children}
				</ClerkProvider>
			</body>
		</html>
	)
}
