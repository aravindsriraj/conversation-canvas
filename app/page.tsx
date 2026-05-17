import { Show } from '@clerk/nextjs'
import Link from 'next/link'

/*
 * Landing page v3.
 *
 * Direct/product-y tone, no implementation jargon. The page answers five
 * questions in order: what is this → why should I care → how does it work
 * → is it real → what do I do next. Tech credits are pushed to a single
 * tiny line at the foot of the page; everything above the fold is product.
 *
 * Section map:
 *   §1  Hero            — headline + sub + CTA + a poster of the video
 *   §2  Problem         — three short pain-point lines on paper
 *   §3  How it works    — 3 numbered steps in plain language
 *   §4  On your canvas  — friendly card grid (replaces the 28-action atlas)
 *   §5  See it work     — the 90s Remotion video, autoplay-muted-loop
 *   §6  Differentiators — three short ideas in editorial type
 *   §7  Final CTA       — sign-up call
 *   §8  Footer          — minimal credits row
 */
export default function Home() {
	return (
		<div className="min-h-screen w-full bg-paper text-ink">
			{/* ── HEADER ─────────────────────────────────────────────────── */}
			<header className="sticky top-0 z-50 backdrop-blur-[2px] bg-paper/70 border-b border-hairline">
				<div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<span className="w-1 h-1 bg-olive" aria-hidden="true" />
						<span className="font-display text-[14px] uppercase tracking-[0.22em] text-ink">
							Conversation Canvas
						</span>
					</div>
					<div className="flex items-center gap-5">
						<div className="hidden sm:flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faded-ink">
							<span
								className="w-1.5 h-1.5 bg-crimson rounded-full live-pulse"
								aria-hidden="true"
							/>
							<span>Live</span>
						</div>
						<Show when="signed-out">
							<Link
								href="/sign-up"
								className="font-display text-[11px] uppercase tracking-[0.18em] text-ink border-b border-hairline hover:border-ink pb-0.5 transition-colors"
							>
								Sign up →
							</Link>
						</Show>
						<Show when="signed-in">
							<Link
								href="/dashboard"
								className="font-display text-[11px] uppercase tracking-[0.18em] text-ink border-b border-hairline hover:border-ink pb-0.5 transition-colors"
							>
								Dashboard →
							</Link>
						</Show>
					</div>
				</div>
			</header>

			{/* ── §1 · HERO ──────────────────────────────────────────────── */}
			<section className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-24 pb-16 stagger-1">
				{/*
				 * Hero text block first — narrower so the rag stays editorial.
				 * The video below it is the centerpiece; this is the
				 * orientation copy that frames it.
				 */}
				<div className="max-w-[920px]">
					<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-8">
						No. 01 · Milan AI Week 2026
					</div>
					<h1
						className="font-display font-light text-ink"
						style={{
							fontSize: 'clamp(48px, 7vw, 96px)',
							lineHeight: 0.98,
							letterSpacing: '-0.02em',
						}}
					>
						Your meeting,{' '}
						<em className="font-display italic">as a canvas</em>.
					</h1>
					<p className="mt-9 max-w-[620px] text-[19px] leading-[1.55] text-ink font-sans">
						Talk through your meeting. Watch the canvas build itself —
						cards for every decision, action item and blocker, drawn
						live as you speak. Then keep shaping it by voice or chat.
					</p>
					<div className="mt-10 flex flex-wrap gap-3 items-center">
						<Show when="signed-out">
							<Link href="/sign-up" className="cta-primary group">
								<span className="cta-bar" aria-hidden="true" />
								<span>Start your canvas — free</span>
							</Link>
							<Link href="/sign-in" className="cta-secondary">
								<span>Sign in</span>
							</Link>
						</Show>
						<Show when="signed-in">
							<Link href="/dashboard" className="cta-primary group">
								<span className="cta-bar" aria-hidden="true" />
								<span>Open dashboard</span>
							</Link>
						</Show>
					</div>
					<div className="mt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-faded-ink">
						Free during beta · no credit card · ~30s to your first card
					</div>
				</div>

				{/*
				 * Hero motion — autoplay-muted-loop video at FULL container
				 * width (1200px), 16:9 = 675px tall. Large enough that the
				 * in-canvas transcript and card details read cleanly. Lives
				 * directly under the headline so first scroll lands on it.
				 *
				 * preload="metadata" keeps the initial-paint payload tiny;
				 * the full video streams in once layout settles.
				 */}
				<div
					className="mt-16 relative w-full overflow-hidden rounded-sm border border-hairline bg-paper"
					style={{
						boxShadow: '0 32px 80px -28px rgba(26,24,21,0.35)',
						aspectRatio: '16 / 9',
					}}
				>
					<video
						className="w-full h-full block object-cover"
						src="/hero.mp4"
						poster="/hero-poster.jpg"
						autoPlay
						muted
						loop
						playsInline
						preload="metadata"
					>
						<track kind="captions" />
					</video>
					<div
						className="absolute inset-0 pointer-events-none"
						style={{
							boxShadow:
								'inset 0 0 0 1px rgba(26,24,21,0.04), inset 0 0 140px rgba(26,24,21,0.04)',
						}}
					/>
				</div>
				<div className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-faded-ink">
					A staged 90-second demo · plays muted on loop
				</div>

				{/* Scroll cue — subtle "↓" with caption, signals more below */}
				<div className="mt-20 flex flex-col items-center gap-2 hero-scroll-cue">
					<span className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink">
						Read on
					</span>
					<span className="font-mono text-[14px] text-faded-ink">↓</span>
				</div>
			</section>

			{/* ── §2 · PROBLEM (as voices) ──────────────────────────────── */}
			<section className="border-t border-hairline stagger-2">
				<div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-24">
					<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-8">
						§ I · The problem
					</div>
					<h2 className="font-display text-[36px] sm:text-[48px] md:text-[64px] leading-[1.02] tracking-tight text-ink max-w-[900px] mb-14">
						Meetings end. The work disappears.
					</h2>
					{/*
					 * Three "voices" — short verbatim-style quotes from the kinds
					 * of moments this product would have saved. More vivid than
					 * a numbered list; the reader hears their own meetings in
					 * each line. Attribution is the WHERE / WHEN of the
					 * conversation, in mono, to anchor it in a real scene.
					 */}
					<div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-12 max-w-[1100px]">
						{[
							{
								quote:
									'“Wait — what did we decide about pricing last week?”',
								where: 'A Slack thread · Wednesday, 4:42pm',
							},
							{
								quote:
									'“I thought Alex was going to own it? Or was it Sam?”',
								where: 'A standup · two sprints later',
							},
							{
								quote:
									'“There’s a recording but it’s 47 minutes long. Anyone want to listen back?”',
								where: 'Silence',
							},
						].map((v) => (
							<div key={v.where} className="border-l border-hairline pl-6">
								<p className="font-display italic text-[26px] leading-[1.3] text-ink mb-5">
									{v.quote}
								</p>
								<div className="font-mono text-[11px] uppercase tracking-[0.18em] text-faded-ink">
									— {v.where}
								</div>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* ── §3 · HOW IT WORKS ─────────────────────────────────────── */}
			<section className="border-t border-hairline bg-[rgba(46,83,55,0.025)] stagger-3">
				<div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-24">
					<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-8">
						§ II · How it works
					</div>
					<h2 className="font-display text-[36px] sm:text-[48px] md:text-[64px] leading-[1.02] tracking-tight text-ink max-w-[900px] mb-16">
						Three steps. No setup. No templates.
					</h2>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-10 max-w-[1100px]">
						{[
							{
								n: '01',
								title: 'Talk like normal.',
								body: 'Start a canvas, hit listen, run your meeting. No tags, no formats, no special prompts.',
							},
							{
								n: '02',
								title: 'The canvas catches what matters.',
								body: 'Proposals, decisions, commitments, blockers and questions appear as cards — connected by the relationships you spoke aloud.',
							},
							{
								n: '03',
								title: 'Shape it however you like.',
								body: 'Add a sticky note. Move things. Make the blocker red. Ask for a budget split. Voice or typing — it understands both.',
							},
						].map((s) => (
							<div key={s.n}>
								<div className="font-display text-[64px] tracking-tight text-olive leading-none mb-5">
									{s.n}
								</div>
								<h3 className="font-display text-[24px] leading-[1.2] tracking-tight text-ink mb-3 max-w-[300px]">
									{s.title}
								</h3>
								<p className="font-sans text-[16px] leading-[1.55] text-faded-ink max-w-[320px]">
									{s.body}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* ── §4 · ON YOUR CANVAS (two tiers) ────────────────────────── */}
			<section className="border-t border-hairline stagger-4">
				<div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-24">
					<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-8">
						§ III · What ends up on your canvas
					</div>
					<h2 className="font-display text-[36px] sm:text-[48px] md:text-[64px] leading-[1.02] tracking-tight text-ink max-w-[1000px] mb-4">
						Everything a whiteboard could be — and then some.
					</h2>
					<p className="font-sans text-[18px] leading-[1.5] text-faded-ink max-w-[760px]">
						The meeting cards write themselves from what you say.
						Anything else — diagrams, sticky notes, priority
						matrices, budget splits — you can just ask for.
					</p>

					{/* ── Tier A — automatic from conversation ─────────────── */}
					<div className="mt-16">
						<div className="flex items-baseline gap-3 mb-8">
							<span className="font-mono text-[10px] uppercase tracking-[0.22em] text-olive">
								§ A
							</span>
							<span className="font-display text-[18px] uppercase tracking-[0.22em] text-ink">
								Automatic — from your conversation
							</span>
						</div>
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
							<CardPreview
								kind="proposal"
								label="Ideas being considered"
								body="Target enterprise customers in Q3; focus on the top 100 accounts."
								caption="Proposals"
							/>
							<CardPreview
								kind="decision"
								label="What you decided"
								body="Adopt SMB-focused GTM for Q3. Revisit enterprise in Q4."
								caption="Decisions"
								locked
							/>
							<CardPreview
								kind="commitment"
								label="Who's doing what"
								body="Own the SMB outreach plan."
								meta="Alice · by next Friday"
								caption="Commitments"
							/>
							<CardPreview
								kind="blocker"
								label="What's in the way"
								body="Legal review hasn't cleared yet."
								caption="Blockers"
							/>
							<CardPreview
								kind="question"
								label="Worth revisiting"
								body="Realistic timeline if legal clears next week?"
								caption="Open questions"
							/>
							<CardPreview
								kind="proposal"
								label="And the relationships between them"
								body={"Proposal → decision, decision → commitment, blocker → what it blocks. Drawn for you, as you speak."}
								caption="Connecting arrows"
							/>
						</div>
					</div>

					{/* ── Tier B — on request, by voice or chat ─────────────── */}
					<div className="mt-20">
						<div className="flex items-baseline gap-3 mb-8">
							<span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ochre">
								§ B
							</span>
							<span className="font-display text-[18px] uppercase tracking-[0.22em] text-ink">
								On request — by voice or chat
							</span>
						</div>
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-x-8 gap-y-12">
							<OnRequestPreview
								caption="Free-form notes"
								prompt="“Add a yellow sticky for the post-Q3 review.”"
							>
								<div className="flex justify-center">
									<div
										className="aspect-square w-[180px] flex items-center justify-center text-center p-4"
										style={{
											background: '#f7e08a',
											transform: 'rotate(-1.5deg)',
											boxShadow:
												'0 1px 0 rgba(26,24,21,0.08), 0 12px 28px -14px rgba(26,24,21,0.30)',
										}}
									>
										<span className="font-display italic text-ink text-[17px] leading-[1.3] font-medium">
											Post-Q3 review
										</span>
									</div>
								</div>
							</OnRequestPreview>

							<OnRequestPreview
								caption="Diagrams & shapes"
								prompt="“Draw a flowchart from the title to the launch.”"
							>
								<ShapesPreview />
							</OnRequestPreview>

							<OnRequestPreview
								caption="When ranking matters"
								prompt="“Rank these by impact and effort.”"
							>
								<MatrixPreview />
							</OnRequestPreview>

							<OnRequestPreview
								caption="When splitting matters"
								prompt="“Split the budget 60/30/10.”"
							>
								<BudgetPreview />
							</OnRequestPreview>
						</div>

						<p className="mt-12 font-sans text-[16px] leading-[1.55] text-faded-ink max-w-[760px] italic">
							Plus the small motions — move, recolor, align,
							resize, delete, focus, group, lock. Anything you'd
							do with the mouse, you can do by asking.
						</p>
					</div>
				</div>
			</section>

			{/* ── §5 · POSITIONING (vs other meeting tools) ─────────────── */}
			<section className="border-t border-hairline bg-[rgba(26,24,21,0.018)] stagger-5">
				<div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-24">
					<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-8">
						§ IV · What it isn’t
					</div>
					<h2 className="font-display text-[36px] sm:text-[48px] md:text-[64px] leading-[1.02] tracking-tight text-ink max-w-[1000px] mb-6">
						Not the meeting tool you’ve used before.
					</h2>
					<p className="font-sans text-[18px] leading-[1.55] text-faded-ink max-w-[760px] mb-16">
						Most tools that follow your meetings fall into three
						buckets. None of them produce the document you actually
						wanted.
					</p>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-[1100px]">
						{[
							{
								tag: 'Recorders',
								gives: 'Hours of audio.',
								miss: 'You’ll never re-listen.',
							},
							{
								tag: 'Transcripts',
								gives: 'A wall of text.',
								miss: 'Nobody opens it twice.',
							},
							{
								tag: 'AI summaries',
								gives: 'A paragraph or two.',
								miss: 'The structure is gone.',
							},
						].map((bucket) => (
							<div
								key={bucket.tag}
								className="border border-hairline rounded-sm p-7 bg-paper"
							>
								<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-4">
									{bucket.tag}
								</div>
								<div className="font-display text-[24px] text-ink leading-[1.15] mb-3">
									{bucket.gives}
								</div>
								<div className="font-sans text-[15px] text-faded-ink italic leading-[1.45]">
									{bucket.miss}
								</div>
							</div>
						))}
					</div>

					<div className="mt-16 max-w-[1000px]">
						<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-olive mb-3">
							What we give you instead
						</div>
						<p className="font-display text-[32px] sm:text-[40px] leading-[1.15] text-ink tracking-tight">
							A <em className="italic">typed, navigable graph</em> of what
							was said — drawn live, editable by voice or chat, and
							waiting where you left it next week.
						</p>
					</div>
				</div>
			</section>

			{/* ── §6 · FINAL CTA ────────────────────────────────────────── */}
			<section className="border-t border-hairline stagger-7">
				<div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-28 text-center">
					<h2
						className="font-display font-light text-ink"
						style={{
							fontSize: 'clamp(40px, 6vw, 88px)',
							lineHeight: 1.0,
							letterSpacing: '-0.02em',
						}}
					>
						Start your first canvas.
					</h2>
					<p className="mt-7 font-sans text-[18px] text-faded-ink max-w-[520px] mx-auto">
						Sign in with Google or email. Free during beta, no
						credit card. Two minutes to your first card.
					</p>
					<div className="mt-10 flex justify-center gap-3">
						<Show when="signed-out">
							<Link href="/sign-up" className="cta-primary group">
								<span className="cta-bar" aria-hidden="true" />
								<span>Start free</span>
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

			{/* ── AUTHOR QUOTE — humanizes the page before the footer ───── */}
			<section className="border-t border-hairline bg-[rgba(46,83,55,0.025)]">
				<div className="max-w-[900px] mx-auto px-5 sm:px-8 py-20">
					<blockquote className="font-display italic text-[26px] sm:text-[30px] leading-[1.4] text-ink">
						“I built this because I was tired of meetings ending and
						the work going nowhere. The canvas is the document I
						always wished I had at the end of every call.”
					</blockquote>
					<div className="mt-6 font-mono text-[11px] uppercase tracking-[0.22em] text-faded-ink">
						— Aravindan Sriraj
					</div>
				</div>
			</section>

			{/* ── FOOTER ────────────────────────────────────────────────── */}
			<footer className="border-t border-hairline">
				<div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-10 grid grid-cols-12 gap-6 font-mono text-[11px] text-faded-ink leading-relaxed">
					<div className="col-span-12 md:col-span-4">
						Built · Milan AI Week 2026 · Aravindan Sriraj
					</div>
					<div className="col-span-12 md:col-span-5 md:text-center">
						<span className="text-faded-ink">
							Next.js · tldraw · Gemini · Speechmatics · Neon · Clerk
						</span>
					</div>
					<div className="col-span-12 md:col-span-3 md:text-right">
						<a
							href="https://github.com/aravindsriraj/conversation-canvas"
							target="_blank"
							rel="noopener noreferrer"
							className="text-faded-ink hover:text-ink transition-colors border-b border-hairline pb-0.5"
						>
							View source on GitHub →
						</a>
					</div>
				</div>
			</footer>

			{/* ── styles ─────────────────────────────────────────────────── */}
			<style>{`
				@keyframes live-pulse {
					0%, 100% { opacity: 0.4; }
					50% { opacity: 1; }
				}
				.live-pulse { animation: live-pulse 1.8s ease-in-out infinite; }

				@keyframes scroll-bounce {
					0%, 100% { transform: translateY(0); opacity: 0.55; }
					50% { transform: translateY(4px); opacity: 1; }
				}
				.hero-scroll-cue { animation: scroll-bounce 2.4s ease-in-out infinite; }

				@keyframes fade-up {
					from { opacity: 0; transform: translateY(12px); }
					to   { opacity: 1; transform: translateY(0); }
				}
				.stagger-1 { animation: fade-up 600ms ease-out 0ms both; }
				.stagger-2 { animation: fade-up 600ms ease-out 120ms both; }
				.stagger-3 { animation: fade-up 600ms ease-out 200ms both; }
				.stagger-4 { animation: fade-up 600ms ease-out 280ms both; }
				.stagger-5 { animation: fade-up 600ms ease-out 360ms both; }
				.stagger-6 { animation: fade-up 600ms ease-out 440ms both; }
				.stagger-7 { animation: fade-up 600ms ease-out 520ms both; }
				@media (prefers-reduced-motion: reduce) {
					.stagger-1, .stagger-2, .stagger-3, .stagger-4, .stagger-5, .stagger-6, .stagger-7 {
						animation: none;
					}
				}

				.cta-primary {
					position: relative;
					display: inline-flex;
					align-items: center;
					gap: 0.5rem;
					background: var(--color-ink);
					color: var(--color-paper);
					padding: 16px 26px;
					border-radius: 2px;
					font-family: var(--font-display);
					font-size: 13px;
					text-transform: uppercase;
					letter-spacing: 0.15em;
					transition: transform 200ms ease, background 200ms ease;
				}
				.cta-primary:hover { transform: translateY(-1px); }
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
				.cta-primary:hover .cta-bar { opacity: 1; }
				.cta-secondary {
					display: inline-flex;
					align-items: center;
					background: var(--color-paper);
					color: var(--color-ink);
					padding: 16px 26px;
					border-radius: 2px;
					border: 1px solid var(--color-hairline);
					font-family: var(--font-display);
					font-size: 13px;
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
 * CardPreview — friendly-named card sample for §4. Uses the SAME visual
 * vocabulary as the live tldraw cards (ink-bar, hairline divider, mono
 * meta line) so the page reads as a faithful preview of the product.
 *
 * The `caption` is the everyday-language category ("Proposals",
 * "Decisions", etc.), shown as a small caps line above each card. The
 * `label` is the in-card header — the kind of human framing a user
 * would use to describe what this card is for.
 */
function CardPreview({
	kind,
	label,
	body,
	caption,
	meta,
	locked,
}: {
	kind: 'proposal' | 'decision' | 'commitment' | 'blocker' | 'question' | 'note'
	label: string
	body: string
	caption: string
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
						: kind === 'question'
							? 'bg-ochre'
							: ''

	if (kind === 'note') {
		return (
			<div className="flex flex-col items-start">
				<div className="font-display text-[11px] uppercase tracking-[0.22em] text-faded-ink mb-3">
					{caption}
				</div>
				<div
					className="w-full max-w-[260px] aspect-square p-6 flex items-center justify-center text-center"
					style={{
						background: '#f7e08a',
						transform: 'rotate(-1.5deg)',
						boxShadow:
							'0 1px 0 rgba(26,24,21,0.08), 0 12px 28px -14px rgba(26,24,21,0.30)',
					}}
				>
					<span className="font-display italic text-ink text-[20px] leading-[1.3] font-medium">
						{body}
					</span>
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col items-start">
			<div className="font-display text-[11px] uppercase tracking-[0.22em] text-faded-ink mb-3">
				{caption}
			</div>
			<div
				className="relative w-full bg-paper flex flex-col"
				style={{
					borderRadius: 4,
					border: locked ? '2px solid var(--color-olive)' : 'none',
					background: locked
						? 'linear-gradient(135deg, rgba(46,83,55,0.04) 0%, rgba(46,83,55,0) 60%), var(--color-paper)'
						: 'var(--color-paper)',
					boxShadow:
						'0 1px 0 rgba(26,24,21,0.08), 0 8px 24px -12px rgba(26,24,21,0.18)',
				}}
			>
				<div
					className={`absolute left-0 top-0 bottom-0 w-1 ${barColor}`}
					style={{
						borderTopLeftRadius: 4,
						borderBottomLeftRadius: 4,
					}}
				/>
				<div className="px-5 pt-3 pb-2 border-b border-hairline">
					<span className="font-display text-[10px] uppercase tracking-[0.18em] text-faded-ink">
						{label}
					</span>
				</div>
				<div
					className={`px-5 py-4 text-[14px] leading-snug font-sans text-ink ${locked ? 'font-medium' : ''}`}
				>
					{body}
				</div>
				{meta && (
					<div className="px-5 pb-3 text-[10px] font-mono text-faded-ink">
						{meta}
					</div>
				)}
			</div>
		</div>
	)
}

/*
 * OnRequestPreview — wraps a visual demo with a caption + a quoted prompt
 * showing the kind of phrasing that produces this output. The prompt is in
 * mono with quote marks to read as "the user said this and the canvas did
 * that" — concrete, scannable, and ties the abstract capability to a real
 * sentence someone would actually speak or type.
 */
function OnRequestPreview({
	caption,
	prompt,
	children,
}: {
	caption: string
	prompt: string
	children: React.ReactNode
}) {
	return (
		<div className="flex flex-col gap-5">
			<div className="font-display text-[11px] uppercase tracking-[0.22em] text-faded-ink">
				{caption}
			</div>
			<div
				className="relative w-full p-8 border border-hairline rounded-sm bg-paper"
				style={{
					minHeight: 240,
					boxShadow:
						'0 1px 0 rgba(26,24,21,0.04), 0 12px 28px -16px rgba(26,24,21,0.18)',
				}}
			>
				<div className="flex items-center justify-center min-h-[200px]">
					{children}
				</div>
			</div>
			<div className="flex items-start gap-3">
				<span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ochre mt-1 shrink-0">
					Ask
				</span>
				<span className="font-mono text-[14px] leading-[1.5] text-ink">
					{prompt}
				</span>
			</div>
		</div>
	)
}

/*
 * ShapesPreview — a small canvas-like sketch showing a flowchart built
 * from tldraw's geo shapes + arrows. Communicates "you can ask for
 * diagrams" without being literal about the shape vocabulary.
 */
function ShapesPreview() {
	return (
		<svg
			viewBox="0 0 360 200"
			className="w-full max-w-[360px] h-auto"
			role="img"
			aria-label="A flowchart with a rectangle, ellipse, and diamond connected by arrows"
		>
			<title>Flowchart with shapes and arrows</title>
			{/* Rectangle (left) */}
			<rect
				x={10}
				y={70}
				width={90}
				height={60}
				fill="rgba(26,24,21,0.04)"
				stroke="var(--color-ink, #1a1815)"
				strokeWidth={1.5}
				rx={2}
			/>
			<text
				x={55}
				y={105}
				textAnchor="middle"
				fontFamily="var(--font-display)"
				fontSize={14}
				fill="var(--color-ink, #1a1815)"
			>
				Idea
			</text>
			{/* Arrow to ellipse */}
			<line x1={100} y1={100} x2={140} y2={100} stroke="var(--color-faded-ink, #a09583)" strokeWidth={1.5} />
			<polygon
				points="140,100 132,96 132,104"
				fill="var(--color-faded-ink, #a09583)"
			/>
			{/* Ellipse (middle) */}
			<ellipse
				cx={195}
				cy={100}
				rx={55}
				ry={36}
				fill="rgba(46,83,55,0.06)"
				stroke="var(--color-olive, #2e5337)"
				strokeWidth={1.5}
			/>
			<text
				x={195}
				y={105}
				textAnchor="middle"
				fontFamily="var(--font-display)"
				fontSize={14}
				fill="var(--color-olive, #2e5337)"
			>
				Build
			</text>
			{/* Arrow to diamond */}
			<line x1={250} y1={100} x2={290} y2={100} stroke="var(--color-faded-ink, #a09583)" strokeWidth={1.5} />
			<polygon
				points="290,100 282,96 282,104"
				fill="var(--color-faded-ink, #a09583)"
			/>
			{/* Diamond (right) */}
			<polygon
				points="335,70 360,100 335,130 310,100"
				fill="rgba(198,134,43,0.08)"
				stroke="var(--color-ochre, #c6862b)"
				strokeWidth={1.5}
			/>
			<text
				x={335}
				y={105}
				textAnchor="middle"
				fontFamily="var(--font-display)"
				fontSize={13}
				fill="var(--color-ochre, #c6862b)"
			>
				Ship
			</text>
			{/* Tiny callout sticky in corner */}
			<g transform="translate(20 10) rotate(-3)">
				<rect width={60} height={36} fill="#f7e08a" stroke="rgba(26,24,21,0.08)" strokeWidth={0.5} />
				<text
					x={30}
					y={22}
					textAnchor="middle"
					fontFamily="var(--font-display)"
					fontStyle="italic"
					fontSize={11}
					fill="var(--color-ink, #1a1815)"
				>
					note
				</text>
			</g>
		</svg>
	)
}

/*
 * MatrixPreview — small 2-D impact/effort grid with 4 dots in the four
 * quadrants. Doesn't say "matrix" anywhere; the grid + axis labels speak
 * for themselves.
 */
function MatrixPreview() {
	return (
		<svg
			viewBox="0 0 320 220"
			className="w-full max-w-[320px] h-auto"
			role="img"
			aria-label="A priority matrix with four items plotted by impact and effort"
		>
			<title>Priority matrix</title>
			<g transform="translate(40 20)">
				<rect width={260} height={160} fill="rgba(26,24,21,0.02)" stroke="var(--color-hairline, #dcd3c0)" strokeWidth={1} />
				<line x1={130} y1={0} x2={130} y2={160} stroke="var(--color-hairline, #dcd3c0)" strokeWidth={1} />
				<line x1={0} y1={80} x2={260} y2={80} stroke="var(--color-hairline, #dcd3c0)" strokeWidth={1} />
				{/* Dots */}
				<circle cx={70} cy={40} r={7} fill="var(--color-olive, #2e5337)" />
				<circle cx={195} cy={50} r={7} fill="var(--color-ink, #1a1815)" />
				<circle cx={55} cy={120} r={7} fill="var(--color-ochre, #c6862b)" />
				<circle cx={210} cy={130} r={7} fill="var(--color-faded-ink, #a09583)" />
			</g>
			{/* Axis labels */}
			<text
				x={170}
				y={210}
				textAnchor="middle"
				fontFamily="var(--font-mono)"
				fontSize={10}
				letterSpacing={1.5}
				fill="var(--color-faded-ink, #a09583)"
			>
				← EFFORT →
			</text>
			<text
				x={20}
				y={110}
				transform="rotate(-90 20 110)"
				textAnchor="middle"
				fontFamily="var(--font-mono)"
				fontSize={10}
				letterSpacing={1.5}
				fill="var(--color-faded-ink, #a09583)"
			>
				← IMPACT →
			</text>
		</svg>
	)
}

/*
 * BudgetPreview — three horizontal bars summing to 100. Visual stand-in
 * for the budget allocator widget without the chart-junk of a real one.
 */
function BudgetPreview() {
	const rows = [
		{ label: 'Enterprise', pct: 60, color: 'var(--color-olive, #2e5337)' },
		{ label: 'SMB', pct: 30, color: 'var(--color-ochre, #c6862b)' },
		{ label: 'Retention', pct: 10, color: 'var(--color-crimson, #b82626)' },
	]
	return (
		<div className="w-full max-w-[320px] flex flex-col gap-3">
			{rows.map((r) => (
				<div key={r.label}>
					<div className="flex justify-between text-[13px] font-sans text-ink mb-1">
						<span>{r.label}</span>
						<span className="font-mono text-faded-ink">{r.pct}%</span>
					</div>
					<div className="h-2 bg-[rgba(26,24,21,0.05)] rounded-full overflow-hidden">
						<div
							className="h-full rounded-full"
							style={{ width: `${r.pct}%`, background: r.color }}
						/>
					</div>
				</div>
			))}
		</div>
	)
}

function Diff({
	numeral,
	title,
	body,
}: {
	numeral: string
	title: string
	body: string
}) {
	return (
		<div className="grid grid-cols-[70px_1fr] gap-6">
			<div className="font-mono text-[22px] text-olive text-right pr-1">
				{numeral}
			</div>
			<div>
				<div className="font-display text-[28px] leading-[1.1] tracking-tight text-ink mb-3">
					{title}
				</div>
				<p className="font-sans text-[17px] leading-[1.55] text-faded-ink max-w-[660px]">
					{body}
				</p>
			</div>
		</div>
	)
}
