import { ActionSchema, type Action } from '@/lib/actions/schema'
import type { Room } from '@server/room'

/**
 * Shared action normalization + validation, factored out of
 * `lib/agent/runner.ts` so both the chat agent and the voice MODE-B agent
 * can run the same prepare-an-Action pipeline.
 *
 * The function this file exists for is `prepareAction(raw, room)`:
 *
 *     raw (anything LLM emitted) → prepareAction → {ok: true, action: Action}
 *                                                  | {ok: false, error: string}
 *
 * NO side effects. The caller decides what to do with the validated Action
 * (record + broadcast, dedup-against-tick, persist, etc.). The chat agent
 * goes straight from `prepareAction` → record + broadcast with source='chat'.
 * The voice MODE-B agent goes `prepareAction` → per-action dedup → record
 * + broadcast with source='voice'.
 *
 * Stages run inside prepareAction:
 *   1. stripNulls            — Gemini emits {layout: null}; Zod `.optional()`
 *                              rejects literal null, so we drop nulls first.
 *   2. normalizeActionType   — map "create_blocker" → "create_blocker_card",
 *                              "create_circle" → "create_geo {geo:ellipse}",
 *                              etc., before Zod sees the payload.
 *   3. inferActionType       — when `type` is missing entirely, best-guess it
 *                              from the payload shape.
 *   4. ts injection          — proposal_card without ts gets Date.now().
 *   5. validateLayout        — drop a malformed `layout` field rather than
 *                              fail the whole action.
 *   6. ActionSchema parse    — Zod-validate against the 28-action union.
 *   7. validateActionRefs    — for manipulation/grouping/linking actions,
 *                              confirm the referenced ids exist in
 *                              room.canvasShapes (catches invented ids).
 */

// Native tldraw shape action types that accept set_shape_style. L1 thinking
// cards (proposal/decision/etc.) are custom shapes without color/fill/dash
// props — set_shape_style on them silently no-ops in the apply pipeline,
// which the model currently can't tell apart from a successful styling.
// Listing the supported types here lets us return a clear error instead.
const STYLABLE_TYPES = new Set([
	'create_geo',
	'create_note',
	'create_text',
	'create_arrow',
])

export type PrepareResult =
	| { ok: true; action: Action }
	| { ok: false; error: string }

/**
 * Normalize → Zod-validate → ref-validate a raw LLM-emitted action against
 * the live room state. No side effects: caller persists/broadcasts.
 *
 * Pass a `surface` string ("agent" / "voice") so log lines from the
 * normalize/infer steps stay attributable. Empirical drift patterns differ
 * slightly between the two surfaces so seeing them in logs helps tuning.
 */
export function prepareAction(
	raw: unknown,
	room: Room,
	surface: 'agent' | 'voice' = 'agent',
): PrepareResult {
	const cleaned = stripNulls(raw)
	if (cleaned && typeof cleaned === 'object') {
		const obj = cleaned as Record<string, unknown>
		const t = obj.type
		if (typeof t === 'string') {
			const { type: norm, defaults } = normalizeActionType(t)
			if (norm !== t) {
				console.log(
					`[${surface}] normalized type "${t}" → "${norm}"${
						Object.keys(defaults).length > 0
							? ` (defaults: ${JSON.stringify(defaults)})`
							: ''
					}`,
				)
				obj.type = norm
				for (const [k, v] of Object.entries(defaults)) {
					if (!(k in obj)) obj[k] = v
				}
			}
		} else {
			const inferred = inferActionType(obj)
			if (inferred) {
				console.log(
					`[${surface}] inferred type="${inferred}" from payload shape`,
				)
				obj.type = inferred
			}
		}
	}
	if (
		cleaned &&
		typeof cleaned === 'object' &&
		(cleaned as { type?: string }).type === 'create_proposal_card' &&
		typeof (cleaned as { ts?: unknown }).ts !== 'number'
	) {
		;(cleaned as { ts: number }).ts = Date.now()
	}
	if (cleaned && typeof cleaned === 'object') {
		const layout = (cleaned as { layout?: unknown }).layout as
			| { kind?: unknown; of?: unknown; columns?: unknown; nodeIds?: unknown }
			| undefined
		if (layout && typeof layout === 'object') {
			const kind = layout.kind
			const stripReason = validateLayout(kind, layout)
			if (stripReason) {
				console.log(`[${surface}] stripped layout — ${stripReason}`)
				delete (cleaned as { layout?: unknown }).layout
			}
		}
	}

	const parsed = ActionSchema.safeParse(cleaned)
	if (!parsed.success) {
		const summary = parsed.error.issues
			.slice(0, 3)
			.map((i) => `${i.path.join('.')}: ${i.message}`)
			.join('; ')
		const rawType =
			cleaned && typeof cleaned === 'object'
				? (cleaned as { type?: unknown }).type
				: undefined
		console.warn(
			`[${surface}] action rejected (sent type=${JSON.stringify(rawType)}): ${summary}`,
		)
		try {
			console.warn(
				`[${surface}] rejected payload:`,
				JSON.stringify(cleaned).slice(0, 400),
			)
		} catch {}
		return { ok: false, error: `invalid action — ${summary}` }
	}

	const action = parsed.data
	const refError = validateActionRefs(action, room)
	if (refError) {
		console.warn(`[${surface}] action rejected (bad refs): ${refError}`)
		return { ok: false, error: refError }
	}

	return { ok: true, action }
}

