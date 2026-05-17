'use client'

import { useState } from 'react'

// Default palette stays unchanged — only the swatch chrome moves to
// ink-bottle squares so the form reads as a printed enrollment slip.
const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#0ea5e9', '#a855f7']

interface Props {
	onJoin: (name: string, color: string) => void
}

/*
 * RoomJoin — paper-on-paper enrollment slip.
 *
 * Visually continuous with the canvas behind it (same bg-paper, same grain
 * applied via globals.css). The form lives inside a hairline-framed figure;
 * fields are printed-form style (transparent input with a hairline underline
 * that thickens to ink on focus); color choices are ink-bottle squares.
 */
export function RoomJoin({ onJoin }: Props) {
	const [name, setName] = useState('')
	const [color, setColor] = useState(COLORS[0])

	return (
		<div className="fixed inset-0 grid place-items-center bg-paper px-4">
			<form
				onSubmit={(e) => {
					e.preventDefault()
					if (name) onJoin(name, color)
				}}
				className="w-full max-w-[420px] bg-paper border border-hairline rounded-sm px-6 sm:px-8 py-8 sm:py-9 flex flex-col gap-6"
				style={{
					// Slight inset shadow so the figure sits in the paper rather than on top of it.
					boxShadow:
						'inset 0 1px 0 rgba(26,24,21,0.04), 0 1px 0 rgba(26,24,21,0.06), 0 12px 28px -20px rgba(26,24,21,0.18)',
				}}
			>
				{/* Wordmark */}
				<div className="flex items-center gap-3">
					<span className="w-1 h-1 bg-olive" aria-hidden="true" />
					<span className="font-display text-[12px] uppercase tracking-[0.22em] text-ink">
						Conversation Canvas
					</span>
				</div>

				<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink">
					New session ↓
				</div>

				{/* Name field — printed-form input */}
				<label className="flex flex-col gap-2">
					<span className="font-display text-[10px] uppercase tracking-[0.22em] text-faded-ink">
						Your name
					</span>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="bg-transparent border-b border-hairline px-0 py-1.5 text-[15px] text-ink font-sans focus:outline-none focus:border-ink focus:border-b-2 transition-[border-color,border-width] placeholder:text-faded-ink"
						placeholder="Alice"
						autoFocus
					/>
				</label>

				{/* Color — ink-bottle squares */}
				<div className="flex flex-col gap-2">
					<span className="font-display text-[10px] uppercase tracking-[0.22em] text-faded-ink">
						Color
					</span>
					<div className="flex gap-3 mt-1">
						{COLORS.map((c) => (
							<button
								key={c}
								type="button"
								onClick={() => setColor(c)}
								aria-label={`Pick color ${c}`}
								aria-pressed={color === c}
								className="relative w-5 h-5 border border-hairline transition-shadow"
								style={{
									background: c,
									// Selected: a 2 px inset ink ring sits inside the swatch like a
									// stamped border. We do it with box-shadow so it doesn't bump layout.
									boxShadow:
										color === c
											? 'inset 0 0 0 2px var(--color-ink), 0 0 0 1px var(--color-ink)'
											: 'none',
								}}
							/>
						))}
					</div>
				</div>

				{/* Submit — solid ink rectangle */}
				<button
					type="submit"
					disabled={!name}
					className="mt-2 bg-ink text-paper px-5 py-3 rounded-sm font-display text-[11px] uppercase tracking-[0.18em] disabled:bg-paper disabled:text-faded-ink disabled:border disabled:border-hairline disabled:cursor-not-allowed transition-[transform,background] hover:enabled:translate-y-[-1px]"
				>
					Enter the room
				</button>

				<div className="font-mono text-[10px] text-faded-ink leading-relaxed">
					Single-user mode · all speech mapped to your name
				</div>
			</form>
		</div>
	)
}
