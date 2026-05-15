import { Show } from '@clerk/nextjs'
import Link from 'next/link'

/*
 * Landing page — the title page of a slim editorial publication.
 *
 * Layout map:
 *   1. Sticky header: olive ink-bar + wordmark · live chip.
 *   2. Hero: oversized Fraunces headline · editorial body · two CTAs.
 *   3. Specimen sheet (60/40 split): 5 L1 card previews (¹–⁵) · editorial copy.
 *   4. Footer band: build line · numbered stack citations · handle.
 *
 * No gradients. No glass. No icons (except the live-dot). Spacing carries it.
 * Paper grain + paper background already live in globals.css.
 */
export default function Home() {
	return (
		<div className="min-h-screen w-full bg-paper text-ink">
			{/* ── HEADER ─────────────────────────────────────────────────── */}
			<header className="sticky top-0 z-50 backdrop-blur-[2px] bg-paper/70 border-b border-hairline">
				<div className="max-w-[1200px] mx-auto px-8 py-4 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<span className="w-1 h-1 bg-olive" aria-hidden="true" />
						<span className="font-display text-[14px] uppercase tracking-[0.22em] text-ink">
							Conversation Canvas
						</span>
					</div>
					<div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faded-ink">
						<span
							className="w-1.5 h-1.5 bg-crimson rounded-full live-pulse"
							aria-hidden="true"
						/>
						<span>Live</span>
					</div>
				</div>
			</header>

			{/* ── HERO ───────────────────────────────────────────────────── */}
			<section className="max-w-[1200px] mx-auto px-8 pt-24 pb-32 min-h-[75vh] flex flex-col justify-center">
				<div className="max-w-[900px]">
					<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-8">
						No. 01 · Milan AI Week 2026
					</div>
					<h1
						className="font-display font-light text-ink"
						style={{
							fontSize: 'clamp(48px, 7vw, 96px)',
							lineHeight: 0.95,
							letterSpacing: '-0.02em',
						}}
					>
						Voice becomes
						<br />
						structure.
					</h1>
					<p className="mt-10 max-w-[540px] text-[17px] leading-[1.55] text-faded-ink font-sans">
						A meeting-cartographer listens, then composes proposals, decisions,
						commitments, blockers, priorities and budgets onto a living canvas.
						In real time. From the air in the room.
					</p>
					<div className="mt-12 flex flex-wrap gap-3">
						<Show when="signed-out">
							<Link href="/sign-in" className="cta-primary group">
								<span className="cta-bar" aria-hidden="true" />
								<span>Sign in</span>
							</Link>
							<Link href="/sign-up" className="cta-secondary">
								<span>Sign up</span>
							</Link>
						</Show>
						<Show when="signed-in">
							<Link href="/dashboard" className="cta-primary group">
								<span className="cta-bar" aria-hidden="true" />
								<span>Open dashboard</span>
							</Link>
						</Show>
					</div>
				</div>
			</section>

			{/* ── SPECIMEN SHEET ─────────────────────────────────────────── */}
			<section className="border-t border-hairline">
				<div className="max-w-[1200px] mx-auto px-8 py-24 grid grid-cols-12 gap-12">
					{/* LEFT: specimen previews */}
					<div className="col-span-12 lg:col-span-7">
						<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-8">
							§ I · Card specimens
						</div>
						<div className="flex flex-col gap-6">
							<SpecimenRow numeral="¹" caption="Proposal">
								<SpecimenCard
									kind="proposal"
									label="Proposal"
									labelColor="faded"
									body="Ship the conversation canvas as a private beta to the design team this quarter."
									badge={{ name: 'AS', color: '#2E5337' }}
								/>
							</SpecimenRow>
							<SpecimenRow numeral="²" caption="Decision">
								<SpecimenCard
									kind="decision"
									label="Decision · Locked"
									labelColor="olive"
									body="Use Gemini 3 Flash as the orchestrator, with a 3-second emit window."
									badge={{ name: 'AS', color: '#B82626' }}
									meta="by Fri, 22 May"
									locked
								/>
							</SpecimenRow>
							<SpecimenRow numeral="³" caption="Commitment">
								<SpecimenCard
									kind="commitment"
									label="Commitment"
									labelColor="faded"
									body="Wire up the analyser node to the FAB oscilloscope."
									badge={{ name: 'TR', color: '#C6862B' }}
									meta="by Wed, 27 May"
								/>
							</SpecimenRow>
							<SpecimenRow numeral="⁴" caption="Blocker">
								<SpecimenCard
									kind="blocker"
									label="Blocker"
									labelColor="crimson"
									body="Speechmatics token TTL is shorter than our test sessions."
								/>
							</SpecimenRow>
							<SpecimenRow numeral="⁵" caption="Question">
								<SpecimenCard
									kind="question"
									label="Question"
									labelColor="faded"
									body="Do we surface partials in the transcript, or only finals?"
									badge={{ name: 'AS', color: '#2E5337' }}
								/>
							</SpecimenRow>
						</div>
					</div>

					{/* RIGHT: editorial copy */}
					<div className="col-span-12 lg:col-span-5 lg:pl-10 lg:border-l border-hairline">
						<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-8">
							§ II · On the method
						</div>
						<div className="flex flex-col gap-8 max-w-[420px]">
							<p className="text-[15px] leading-[1.65] text-ink font-sans">
								<span className="font-display uppercase tracking-[0.18em] text-[12px] text-olive mr-2">
									Action.
								</span>
								Speechmatics streams a diarized transcript of the room. A
								Gemini orchestrator reads the last few seconds and emits typed
								UI actions — make a proposal, lock a decision, raise a
								blocker, pose a question.
							</p>
							<p className="text-[15px] leading-[1.65] text-ink font-sans">
								<span className="font-display uppercase tracking-[0.18em] text-[12px] text-olive mr-2">
									Relation.
								</span>
								Cards do not float independently. Proposals resolve into
								decisions; commitments hang off their parent decision; blockers
								point at what they block. The orchestrator names the links
								before it draws them.
							</p>
							<p className="text-[15px] leading-[1.65] text-ink font-sans">
								<span className="font-display uppercase tracking-[0.18em] text-[12px] text-olive mr-2">
									Artifact.
								</span>
								What remains at the end of the call is a typed, navigable
								document of what was said and what was decided — not a wall of
								transcript. The canvas is the meeting minute.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* ── FOOTER ─────────────────────────────────────────────────── */}
			<footer className="border-t border-hairline">
				<div className="max-w-[1200px] mx-auto px-8 py-10 grid grid-cols-12 gap-6 font-mono text-[11px] text-faded-ink leading-relaxed">
					<div className="col-span-12 md:col-span-3">
						Built · Milan AI Week 2026
					</div>
					<div className="col-span-12 md:col-span-6 text-faded-ink">
						<span className="text-ink">¹</span> Speechmatics realtime —
						diarization &nbsp;·&nbsp; <span className="text-ink">²</span> Gemini
						3 Flash — orchestrator &nbsp;·&nbsp;{' '}
						<span className="text-ink">³</span> tldraw v3 — canvas
						&nbsp;·&nbsp; <span className="text-ink">⁴</span> Next.js 16
					</div>
					<div className="col-span-12 md:col-span-3 md:text-right">
						Aravindan Sriraj
					</div>
				</div>
			</footer>

			{/* ── Inline styles for hover / live-pulse / CTA chrome ──────── */}
			<style>{`
				@keyframes live-pulse {
					0%,
					100% {
						opacity: 0.4;
					}
					50% {
						opacity: 1;
					}
				}
				.live-pulse {
					animation: live-pulse 1.8s ease-in-out infinite;
				}
				.cta-primary {
					position: relative;
					display: inline-flex;
					align-items: center;
					gap: 0.5rem;
					background: var(--color-ink);
					color: var(--color-paper);
					padding: 14px 22px;
					border-radius: 2px;
					font-family: var(--font-display);
					font-size: 12px;
					text-transform: uppercase;
					letter-spacing: 0.15em;
					transition: transform 200ms ease, background 200ms ease;
				}
				.cta-primary:hover {
					transform: translateY(-1px);
				}
				.cta-primary .cta-bar {
					position: absolute;
					left: 0;
					top: 0;
					bottom: 0;
					width: 3px;
					background: var(--color-olive);
					opacity: 0;
					transition: opacity 200ms ease;
				}
				.cta-primary:hover .cta-bar {
					opacity: 1;
				}
				.cta-secondary {
					display: inline-flex;
					align-items: center;
					background: var(--color-paper);
					color: var(--color-ink);
					padding: 14px 22px;
					border-radius: 2px;
					border: 1px solid var(--color-hairline);
					font-family: var(--font-display);
					font-size: 12px;
					text-transform: uppercase;
					letter-spacing: 0.15em;
					transition: border-color 200ms ease, transform 200ms ease;
				}
				.cta-secondary:hover {
					border-color: var(--color-ink);
					transform: translateY(-1px);
				}
			`}</style>
		</div>
	)
}

