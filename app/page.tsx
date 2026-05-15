import { Show } from '@clerk/nextjs'
import Link from 'next/link'

/*
 * Landing page — the title page of a slim editorial publication.
 *
 * v2: the canvas is no longer ONLY a passive meeting-cartographer. It now
 * speaks two languages — passive voice capture AND direct commands (both
 * spoken and typed) — across twenty-eight typed UI actions. The page
 * structure reflects that scope:
 *
 *   §1 hero            — A canvas that listens — and one you can ask.
 *   §2 a moment        — typographic transcript → action timeline
 *   §3 two inputs      — voice & chat, side by side, same vocabulary
 *   §4 card specimens  — meeting cards + free-form sticky/geo/text
 *   §5 action atlas    — every action enumerated by tier (L1–L4)
 *   §6 on the method   — Action · Relation · Direction · Memory · Artifact
 *   §7 footer
 *
 * Motion is intentionally restrained: a single staggered fade-in on initial
 * load (CSS-only, no JS), the live-dot pulse, and tiny hover lifts on the
 * CTAs. The page does the heavy lifting through typography and rhythm.
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
			<section className="max-w-[1200px] mx-auto px-8 pt-24 pb-32 min-h-[78vh] flex flex-col justify-center stagger-1">
				<div className="max-w-[960px]">
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
						A canvas that <em className="font-display italic">listens</em>
						<span className="text-faded-ink">—</span>
						<br />
						and one you can <em className="font-display italic">ask</em>.
					</h1>
					<p className="mt-10 max-w-[600px] text-[17px] leading-[1.6] text-faded-ink font-sans">
						Speak inside it and structure emerges. Ask of it and it
						answers, then draws. <span className="text-ink">Twenty-eight typed
						actions</span> — proposals, decisions, sticky notes, geometries,
						arrows, alignments, deletions. Both voices, one canvas, in real
						time.
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

					{/* Stat strip — tiny, mono. The "what" of the product. */}
					<div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-6 max-w-[820px] border-t border-hairline pt-8">
						<Stat numeral="01." label="Voice & chat" value="One vocabulary" />
						<Stat numeral="02." label="Action types" value="Twenty-eight" />
						<Stat numeral="03." label="Latency target" value="≤ 3 seconds" />
						<Stat numeral="04." label="Memory" value="Across sessions" />
					</div>
				</div>
			</section>

			{/* ── §I · A MOMENT IN A MEETING ─────────────────────────────── */}
			<section className="border-t border-hairline stagger-2">
				<div className="max-w-[1200px] mx-auto px-8 py-24 grid grid-cols-12 gap-12">
					<div className="col-span-12 lg:col-span-4">
						<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-6">
							§ I · A moment
						</div>
						<h2 className="font-display text-[34px] leading-[1.05] tracking-tight text-ink mb-6">
							Sixty seconds of a Q3 planning call.
						</h2>
						<p className="text-[15px] leading-[1.6] text-faded-ink font-sans max-w-[380px]">
							Speakers don't pause for the canvas. The canvas catches up — at
							a three-second cadence, in typed actions that already know how
							they relate to each other.
						</p>
					</div>
					<div className="col-span-12 lg:col-span-8">
						<MomentTranscript />
					</div>
				</div>
			</section>

			{/* ── §II · TWO INPUTS, ONE CANVAS ───────────────────────────── */}
			<section className="border-t border-hairline bg-[rgba(46,83,55,0.025)] stagger-3">
				<div className="max-w-[1200px] mx-auto px-8 py-24">
					<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-8">
						§ II · Two inputs, one vocabulary
					</div>
					<h2 className="font-display text-[34px] leading-[1.05] tracking-tight text-ink mb-3 max-w-[780px]">
						The canvas takes voice <em className="italic">and</em> typing.
					</h2>
					<p className="text-[15px] leading-[1.6] text-faded-ink font-sans max-w-[640px] mb-14">
						Both paths share the same typed-action interface and the same
						dedup, layout, and persistence machinery. A direct command in voice
						lands the same shape as a typed instruction. The chat panel
						remembers what was already discussed; the orchestrator never
						forgets a decision it already wrote.
					</p>

					<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
						<InputPanel
							title="Voice"
							subtitle="Passive capture + direct commands"
							icon={
								<span
									className="w-1.5 h-1.5 bg-crimson rounded-full live-pulse"
									aria-hidden="true"
								/>
							}
							lines={[
								{ tag: '[S0]', text: 'Let\'s go with the SMB approach for Q3.' },
								{ tag: '→', text: 'create_decision_card  →decides p2  lock' },
								{ tag: '[S0]', text: 'Add a sticky for the post-Q3 review.' },
								{ tag: '→', text: 'create_note  · yellow' },
								{ tag: '[S0]', text: 'Make the blocker red.' },
								{ tag: '→', text: 'set_shape_style  · color=red' },
							]}
						/>
						<InputPanel
							title="Ask AI"
							subtitle="Direct chat with full vocabulary"
							icon={
								<span
									className="w-1.5 h-1.5 bg-ochre rounded-full"
									aria-hidden="true"
								/>
							}
							lines={[
								{ tag: '>', text: 'Add blockers for cost, stay, and food.' },
								{ tag: '+', text: '3 × create_blocker_card' },
								{ tag: '>', text: 'Align the blockers to the left.' },
								{ tag: '+', text: 'align_shapes  · op=left' },
								{ tag: '>', text: 'Draw a checkbox saying "Book flights".' },
								{ tag: '+', text: 'create_geo  · geo=check-box  · green' },
							]}
						/>
					</div>
				</div>
			</section>

			{/* ── §III · CARD SPECIMENS ──────────────────────────────────── */}
			<section className="border-t border-hairline stagger-4">
				<div className="max-w-[1200px] mx-auto px-8 py-24 grid grid-cols-12 gap-12">
					{/* LEFT: specimen previews */}
					<div className="col-span-12 lg:col-span-7">
						<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-8">
							§ III · Card specimens
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
							<SpecimenRow numeral="⁶" caption="Sticky">
								<NoteSpecimen body="Trip to Vietnam — April 2027" />
							</SpecimenRow>
							<SpecimenRow numeral="⁷" caption="Geo">
								<GeoSpecimen body="Vietnam Trip 2027" />
							</SpecimenRow>
							<SpecimenRow numeral="⁸" caption="Text">
								<TextSpecimen body="Heading · h1" />
							</SpecimenRow>
						</div>
					</div>

					{/* RIGHT: editorial copy */}
					<div className="col-span-12 lg:col-span-5 lg:pl-10 lg:border-l border-hairline">
						<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-8">
							§ III.ii · On the cards
						</div>
						<div className="flex flex-col gap-8 max-w-[420px]">
							<p className="text-[15px] leading-[1.65] text-ink font-sans">
								<span className="font-display uppercase tracking-[0.18em] text-[12px] text-olive mr-2">
									Five meeting cards.
								</span>
								The five typed nouns the orchestrator emits from passive
								listening — Proposal, Decision, Commitment, Blocker, Question.
								Each carries its own visual rhythm so the canvas reads
								top-to-bottom as a story.
							</p>
							<p className="text-[15px] leading-[1.65] text-ink font-sans">
								<span className="font-display uppercase tracking-[0.18em] text-[12px] text-olive mr-2">
									Three free-form shapes.
								</span>
								Direct commands — voice or chat — also reach for tldraw's
								native repertoire. Sticky notes for jots, geometric shapes for
								diagrams, text for headings. The chat panel converts intent
								into the closest fit.
							</p>
							<p className="text-[15px] leading-[1.65] text-ink font-sans">
								<span className="font-display uppercase tracking-[0.18em] text-[12px] text-olive mr-2">
									Manipulation.
								</span>
								Every shape can later be moved, resized, restyled, aligned,
								distributed, reordered, deleted, or pointed at by a freeform
								arrow. The canvas is editable conversationally, not just at
								creation.
							</p>
						</div>
					</div>
				</div>
			</section>

			{/* ── §IV · ACTION ATLAS ─────────────────────────────────────── */}
			<section className="border-t border-hairline bg-[rgba(26,24,21,0.015)] stagger-5">
				<div className="max-w-[1200px] mx-auto px-8 py-24">
					<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-8">
						§ IV · The twenty-eight actions
					</div>
					<h2 className="font-display text-[34px] leading-[1.05] tracking-tight text-ink mb-3 max-w-[780px]">
						A closed alphabet of canvas operations.
					</h2>
					<p className="text-[15px] leading-[1.6] text-faded-ink font-sans max-w-[640px] mb-14">
						Every utterance — spoken or typed — gets normalized into one of
						these twenty-eight Zod-validated action variants. The model
						doesn't invent verbs; if it tries, a runtime normalizer maps the
						drift back to the canonical form.
					</p>

					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-12 max-w-[1080px]">
						<AtlasColumn
							title="L1 · Meeting"
							caption="Passive capture"
							items={[
								'create_proposal_card',
								'create_decision_card',
								'create_commitment_card',
								'create_blocker_card',
								'create_question_card',
							]}
						/>
						<AtlasColumn
							title="L1 · Native"
							caption="Free-form shapes"
							items={['create_note', 'create_geo', 'create_text']}
						/>
						<AtlasColumn
							title="L2 · Graph"
							caption="Relations & state"
							items={[
								'link_nodes',
								'group_into_frame',
								'lock_decision',
								'update_card',
							]}
						/>
						<AtlasColumn
							title="L3 · Widgets"
							caption="Bespoke visualizations"
							items={[
								'create_priority_matrix',
								'create_budget_allocator',
								'create_gantt',
								'create_bespoke_widget',
							]}
						/>
						<AtlasColumn
							title="L4 · Manipulation"
							caption="Edit after creation"
							items={[
								'delete_shapes',
								'move_shape',
								'resize_shape',
								'set_shape_style',
								'align_shapes',
							]}
							offsetTop
						/>
						<AtlasColumn
							title=" "
							caption=" "
							items={[
								'distribute_shapes',
								'reorder_shapes',
								'zoom_to_shapes',
								'create_arrow',
							]}
							offsetTop
						/>
					</div>
				</div>
			</section>

			{/* ── §V · ON THE METHOD ─────────────────────────────────────── */}
			<section className="border-t border-hairline stagger-6">
				<div className="max-w-[1200px] mx-auto px-8 py-24 grid grid-cols-12 gap-12">
					<div className="col-span-12 lg:col-span-4">
						<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-6">
							§ V · On the method
						</div>
						<h2 className="font-display text-[34px] leading-[1.05] tracking-tight text-ink mb-3">
							A typed graph, drawn out loud.
						</h2>
					</div>
					<div className="col-span-12 lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8 max-w-[820px]">
						<MethodNote
							label="Action."
							body="Speechmatics streams a diarized transcript. A Gemini 3 Flash orchestrator reads the last thirty seconds and emits typed UI actions — make a proposal, lock a decision, raise a blocker, pose a question."
						/>
						<MethodNote
							label="Relation."
							body="Cards do not float independently. Proposals resolve into decisions; commitments hang off their parent decision; blockers point at what they block. The orchestrator names the links before it draws them."
						/>
						<MethodNote
							label="Direction."
							body="The same canvas takes direct commands — spoken or typed — across the full action vocabulary. Voice for ambient capture, chat for sharper intent. One closed alphabet, two surfaces."
						/>
						<MethodNote
							label="Memory."
							body="Action history, tldraw store snapshots, and the chat agent's conversation all persist to Postgres. Reload the canvas — the orchestrator still remembers what was decided three hours ago."
						/>
						<MethodNote
							label="Artifact."
							body="What remains at the end of the call is a typed, navigable document — proposals, decisions, commitments and the arrows between them — not a wall of transcript. The canvas is the meeting minute."
						/>
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
						<span className="text-ink">¹</span> Speechmatics realtime ·{' '}
						<span className="text-ink">²</span> Gemini 3 Flash ·{' '}
						<span className="text-ink">³</span> tldraw v3 ·{' '}
						<span className="text-ink">⁴</span> Next.js 16 ·{' '}
						<span className="text-ink">⁵</span> Clerk ·{' '}
						<span className="text-ink">⁶</span> Neon Postgres
					</div>
					<div className="col-span-12 md:col-span-3 md:text-right">
						Aravindan Sriraj
					</div>
				</div>
			</footer>

			{/* ── Inline styles ──────────────────────────────────────────── */}
			<style>{`
				@keyframes live-pulse {
					0%, 100% { opacity: 0.4; }
					50% { opacity: 1; }
				}
				.live-pulse { animation: live-pulse 1.8s ease-in-out infinite; }

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
				@media (prefers-reduced-motion: reduce) {
					.stagger-1, .stagger-2, .stagger-3, .stagger-4, .stagger-5, .stagger-6 {
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
					padding: 14px 22px;
					border-radius: 2px;
					font-family: var(--font-display);
					font-size: 12px;
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

/* ────────────────────────────────────────────────────────────────────── */
/*  Components                                                            */
/* ────────────────────────────────────────────────────────────────────── */

function Stat({
	numeral,
	label,
	value,
}: {
	numeral: string
	label: string
	value: string
}) {
	return (
		<div>
			<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink mb-1">
				{numeral} {label}
			</div>
			<div className="font-display text-[20px] tracking-tight text-ink">
				{value}
			</div>
		</div>
	)
}

/*
 * MomentTranscript — a typographic transcript→action timeline.
 *
 * Two-column rhythm: timestamp + speaker tag on the left, then the spoken
 * line OR a typed canvas-event line. Spoken lines are sans; canvas events
 * are mono with an olive marker to read as instrument-rolls beside the
 * speech. The whole block reads like an editorial transcript of one
 * minute of a meeting — first paper, then ink.
 */
function MomentTranscript() {
	const rows: Array<{
		time: string
		actor: string
		actorClass?: string
		body: string
		bodyClass?: string
	}> = [
		{
			time: '00:23',
			actor: '[S0]',
			body: 'I think we should target enterprise customers in Q3.',
		},
		{
			time: '00:24',
			actor: '→',
			actorClass: 'text-olive',
			body: 'create_proposal_card  p1',
			bodyClass: 'font-mono text-faded-ink',
		},
		{
			time: '00:31',
			actor: '[S1]',
			body: 'Or SMB — conversion rates are three times higher.',
		},
		{
			time: '00:32',
			actor: '→',
			actorClass: 'text-olive',
			body: 'create_proposal_card  p2  ·  link_nodes  p2 →counters p1',
			bodyClass: 'font-mono text-faded-ink',
		},
		{
			time: '00:40',
			actor: '[S0]',
			body: 'OK, agreed — let\'s go SMB.',
		},
		{
			time: '00:41',
			actor: '→',
			actorClass: 'text-olive',
			body: 'create_decision_card  d1  ·  link_nodes  p2 →decides d1  ·  lock_decision',
			bodyClass: 'font-mono text-faded-ink',
		},
		{
			time: '00:50',
			actor: '[S0]',
			body: 'Alice will own the SMB outreach plan by next Friday.',
		},
		{
			time: '00:51',
			actor: '→',
			actorClass: 'text-olive',
			body: 'create_commitment_card  c1  ·  ownerSpeakerId=S2',
			bodyClass: 'font-mono text-faded-ink',
		},
		{
			time: '00:56',
			actor: '[S0]',
			body: 'Add a yellow sticky for the post-Q3 review.',
			bodyClass: 'italic text-ink',
		},
		{
			time: '00:57',
			actor: '→',
			actorClass: 'text-ochre',
			body: 'create_note  · "post-Q3 review"  · yellow',
			bodyClass: 'font-mono text-faded-ink',
		},
	]
	return (
		<div className="border border-hairline bg-paper rounded-sm overflow-hidden">
			<div className="px-5 py-3 border-b border-hairline flex items-center justify-between">
				<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink">
					Transcript · 00:23 → 00:57
				</div>
				<div className="font-mono text-[10px] uppercase tracking-[0.22em] text-faded-ink flex items-center gap-2">
					<span
						className="w-1.5 h-1.5 bg-crimson rounded-full live-pulse"
						aria-hidden="true"
					/>
					<span>Listening</span>
				</div>
			</div>
			<div className="px-5 py-4 flex flex-col gap-3 font-sans text-[14px] leading-[1.55]">
				{rows.map((r, i) => (
					<div
						key={`${r.time}-${i}`}
						className="grid grid-cols-[56px_44px_1fr] gap-3 items-baseline"
					>
						<span className="font-mono text-[11px] text-faded-ink">
							{r.time}
						</span>
						<span
							className={`font-mono text-[11px] ${r.actorClass ?? 'text-faded-ink'}`}
						>
							{r.actor}
						</span>
						<span
							className={`text-[14px] text-ink ${r.bodyClass ?? ''}`}
						>
							{r.body}
						</span>
					</div>
				))}
			</div>
		</div>
	)
}

/*
 * InputPanel — one of the two side-by-side surfaces in §II. Mirrors the
 * actual in-app chrome (header bar, sub-label, ink-divider, body lines)
 * so the page reads as a faithful preview of the real UI.
 */
function InputPanel({
	title,
	subtitle,
	icon,
	lines,
}: {
	title: string
	subtitle: string
	icon: React.ReactNode
	lines: Array<{ tag: string; text: string }>
}) {
	return (
		<div className="border border-hairline bg-paper rounded-sm overflow-hidden flex flex-col">
			<div className="px-5 py-3 border-b border-hairline flex items-center gap-3">
				{icon}
				<span className="font-display text-[11px] uppercase tracking-[0.22em] text-ink">
					{title}
				</span>
				<span className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-faded-ink">
					{subtitle}
				</span>
			</div>
			<div className="px-5 py-5 flex flex-col gap-3">
				{lines.map((l, i) => (
					<div
						key={i}
						className="grid grid-cols-[34px_1fr] gap-3 items-baseline"
					>
						<span
							className={`font-mono text-[11px] ${
								l.tag.startsWith('[') || l.tag === '>'
									? 'text-faded-ink'
									: 'text-olive'
							}`}
						>
							{l.tag}
						</span>
						<span
							className={`text-[13.5px] leading-[1.5] ${
								l.tag === '→' || l.tag === '+'
									? 'font-mono text-faded-ink'
									: 'font-sans text-ink'
							}`}
						>
							{l.text}
						</span>
					</div>
				))}
			</div>
		</div>
	)
}

/*
 * AtlasColumn — one column of the action atlas. Mono action names with a
 * small olive bullet — looks like an old type specimen book's character set.
 */
function AtlasColumn({
	title,
	caption,
	items,
	offsetTop,
}: {
	title: string
	caption: string
	items: string[]
	offsetTop?: boolean
}) {
	return (
		<div className={offsetTop ? 'sm:mt-0 lg:mt-12' : ''}>
			<div className="font-display text-[13px] uppercase tracking-[0.22em] text-ink mb-1">
				{title}
			</div>
			<div className="font-mono text-[10px] uppercase tracking-[0.18em] text-faded-ink mb-5 border-b border-hairline pb-3">
				{caption}
			</div>
			<ul className="flex flex-col gap-2">
				{items.map((name) => (
					<li
						key={name}
						className="font-mono text-[12.5px] text-ink flex items-center gap-2.5"
					>
						<span
							className="w-1 h-1 bg-olive rounded-full shrink-0"
							aria-hidden="true"
						/>
						<span>{name}</span>
					</li>
				))}
			</ul>
		</div>
	)
}

function MethodNote({ label, body }: { label: string; body: string }) {
	return (
		<p className="text-[15px] leading-[1.65] text-ink font-sans">
			<span className="font-display uppercase tracking-[0.18em] text-[12px] text-olive mr-2">
				{label}
			</span>
			{body}
		</p>
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

/*
 * NoteSpecimen — yellow sticky-note preview matching the live tldraw note
 * shape. Tilted ~1.5° for character. Body in the "draw" handwriting voice
 * (Caveat-ish via Fraunces italic on paper — close enough for marketing).
 */
function NoteSpecimen({ body }: { body: string }) {
	return (
		<div className="max-w-[420px]">
			<div
				className="relative w-[170px] h-[170px] flex items-center justify-center text-center p-4"
				style={{
					background: '#f7e08a',
					transform: 'rotate(-1.5deg)',
					boxShadow:
						'0 1px 0 rgba(26,24,21,0.08), 0 8px 24px -12px rgba(26,24,21,0.25)',
				}}
			>
				<span
					className="font-display italic text-ink text-[18px] leading-[1.25]"
					style={{ fontWeight: 500 }}
				>
					{body}
				</span>
			</div>
		</div>
	)
}

function GeoSpecimen({ body }: { body: string }) {
	return (
		<div
			className="max-w-[420px] w-[260px] h-[110px] rounded-sm flex items-center justify-center"
			style={{
				background: 'rgba(184,38,38,0.06)',
				border: '1.5px solid var(--color-crimson)',
				boxShadow:
					'0 1px 0 rgba(26,24,21,0.08), 0 8px 24px -12px rgba(26,24,21,0.18)',
			}}
		>
			<span className="font-display text-[18px] text-crimson tracking-tight">
				{body}
			</span>
		</div>
	)
}

function TextSpecimen({ body }: { body: string }) {
	return (
		<div className="max-w-[420px] flex items-center gap-3">
			<span className="font-display text-[28px] tracking-tight text-ink leading-none">
				{body.split(' ·')[0]}
			</span>
			<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faded-ink mt-2">
				{body.split(' ·')[1]}
			</span>
		</div>
	)
}