/**
 * Reject actions whose ids reference shapes that don't exist on the canvas.
 * Returns a human-readable error string the model will see in the next step
 * (it then knows to call find_shapes / read_canvas and retry); returns null
 * when the action's refs are clean OR the action doesn't carry any refs to
 * validate (creates, free-form arrows, etc.).
 */
export function validateActionRefs(action: Action, room: Room): string | null {
	const exists = (id: string) => room.canvasShapes.has(id)
	switch (action.type) {
		case 'update_card':
		case 'lock_decision':
		case 'move_shape':
		case 'resize_shape':
			if (!exists(action.id)) {
				return `${action.type}: id "${action.id}" not found on canvas — call find_shapes or read_canvas to get the real ids before retrying`
			}
			return null
		case 'set_shape_style': {
			if (!exists(action.id)) {
				return `set_shape_style: id "${action.id}" not found on canvas — call find_shapes or read_canvas to get the real ids before retrying`
			}
			const shape = room.canvasShapes.get(action.id)
			if (shape && !STYLABLE_TYPES.has(shape.type)) {
				return `set_shape_style: shape "${action.id}" is a ${shape.type} — L1 thinking cards (proposal/decision/blocker/commitment/question) have fixed styling and don't accept set_shape_style. Add a colored create_note next to it instead, or use update_card to change its content.`
			}
			return null
		}
		case 'link_nodes': {
			const missing: string[] = []
			if (!exists(action.from)) missing.push(action.from)
			if (!exists(action.to)) missing.push(action.to)
			if (missing.length > 0) {
				return `link_nodes references unknown ids: ${missing.join(', ')} — call find_shapes or read_canvas first`
			}
			return null
		}
		case 'group_into_frame': {
			const valid = action.nodeIds.filter(exists)
			if (valid.length < 2) {
				return `group_into_frame: ${action.nodeIds.length} nodeIds supplied but only ${valid.length} match existing canvas shapes — call find_shapes (e.g. find_shapes({type:"create_commitment_card"})) to get the real ids, then retry with at least 2 real ids`
			}
			return null
		}
		case 'delete_shapes':
		case 'reorder_shapes':
		case 'align_shapes':
		case 'distribute_shapes': {
			const valid = action.ids.filter(exists)
			if (valid.length === 0) {
				return `${action.type}: none of [${action.ids.join(', ')}] exist on canvas — call find_shapes or read_canvas first`
			}
			return null
		}
		case 'zoom_to_shapes': {
			if (action.ids && action.ids.length > 0) {
				const valid = action.ids.filter(exists)
				if (valid.length === 0) {
					return `zoom_to_shapes: none of [${action.ids.join(', ')}] exist — pass an empty/omitted ids to zoom-to-fit everything, or call find_shapes first`
				}
			}
			return null
		}
		default:
			return null
	}
}