/*
 * SpecimenRow — wraps a card preview with a numeral in the left gutter and a
 * small caps caption. The previews are hand-coded approximations of the real
 * canvas cards: same tokens (bg-paper, ink-bar, font-display label) at a
 * fixed 420×88 footprint so they line up.
 */
function SpecimenRow({
	numeral,
	caption,
	children,
}: {
	numeral: string
	caption: string
	children: React.ReactNode
}) {
	return (
		<div className="grid grid-cols-[40px_1fr_120px] gap-6 items-center">
			<div className="font-mono text-[14px] text-faded-ink text-right pr-1">
				{numeral}
			</div>
			<div>{children}</div>
			<div className="font-display text-[10px] uppercase tracking-[0.22em] text-faded-ink">
				{caption}
			</div>
		</div>
	)
}

/*
 * SpecimenCard — a static approximation of the canvas card chrome. Same
 * ink-bar / hairline divider / 10px Fraunces label / 14px body composition,
 * so the previews on the landing page look the same as what users see once
 * they enter the room.
 */
function SpecimenCard({
	kind,
	label,
	labelColor,
	body,
	badge,
	meta,
	locked,
}: {
	kind: 'proposal' | 'decision' | 'commitment' | 'blocker' | 'question'
	label: string
	labelColor: 'faded' | 'olive' | 'crimson'
	body: string
	badge?: { name: string; color: string }
	meta?: string
	locked?: boolean
}) {
	const barColor =
		kind === 'proposal'
			? 'bg-ink'
			: kind === 'decision'
				? 'bg-olive'
				: kind === 'commitment'
					? 'bg-ochre'
					: kind === 'blocker'
						? 'bg-crimson'
						: 'bg-ochre'
	const barOpacity = kind === 'question' ? 0.6 : 1
	const labelClass =
		labelColor === 'olive'
			? 'text-olive'
			: labelColor === 'crimson'
				? 'text-crimson'
				: 'text-faded-ink'

	return (
		<div
			className="relative w-full max-w-[420px] bg-paper flex flex-col"
			style={{
				borderRadius: 4,
				border: locked ? '2px solid var(--color-olive)' : 'none',
				background: locked
					? 'linear-gradient(135deg, rgba(46,83,55,0.04) 0%, rgba(46,83,55,0.0) 60%), var(--color-paper)'
					: 'var(--color-paper)',
				boxShadow:
					'0 1px 0 rgba(26,24,21,0.08), 0 8px 24px -12px rgba(26,24,21,0.18)',
			}}
		>
			<div
				className={`absolute left-0 top-0 bottom-0 w-1 ${barColor}`}
				style={{
					opacity: barOpacity,
					borderTopLeftRadius: 4,
					borderBottomLeftRadius: 4,
				}}
			/>
			<div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-hairline">
				<span
					className={`font-display text-[10px] uppercase tracking-[0.18em] ${labelClass}`}
				>
					{label}
				</span>
				{badge && (
					<span className="ml-auto inline-flex items-center gap-1.5 text-[10px]">
						<span
							className="w-1.5 h-1.5 rounded-full"
							style={{ background: badge.color }}
						/>
						<span className="font-sans tracking-tight text-ink">
							{badge.name}
						</span>
					</span>
				)}
			</div>
			<div
				className={`px-4 py-3 text-[13px] leading-snug font-sans text-ink ${locked ? 'font-medium' : ''}`}
			>
				{body}
			</div>
			{meta && (
				<div className="px-4 pb-3 text-[10px] font-mono text-faded-ink">
					{meta}
				</div>
			)}
		</div>
	)
}
