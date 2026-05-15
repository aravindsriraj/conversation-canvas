'use client'

import dynamic from 'next/dynamic'

// tldraw must not be prerendered on the server. `ssr: false` is allowed here
// because this file is a Client Component (Next 16 requirement).
const CanvasRoot = dynamic(
	() => import('@/components/canvas/CanvasRoot').then((m) => m.CanvasRoot),
	{
		ssr: false,
		loading: () => <div className="p-6 text-zinc-500">Loading canvas…</div>,
	},
)

export function CanvasLoader({ roomId }: { roomId: string }) {
	return <CanvasRoot roomId={roomId} />
}