function validateLayout(
	kind: unknown,
	layout: { of?: unknown; columns?: unknown; nodeIds?: unknown },
): string | null {
	if (typeof kind !== 'string') return 'layout.kind missing or non-string'
	switch (kind) {
		case 'below':
		case 'above':
		case 'right_of':
		case 'left_of':
		case 'inside_frame':
			if (typeof layout.of !== 'string' || layout.of.length === 0) {
				return `layout.kind="${kind}" missing required \`of\` string`
			}
			return null
		case 'grid':
			if (
				typeof layout.columns !== 'number' ||
				!Number.isFinite(layout.columns) ||
				layout.columns <= 0
			) {
				return `layout.kind="grid" missing required \`columns\` positive integer`
			}
			return null
		case 'cluster_with':
			if (
				!Array.isArray(layout.nodeIds) ||
				layout.nodeIds.length === 0 ||
				!layout.nodeIds.every((n) => typeof n === 'string')
			) {
				return `layout.kind="cluster_with" missing/invalid \`nodeIds\` string[]`
			}
			return null
		default:
			return `layout.kind="${kind}" not in {below,above,right_of,left_of,inside_frame,grid,cluster_with}`
	}
}

function inferActionType(o: Record<string, unknown>): string | null {
	if ('patch' in o && 'id' in o) return 'update_card'
	if ('from' in o && 'to' in o) return 'link_nodes'
	if (
		'start' in o &&
		'end' in o &&
		typeof o.start === 'object' &&
		typeof o.end === 'object' &&
		o.start !== null &&
		o.end !== null &&
		'x' in (o.start as object)
	) {
		return 'create_arrow'
	}
	if ('ids' in o && 'op' in o && typeof o.op === 'string') {
		const op = o.op
		if (
			op === 'left' || op === 'right' || op === 'top' || op === 'bottom' ||
			op === 'center-horizontal' || op === 'center-vertical'
		) {
			return 'align_shapes'
		}
		if (op === 'horizontal' || op === 'vertical') return 'distribute_shapes'
		if (
			op === 'to_front' || op === 'to_back' ||
			op === 'forward' || op === 'backward'
		) {
			return 'reorder_shapes'
		}
	}
	if ('ids' in o && Array.isArray(o.ids) && Object.keys(o).length === 1) {
		return 'delete_shapes'
	}
	if ('id' in o && ('w' in o || 'h' in o) && !('geo' in o) && !('content' in o)) {
		return 'resize_shape'
	}
	if (
		'id' in o &&
		('x' in o || 'y' in o || 'dx' in o || 'dy' in o) &&
		!('content' in o) &&
		!('geo' in o)
	) {
		return 'move_shape'
	}
	if (
		'id' in o &&
		('color' in o || 'fill' in o || 'dash' in o || 'size' in o || 'font' in o) &&
		!('content' in o) &&
		!('geo' in o) &&
		!('items' in o) &&
		!('splits' in o) &&
		!('start' in o)
	) {
		return 'set_shape_style'
	}
	if ('geo' in o) return 'create_geo'
	if ('splits' in o) return 'create_budget_allocator'
	if ('items' in o && Array.isArray(o.items)) {
		const first = (o.items as unknown[])[0]
		if (first && typeof first === 'object') {
			if ('impact' in (first as object)) return 'create_priority_matrix'
			if ('startDays' in (first as object)) return 'create_gantt'
		}
		return 'create_priority_matrix'
	}
	if ('blockedNodeIds' in o) return 'create_blocker_card'
	if ('sourceProposalIds' in o) return 'create_decision_card'
	if ('askedBySpeakerId' in o) return 'create_question_card'
	if ('proposerSpeakerId' in o) return 'create_proposal_card'
	if ('ownerSpeakerId' in o && 'action' in o) return 'create_commitment_card'
	if ('nodeIds' in o && 'label' in o && !('id' in o)) return 'group_into_frame'
	if ('id' in o && 'content' in o && Object.keys(o).length <= 4) {
		return 'create_note'
	}
	return null
}

