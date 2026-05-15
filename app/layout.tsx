import type { Metadata } from 'next'
import 'tldraw/tldraw.css'
import './globals.css'

export const metadata: Metadata = {
	title: 'Conversation Canvas',
	description: 'Speak. The canvas listens, structures, and draws.',
}

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className="h-full antialiased">
			<body className="min-h-full flex flex-col">{children}</body>
		</html>
	)
}
