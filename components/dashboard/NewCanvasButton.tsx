'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

// Inline-form variant of the "new canvas" CTA. We considered a Radix dialog
// (and have it as a dep) but the inline form gives a flatter, more editorial
// feel — matches Scriptorium's "no chrome" intent. Dialog would feel modal.

export function NewCanvasButton() {
	const router = useRouter()
	const [open, setOpen] = useState(false)
	const [name, setName] = useState('')
	const [busy, setBusy] = useState(false)
	const [err, setErr] = useState<string | null>(null)

	async function submit(e: React.FormEvent) {
		e.preventDefault()
		const trimmed = name.trim()
		if (!trimmed || busy) return
		setBusy(true)
		setErr(null)
		try {
			const r = await fetch('/api/canvases', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: trimmed }),
			})
			if (!r.ok) {
				const body = await r.json().catch(() => ({}))
				throw new Error(body?.error ?? `failed (${r.status})`)
			}
			const data = (await r.json()) as { id: string }
			router.push(`/room/${data.id}`)
		} catch (e) {
			setErr(e instanceof Error ? e.message : 'failed')
			setBusy(false)
		}
	}

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="cta-primary group"
			>
				<span className="cta-bar" aria-hidden="true" />
				<span>New canvas</span>
			</button>
		)
	}

	return (
		<form
			onSubmit={submit}
			className="flex items-center gap-3 max-w-[480px] w-full"
		>
			<input
				autoFocus
				type="text"
				placeholder="Canvas name"
				maxLength={120}
				value={name}
				onChange={(e) => setName(e.target.value)}
				disabled={busy}
				className="flex-1 px-3 py-2 bg-paper border border-hairline rounded-sm text-ink font-sans text-[14px] focus:outline-none focus:border-ink"
			/>
			<button
				type="submit"
				disabled={busy || !name.trim()}
				className="cta-primary group disabled:opacity-50"
			>
				<span className="cta-bar" aria-hidden="true" />
				<span>{busy ? 'Creating…' : 'Create'}</span>
			</button>
			<button
				type="button"
				onClick={() => {
					setOpen(false)
					setName('')
					setErr(null)
				}}
				disabled={busy}
				className="font-mono text-[10px] uppercase tracking-[0.18em] text-faded-ink hover:text-ink"
			>
				Cancel
			</button>
			{err && (
				<span className="font-mono text-[11px] text-crimson">{err}</span>
			)}
		</form>
	)
}
