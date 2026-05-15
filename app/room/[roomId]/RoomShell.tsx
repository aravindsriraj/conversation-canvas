'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { RoomJoin } from '@/components/room/RoomJoin'

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
	slot: 'S0' | 'S1'
}

function storageKey(roomId: string) {
	return `cc:enrollment:${roomId}`
}

export function RoomShell({ roomId }: { roomId: string }) {
	const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
	const [hydrated, setHydrated] = useState(false)

	// Restore prior enrollment for this room on first mount so refreshes don't
	// re-prompt the user.
	useEffect(() => {
		try {
			const raw = localStorage.getItem(storageKey(roomId))
			if (raw) {
				const parsed = JSON.parse(raw) as Enrollment
				if (
					parsed &&
					typeof parsed.name === 'string' &&
					typeof parsed.color === 'string' &&
					(parsed.slot === 'S0' || parsed.slot === 'S1')
				) {
					setEnrollment(parsed)
				}
			}
		} catch {
			// localStorage unavailable / corrupt — fall through to the join form.
		}
		setHydrated(true)
	}, [roomId])

	const handleJoin = (name: string, color: string, slot: 'S0' | 'S1') => {
		const next: Enrollment = { name, color, slot }
		try {
			localStorage.setItem(storageKey(roomId), JSON.stringify(next))
		} catch {
			// Non-fatal; persistence is best-effort.
		}
		setEnrollment(next)
	}

	if (!hydrated) {
		// Avoid flashing the join form before we know whether enrollment exists.
		return <div className="p-6 text-zinc-500">Loading…</div>
	}

	if (!enrollment) {
		return <RoomJoin onJoin={handleJoin} />
	}

	return <CanvasRoot roomId={roomId} enrollment={enrollment} />
}