function normalizeActionType(
	input: string,
): { type: string; defaults: Record<string, unknown> } {
	const key = input
		.toLowerCase()
		.replace(/[\s-]+/g, '_')
		.replace(/[^a-z_]/g, '')
		.replace(/^(add|make|emit|new)_/, 'create_')
	const ALIASES: Record<string, [string, Record<string, unknown>?]> = {
		create_proposal: ['create_proposal_card'],
		create_decision: ['create_decision_card'],
		create_commitment: ['create_commitment_card'],
		create_blocker: ['create_blocker_card'],
		create_question: ['create_question_card'],
		proposal_card: ['create_proposal_card'],
		decision_card: ['create_decision_card'],
		commitment_card: ['create_commitment_card'],
		blocker_card: ['create_blocker_card'],
		question_card: ['create_question_card'],
		proposal: ['create_proposal_card'],
		decision: ['create_decision_card'],
		commitment: ['create_commitment_card'],
		blocker: ['create_blocker_card'],
		question: ['create_question_card'],
		create_sticky_note: ['create_note'],
		create_sticky: ['create_note'],
		create_text_note: ['create_note'],
		create_text_card: ['create_note'],
		sticky_note: ['create_note'],
		sticky: ['create_note'],
		note: ['create_note'],
		create_box: ['create_geo', { geo: 'rectangle' }],
		create_rectangle: ['create_geo', { geo: 'rectangle' }],
		create_rect: ['create_geo', { geo: 'rectangle' }],
		create_circle: ['create_geo', { geo: 'ellipse' }],
		create_ellipse: ['create_geo', { geo: 'ellipse' }],
		create_oval: ['create_geo', { geo: 'oval' }],
		create_triangle: ['create_geo', { geo: 'triangle' }],
		create_diamond: ['create_geo', { geo: 'diamond' }],
		create_pentagon: ['create_geo', { geo: 'pentagon' }],
		create_hexagon: ['create_geo', { geo: 'hexagon' }],
		create_octagon: ['create_geo', { geo: 'octagon' }],
		create_star: ['create_geo', { geo: 'star' }],
		create_heart: ['create_geo', { geo: 'heart' }],
		create_cloud: ['create_geo', { geo: 'cloud' }],
		create_trapezoid: ['create_geo', { geo: 'trapezoid' }],
		create_rhombus: ['create_geo', { geo: 'rhombus' }],
		create_check_box: ['create_geo', { geo: 'check-box' }],
		create_checkbox: ['create_geo', { geo: 'check-box' }],
		create_x_box: ['create_geo', { geo: 'x-box' }],
		create_shape: ['create_geo'],
		create_geo_shape: ['create_geo'],
		box: ['create_geo', { geo: 'rectangle' }],
		rectangle: ['create_geo', { geo: 'rectangle' }],
		circle: ['create_geo', { geo: 'ellipse' }],
		ellipse: ['create_geo', { geo: 'ellipse' }],
		triangle: ['create_geo', { geo: 'triangle' }],
		diamond: ['create_geo', { geo: 'diamond' }],
		create_label: ['create_text'],
		create_heading: ['create_text', { size: 'l' }],
		create_title: ['create_text', { size: 'xl' }],
		text: ['create_text'],
		label: ['create_text'],
		heading: ['create_text', { size: 'l' }],
		title: ['create_text', { size: 'xl' }],
		create_matrix: ['create_priority_matrix'],
		priority_matrix: ['create_priority_matrix'],
		create_budget: ['create_budget_allocator'],
		budget_allocator: ['create_budget_allocator'],
		create_link: ['link_nodes'],
		link: ['link_nodes'],
		lock: ['lock_decision'],
		update: ['update_card'],
		group: ['group_into_frame'],
		delete: ['delete_shapes'],
		delete_shape: ['delete_shapes'],
		remove: ['delete_shapes'],
		remove_shape: ['delete_shapes'],
		remove_shapes: ['delete_shapes'],
		move: ['move_shape'],
		reposition: ['move_shape'],
		resize: ['resize_shape'],
		set_style: ['set_shape_style'],
		set_color: ['set_shape_style'],
		recolor: ['set_shape_style'],
		style: ['set_shape_style'],
		align: ['align_shapes'],
		distribute: ['distribute_shapes'],
		space: ['distribute_shapes'],
		reorder: ['reorder_shapes'],
		bring_to_front: ['reorder_shapes', { op: 'to_front' }],
		send_to_back: ['reorder_shapes', { op: 'to_back' }],
		bring_forward: ['reorder_shapes', { op: 'forward' }],
		send_backward: ['reorder_shapes', { op: 'backward' }],
		zoom: ['zoom_to_shapes'],
		zoom_to_fit: ['zoom_to_shapes'],
		fit: ['zoom_to_shapes'],
		focus: ['zoom_to_shapes'],
		create_freeform_arrow: ['create_arrow'],
		create_unbound_arrow: ['create_arrow'],
		arrow: ['create_arrow'],
	}
	const hit = ALIASES[key]
	if (!hit) return { type: input, defaults: {} }
	return { type: hit[0], defaults: hit[1] ?? {} }
}

function stripNulls(value: unknown): unknown {
	if (value == null) return value
	if (Array.isArray(value)) return value.map(stripNulls)
	if (typeof value !== 'object') return value
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (v === null) continue
		out[k] = stripNulls(v)
	}
	return out
}
