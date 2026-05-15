import Link from 'next/link'

export default function Home() {
	return (
		<div className="min-h-screen bg-gradient-to-br from-zinc-50 to-zinc-100 flex items-center justify-center p-6">
			<div className="max-w-2xl w-full">
				<div className="flex items-center gap-2 mb-8">
					<div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
					<span className="text-xs font-mono uppercase tracking-wider text-zinc-500">
						Live · multi-speaker · structured
					</span>
				</div>

				<h1 className="text-5xl font-semibold tracking-tight text-zinc-900 leading-tight mb-4">
					Speak. The canvas listens,
					<br />
					structures, and draws.
				</h1>

				<p className="text-lg text-zinc-600 leading-relaxed mb-10 max-w-xl">
					Conversation Canvas turns spoken meetings into living decision
					artifacts. Proposals, decisions, commitments, blockers, priority
					matrices, and budget allocations — composed in real time by a Gemini
					orchestrator and rendered onto a shared tldraw canvas.
				</p>

				<div className="flex flex-col sm:flex-row gap-3 mb-12">
					<Link
						href="/room/demo"
						className="inline-flex items-center justify-center gap-2 bg-zinc-900 text-white px-6 py-3 rounded-full text-sm font-semibold hover:bg-zinc-700 transition"
					>
						<span className="w-2 h-2 rounded-full bg-red-400" />
						Start a meeting
					</Link>
					<Link
						href="/room/test"
						className="inline-flex items-center justify-center bg-white border border-zinc-300 text-zinc-900 px-6 py-3 rounded-full text-sm font-semibold hover:bg-zinc-50 transition"
					>
						Join the test room
					</Link>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
					<div className="bg-white border border-zinc-200 rounded-lg p-4">
						<div className="text-xs uppercase tracking-wider text-indigo-600 font-semibold mb-1">
							Hear
						</div>
						<div className="text-zinc-700 leading-snug">
							Browser mic streams to Speechmatics with speaker diarization
						</div>
					</div>
					<div className="bg-white border border-zinc-200 rounded-lg p-4">
						<div className="text-xs uppercase tracking-wider text-emerald-600 font-semibold mb-1">
							Think
						</div>
						<div className="text-zinc-700 leading-snug">
							Gemini 3 Flash orchestrator emits typed UI actions every 3s
						</div>
					</div>
					<div className="bg-white border border-zinc-200 rounded-lg p-4">
						<div className="text-xs uppercase tracking-wider text-amber-600 font-semibold mb-1">
							Draw
						</div>
						<div className="text-zinc-700 leading-snug">
							tldraw renders proposals, decisions, links, and L3 widgets live
						</div>
					</div>
				</div>

				<div className="mt-10 text-xs text-zinc-400">
					Milan AI Week · built with Next.js 16, tldraw v3, Speechmatics
					Realtime, Vercel AI SDK
				</div>
			</div>
		</div>
	)
}
