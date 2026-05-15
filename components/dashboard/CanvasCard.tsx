'use client'

import { Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Canvas {
	id: string
	name: string
	createdAt: string | Date
	updatedAt: string | Date
}

interface Props {
	canvas: Canvas
}

// One hairline-framed row per canvas. Hover surfaces an olive ink-bar on the
// left and reveals the rename/delete affordances. Inline rename: pencil click
// toggles the row into an input. Delete: confirm() to avoid accidental loss
// (we're not building a full toast/undo flow for the hackathon).
export function CanvasCard({ canvas }: Props) {
	const router = useRouter()
	const [editing, setEditing] = useState(false)
	const [name, setName] = useState(canvas.name)
	const [busy, setBusy] = useState(false)

	const dateLabel = formatDate(canvas.updatedAt)

	async function saveRename(e: React.FormEvent) {
		e.preventDefault()
		const trimmed = name.trim()
		if (!trimmed || trimmed === canvas.name) {
			setEditing(false)
			setName(canvas.name)
			return
		}
		setBusy(true)
		try {
			const r = await fetch(`/api/canvases/${canvas.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: trimmed }),
			})
			if (!r.ok) throw new Error(`rename failed (${r.status})`)
			setEditing(false)
			router.refresh()
		} catch (err) {
			console.error(err)
			setName(canvas.name)
			setEditing(false)
		} finally {
			setBusy(false)
		}
	}

	async function onDelete() {
		if (!confirm(`Delete "${canvas.name}"? This can't be undone.`)) return
		setBusy(true)
		try {
			const r = await fetch(`/api/canvases/${canvas.id}`, { method: 'DELETE' })
			if (!r.ok) throw new Error(`delete failed (${r.status})`)
			router.refresh()
		} catch (err) {
			console.error(err)
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="group relative border border-hairline bg-paper rounded-sm hover:border-ink/40 transition-colors">
			<span
				className="absolute left-0 top-0 bottom-0 w-1 bg-olive opacity-0 group-hover:opacity-100 transition-opacity"
				aria-hidden="true"
			/>
			<div className="flex items-center gap-6 px-5 py-4">
				<div className="flex-1 min-w-0">
					{editing ? (
						<form onSubmit={saveRename} className="flex items-center gap-2">
							<input
								autoFocus
								type="text"
								value={name}
								maxLength={120}
								disabled={busy}
								onChange={(e) => setName(e.target.value)}
								onBlur={saveRename}
								onKeyDown={(e) => {
									if (e.key === 'Escape') {
										setEditing(false)
										setName(canvas.name)
									}
								}}
								className="flex-1 px-2 py-1 bg-paper border border-hairline rounded-sm text-ink font-sans text-[15px] focus:outline-none focus:border-ink"
							/>
						</form>
					) : (
						<Link
							href={`/room/${canvas.id}`}
							className="block font-display text-[18px] tracking-tight text-ink truncate hover:text-olive"
						>
							{canvas.name}
						</Link>
					)}
					<div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-faded-ink">
						{dateLabel}
					</div>
				</div>
				<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
					<button
						type="button"
						onClick={() => setEditing(true)}
						disabled={busy}
						aria-label="Rename canvas"
						className="p-2 text-faded-ink hover:text-ink"
					>
						<Pencil size={14} strokeWidth={1.5} />
					</button>
					<button
						type="button"
						onClick={onDelete}
						disabled={busy}
						aria-label="Delete canvas"
						className="p-2 text-faded-ink hover:text-crimson"
					>
						<Trash2 size={14} strokeWidth={1.5} />
					</button>
				</div>
				<Link
					href={`/room/${canvas.id}`}
					className="font-display text-[11px] uppercase tracking-[0.18em] text-faded-ink hover:text-ink"
				>
					Open →
				</Link>
			</div>
		</div>
	)
}

function formatDate(d: string | Date): string {
	const date = typeof d === 'string' ? new Date(d) : d
	if (Number.isNaN(date.getTime())) return ''
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})
}
