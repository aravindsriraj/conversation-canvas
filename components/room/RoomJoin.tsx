'use client'

import { useState } from 'react'

const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#0ea5e9', '#a855f7']

interface Props {
	onJoin: (name: string, color: string, speakerSlot: 'S0' | 'S1') => void
}

export function RoomJoin({ onJoin }: Props) {
	const [name, setName] = useState('')
	const [color, setColor] = useState(COLORS[0])
	const [slot, setSlot] = useState<'S0' | 'S1'>('S0')

	return (
		<div className="fixed inset-0 grid place-items-center bg-gradient-to-br from-zinc-100 to-zinc-200">
			<form
				onSubmit={(e) => {
					e.preventDefault()
					if (name) onJoin(name, color, slot)
				}}
				className="w-96 bg-white rounded-xl shadow-lg p-6 flex flex-col gap-4 border border-zinc-200"
			>
				<h2 className="text-lg font-semibold">Join the canvas</h2>
				<label className="text-sm flex flex-col gap-1">
					Your display name
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="border border-zinc-300 rounded px-2 py-1.5 text-sm"
						placeholder="Alice"
						autoFocus
					/>
				</label>
				<div className="flex flex-col gap-1">
					<span className="text-sm">Your color</span>
					<div className="flex gap-2">
						{COLORS.map((c) => (
							<button
								key={c}
								type="button"
								onClick={() => setColor(c)}
								aria-label={`Pick color ${c}`}
								className={`w-6 h-6 rounded-full ${
									color === c ? 'ring-2 ring-offset-2 ring-zinc-900' : ''
								}`}
								style={{ background: c }}
							/>
						))}
					</div>
				</div>
				<label className="text-sm flex flex-col gap-1">
					Speaker slot (for diarization mapping)
					<select
						value={slot}
						onChange={(e) => setSlot(e.target.value as 'S0' | 'S1')}
						className="border border-zinc-300 rounded px-2 py-1.5 text-sm"
					>
						<option value="S0">Speaker 1 (S0)</option>
						<option value="S1">Speaker 2 (S1)</option>
					</select>
				</label>
				<button
					type="submit"
					disabled={!name}
					className="bg-zinc-900 text-white rounded py-2 text-sm disabled:opacity-50"
				>
					Join
				</button>
			</form>
		</div>
	)
}
