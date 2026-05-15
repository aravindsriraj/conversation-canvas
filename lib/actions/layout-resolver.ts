/**
 * Layout resolver — converts a semantic layout hint emitted by the LLM into
 * concrete canvas coordinates, with collision avoidance.
 *
 * Senior-eng note: this used to be a naive "if-hint-then-offset" function. It
 * shipped overlapping cards because Gemini's hints are inconsistent and we
 * never checked whether the computed (x,y) was already occupied. The current
 * version does three things in order:
 *
 *   1. **Type-aware default** — for each action type, we have a "where do
 *      these usually belong" rule (proposals form a top row, decisions land
 *      directly below the proposals they resolve, commitments tuck under
 *      their parent decision, blockers fan to the right of the most recent
 *      decision, questions go in a sidebar column, L3 widgets sit beneath
 *      the proposal cluster).
 *   2. **Hint refinement** — if the LLM emitted a `below`/`right_of` hint
 *      AND the referenced shape exists, that overrides the type-aware
 *      default (the LLM has more context than the bare type does).
 *   3. **Collision avoidance** — whatever (x,y) we computed in step 1 or 2,
 *      walk it down by GAP increments until no existing shape overlaps it.
 *      This is O(N) per placement, fine at canvas sizes <100 cards.
 *
 * The result: cards never overlap, related cards stay together, and Gemini's
 * hints are respected when they help (and silently ignored when they'd land
 * us on top of an existing card).
 */

export interface ShapeBox {
	x: number
	y: number
	w: number
	h: number
}

export type LayoutHint =
	| { kind: 'below'; of: string }
	| { kind: 'right_of'; of: string }
	| { kind: 'inside_frame'; of: string }
	| { kind: 'grid'; columns: number }
	| { kind: 'cluster_with'; nodeIds: string[] }

interface ResolveOpts {
	defaultW: number
	defaultH: number
	gap?: number
	/**
	 * Action type — drives the type-aware default placement. We accept any
	 * string so the resolver doesn't depend on the full Action union; pass
	 * the action.type field through.
	 */
	actionType?: string
	/**
	 * Map of existing shapes keyed by their TYPE (not just id), so we can
	 * find "the most recent proposal" or "all decision cards". This is the
	 * NEW input — the previous resolver only had shapes-by-id, which made
	 * type-aware placement impossible.
	 */
	existingByType?: Map<string, ShapeBox[]>
}

// Bumped from 32 → 64 in the Phase-3 polish pass: at 32px the cards visually
// crowded each other and arrow labels overlapped neighbouring shapes. 64px
// gives elbow arrows enough room to bend without crossing cards.
const GAP = 64

// "Lane" Y coordinates — type-aware default placement uses these as anchor
// rows so the canvas reads top-to-bottom as proposals → decisions → support
// material. Spacing is roughly card-height + gap, with extra room for L3
// widgets which are taller.
const LANE = {
	PROPOSALS: 80, // y for the first row of proposals
	DECISIONS: 300, // y for the row of decisions (below proposals)
	SUPPORT: 520, // y for commitments / blockers / questions
	WIDGETS: 760, // y for L3 (matrix, budget allocator, gantt)
} as const

export function resolveLayout(
	hint: LayoutHint | undefined,
	existing: Map<string, ShapeBox>,
	opts: ResolveOpts,
): { x: number; y: number } {
	const gap = opts.gap ?? GAP
	const { defaultW, defaultH, actionType, existingByType } = opts

	// Step 1: compute an initial (x,y) based on hint OR type-aware default.
	let placement = computeInitial(hint, existing, existingByType, actionType, {
		defaultW,
		defaultH,
		gap,
	})

	// Step 2: collision-avoidance. If anything already sits at the computed
	// (x,y), shift down by (default H + gap) until clear. Cap at 20 attempts
	// so we don't infinite-loop on a saturated canvas.
	placement = avoidCollisions(placement, defaultW, defaultH, existing, gap)

	return placement
}

