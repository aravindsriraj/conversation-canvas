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

interface Enrollment {
	name: string
	color: string
}

interface RoomShellProps {
	roomId: string
	canvasName: string
	enrollment: Enrollment
}

// Phase 4 onward: auth is handled by the server component (page.tsx) and
// the Clerk session is the source of truth for identity, so there's no
// manual join form. The enrollment payload is derived from the Clerk profile
// + a deterministic palette color in the server component.
export function RoomShell({ roomId, canvasName, enrollment }: RoomShellProps) {
	return (
		<CanvasRoot
			roomId={roomId}
			canvasName={canvasName}
			enrollment={enrollment}
		/>
	)
}
