import type { Metadata } from 'next'
import { Fraunces, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google'
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

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html
			lang="en"
			className={`h-full ${fraunces.variable} ${plex.variable} ${jetbrains.variable}`}
		>
			<body className="min-h-full flex flex-col bg-paper text-ink font-sans antialiased">
				{children}
			</body>
		</html>
	)
}