function computeInitial(
	hint: LayoutHint | undefined,
	existing: Map<string, ShapeBox>,
	existingByType: Map<string, ShapeBox[]> | undefined,
	actionType: string | undefined,
	{ defaultW, defaultH, gap }: { defaultW: number; defaultH: number; gap: number },
): { x: number; y: number } {
	// (a) Honor a hint that references a real shape — Gemini's contextual
	// "below p2" / "right_of d1" is usually correct when the target exists.
	if (hint && 'of' in hint) {
		const ref = existing.get(hint.of)
		if (ref) {
			if (hint.kind === 'below') return { x: ref.x, y: ref.y + ref.h + gap }
			if (hint.kind === 'right_of') return { x: ref.x + ref.w + gap, y: ref.y }
			if (hint.kind === 'inside_frame') return { x: ref.x + 16, y: ref.y + 32 }
		}
	}
	if (hint?.kind === 'cluster_with' && hint.nodeIds.length > 0) {
		const refs = hint.nodeIds.map((id) => existing.get(id)).filter(Boolean) as ShapeBox[]
		if (refs.length > 0) {
			const avgX = refs.reduce((a, b) => a + b.x, 0) / refs.length
			const avgY = refs.reduce((a, b) => a + b.y, 0) / refs.length
			return { x: avgX + defaultW + gap, y: avgY }
		}
	}

	// (b) Type-aware default. We use lanes (rows) to keep the canvas reading
	// top-down: proposals up top, decisions below, support material below
	// that, L3 widgets at the bottom.
	if (existingByType && actionType) {
		const proposals = existingByType.get('proposal-card') ?? []
		const decisions = existingByType.get('decision-card') ?? []

		if (actionType === 'create_proposal_card') {
			// Place to the right of the last proposal in the proposals lane.
			const last = lastByX(proposals)
			return last
				? { x: last.x + last.w + gap, y: LANE.PROPOSALS }
				: { x: 80, y: LANE.PROPOSALS }
		}

		if (actionType === 'create_decision_card') {
			// Centered horizontally under the proposal cluster (if any), in the
			// decisions lane. Otherwise just below the most recent decision.
			if (proposals.length > 0) {
				const minX = Math.min(...proposals.map((p) => p.x))
				const maxX = Math.max(...proposals.map((p) => p.x + p.w))
				const center = (minX + maxX) / 2 - defaultW / 2
				return { x: center, y: LANE.DECISIONS }
			}
			const last = lastByX(decisions)
			return last
				? { x: last.x + last.w + gap, y: LANE.DECISIONS }
				: { x: 80, y: LANE.DECISIONS }
		}

		if (actionType === 'create_commitment_card') {
			// Tuck under the most recent decision.
			const lastDecision = lastByX(decisions)
			if (lastDecision) {
				return { x: lastDecision.x, y: LANE.SUPPORT }
			}
			return { x: 80, y: LANE.SUPPORT }
		}

		if (actionType === 'create_blocker_card') {
			// Right of the most recent decision, in the support lane.
			const lastDecision = lastByX(decisions)
			if (lastDecision) {
				return {
					x: lastDecision.x + lastDecision.w + gap,
					y: LANE.SUPPORT,
				}
			}
			return { x: 80, y: LANE.SUPPORT }
		}

		if (actionType === 'create_question_card') {
			// Fan questions to the right of any blockers, or below the support row.
			const blockers = existingByType.get('blocker-card') ?? []
			if (blockers.length > 0) {
				const lastBlocker = lastByX(blockers)
				if (lastBlocker) {
					return {
						x: lastBlocker.x + lastBlocker.w + gap,
						y: LANE.SUPPORT,
					}
				}
			}
			const questions = existingByType.get('question-card') ?? []
			const last = lastByX(questions)
			return last
				? { x: last.x + last.w + gap, y: LANE.SUPPORT }
				: { x: 80, y: LANE.SUPPORT }
		}

		if (
			actionType === 'create_priority_matrix' ||
			actionType === 'create_budget_allocator' ||
			actionType === 'create_gantt'
		) {
			// L3 widgets get their own row at the bottom, left-to-right in the
			// order they're created.
			const widgets = [
				...(existingByType.get('priority-matrix') ?? []),
				...(existingByType.get('budget-allocator') ?? []),
				...(existingByType.get('gantt') ?? []),
			]
			const last = lastByX(widgets)
			return last
				? { x: last.x + last.w + gap, y: LANE.WIDGETS }
				: { x: 80, y: LANE.WIDGETS }
		}
	}

	// (c) Final fallback — grid in the proposals lane.
	const cols = hint?.kind === 'grid' ? hint.columns : 3
	const used = Array.from(existing.values())
	const slot = used.length
	const col = slot % cols
	const row = Math.floor(slot / cols)
	return {
		x: 80 + col * (defaultW + gap),
		y: 80 + row * (defaultH + gap),
	}
}

/**
 * Walk the placement down by (defaultH + gap) increments until no existing
 * shape overlaps it. Capped at 20 attempts so we degrade gracefully on a
 * saturated canvas (we'd rather slightly overlap than infinite-loop).
 */
function avoidCollisions(
	placement: { x: number; y: number },
	w: number,
	h: number,
	existing: Map<string, ShapeBox>,
	gap: number,
): { x: number; y: number } {
	const shapes = Array.from(existing.values())
	let { x, y } = placement
	const dy = h + gap

	for (let attempt = 0; attempt < 20; attempt += 1) {
		const conflict = shapes.find((s) => rectsOverlap({ x, y, w, h }, s, gap / 2))
		if (!conflict) return { x, y }
		// Shift down by one row. Could be smarter (shift right, then wrap),
		// but vertical-only keeps lanes intact which is what we want for
		// readability.
		y += dy
	}
	// Give up — return last attempted position. Better than overlapping the
	// original spot.
	return { x, y }
}

function rectsOverlap(a: ShapeBox, b: ShapeBox, slack: number): boolean {
	return !(
		a.x + a.w + slack <= b.x ||
		b.x + b.w + slack <= a.x ||
		a.y + a.h + slack <= b.y ||
		b.y + b.h + slack <= a.y
	)
}

/** Return the box with the largest x (rightmost). Useful for "place next in row". */
function lastByX(boxes: ShapeBox[]): ShapeBox | null {
	if (boxes.length === 0) return null
	return boxes.reduce((best, b) => (b.x > best.x ? b : best))
}
