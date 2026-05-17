import { createShapeId, type Editor, type TLShapeId, toRichText } from 'tldraw'
import { createMermaidDiagram, MermaidDiagramError } from '@tldraw/mermaid'
import type { Action } from '@/lib/actions/schema'
import { resolveLayout, type ShapeBox } from '@/lib/actions/layout-resolver'

type Registry = Record<string, { displayName: string; color: string }>

/**
 * Map orchestrator model ids ("p1", "d1", ...) to the deterministic tldraw
 * shape ids derived from them via `createShapeId(modelId)`. The map is also
 * used to drive layout — we need to read back live box coordinates for any
 * card we previously created so subsequent `layout: { kind: "below", of: ... }`
 * hints resolve correctly.
 *
 * Module-level state is intentional: `applyAction` is called once per action
 * across many WS messages, the registry must persist across calls within the
 * page lifetime. (A page reload resets it, which is fine — the server replays
 * history on `join` and we rebuild from scratch.)
 */
const ID_MAP = new Map<string, TLShapeId>()

function tldrawId(modelId: string): TLShapeId {
	let id = ID_MAP.get(modelId)
	if (!id) {
		id = createShapeId(modelId)
		ID_MAP.set(modelId, id)
	}
	return id
}

/**
 * After a snapshot restore the editor already has all the shapes but our
 * module-level ID_MAP is empty (page reloaded). Walk the editor's current
 * shapes and re-derive the modelId → TLShapeId mapping. We rely on
 * `createShapeId(modelId)` returning `"shape:" + modelId` deterministically;
 * if tldraw ever changes that prefix this needs to walk shape.meta instead.
 *
 * Idempotent and cheap. Call after `loadSnapshot()`.
 */
export function rebuildIdMapFromEditor(editor: Editor): void {
	ID_MAP.clear()
	for (const shape of editor.getCurrentPageShapes()) {
		const tlId = shape.id // 'shape:p1' style
		// Strip the 'shape:' prefix that tldraw's createShapeId prepends. Any
		// shape that doesn't start with that prefix (shouldn't happen with
		// tldraw v3) is skipped.
		if (tlId.startsWith('shape:')) {
			ID_MAP.set(tlId.slice(6), tlId)
		}
	}
}

/**
 * Idempotent createShape: if the deterministic id already has a shape in
 * the editor (because loadSnapshot restored it), skip creation. Returns
 * whether the shape was actually created. Used inside every action case
 * below so a snapshot+history replay doesn't duplicate shapes.
 */
function createShapeIfMissing(
	editor: Editor,
	spec: Parameters<Editor['createShape']>[0],
): boolean {
	if (editor.getShape(spec.id as TLShapeId)) return false
	editor.createShape(spec)
	return true
}

function getExistingBoxes(editor: Editor): {
	byId: Map<string, ShapeBox>
	byType: Map<string, ShapeBox[]>
} {
	const byId = new Map<string, ShapeBox>()
	const byType = new Map<string, ShapeBox[]>()
	for (const [modelId, shapeId] of ID_MAP.entries()) {
		// biome-ignore lint/suspicious/noExplicitAny: tldraw shape props vary per type, generic read is fine here
		const s: any = editor.getShape(shapeId)
		if (!s) continue
		const box: ShapeBox = {
			x: s.x,
			y: s.y,
			w: s.props?.w ?? 280,
			h: s.props?.h ?? 140,
		}
		byId.set(modelId, box)
		const list = byType.get(s.type) ?? []
		list.push(box)
		byType.set(s.type, list)
	}
	return { byId, byType }
}

export function applyAction(editor: Editor, action: Action, speakers: Registry) {
	const { byId: existing, byType: existingByType } = getExistingBoxes(editor)

	switch (action.type) {
		case 'create_proposal_card': {
			const sp = speakers[action.proposerSpeakerId] ?? {
				displayName: action.proposerSpeakerId,
				color: '#71717a',
			}
			const layout = resolveLayout(action.layout, existing, {
				actionType: action.type,
				existingByType,
				defaultW: 280,
				defaultH: 140,
			})
			createShapeIfMissing(editor, {
				id: tldrawId(action.id),
				type: 'proposal-card',
				x: layout.x,
				y: layout.y,
				props: {
					w: 280,
					h: 140,
					content: action.content,
					proposerName: sp.displayName,
					proposerColor: sp.color,
					status: 'open',
					ts: action.ts,
				},
			})
			break
		}
		case 'create_decision_card': {
			const layout = resolveLayout(action.layout, existing, {
				actionType: action.type,
				existingByType,
				defaultW: 320,
				defaultH: 160,
			})
			createShapeIfMissing(editor, {
				id: tldrawId(action.id),
				type: 'decision-card',
				x: layout.x,
				y: layout.y,
				props: {
					w: 320,
					h: 160,
					content: action.content,
					ownerName: action.ownerSpeakerId
						? speakers[action.ownerSpeakerId]?.displayName ?? action.ownerSpeakerId
						: '',
					ownerColor: action.ownerSpeakerId
						? speakers[action.ownerSpeakerId]?.color ?? '#71717a'
						: '#71717a',
					deadline: action.deadline ?? '',
					locked: false,
				},
			})
			// Mark source proposals as superseded/decided so the user sees the
			// proposal → decision transition reflected on existing cards. ONLY
			// proposal-card shapes carry a `status` prop — Gemini occasionally
			// puts non-proposal shapes (budget-allocator, matrix) into
			// sourceProposalIds; ignore them rather than throwing a schema
			// validation error on the wrong prop.
			if (action.sourceProposalIds) {
				for (const sid of action.sourceProposalIds) {
					const tid = ID_MAP.get(sid)
					if (!tid) continue
					// biome-ignore lint/suspicious/noExplicitAny: cross-shape prop shape
					const s: any = editor.getShape(tid)
					if (s && s.type === 'proposal-card') {
						editor.updateShape({
							id: tid,
							type: s.type,
							props: { ...s.props, status: 'decided' },
						})
					}
				}
			}
			break
		}
		case 'create_commitment_card': {
			const layout = resolveLayout(action.layout, existing, {
				actionType: action.type,
				existingByType,
				defaultW: 280,
				defaultH: 120,
			})
			const sp = speakers[action.ownerSpeakerId] ?? {
				displayName: action.ownerSpeakerId,
				color: '#71717a',
			}
			createShapeIfMissing(editor, {
				id: tldrawId(action.id),
				type: 'commitment-card',
				x: layout.x,
				y: layout.y,
				props: {
					w: 280,
					h: 120,
					action: action.action,
					ownerName: sp.displayName,
					ownerColor: sp.color,
					deadline: action.deadline ?? '',
				},
			})
			break
		}
		case 'create_blocker_card': {
			const layout = resolveLayout(action.layout, existing, {
				actionType: action.type,
				existingByType,
				defaultW: 280,
				defaultH: 100,
			})
			createShapeIfMissing(editor, {
				id: tldrawId(action.id),
				type: 'blocker-card',
				x: layout.x,
				y: layout.y,
				props: { w: 280, h: 100, content: action.content },
			})
			break
		}
		case 'create_geo': {
			// Native tldraw geo shape — gives the agent rectangle / ellipse /
			// triangle / diamond / star / heart / arrow-shaped boxes / etc.
			// for diagramming requests that don't fit meeting cards.
			const GEO_W = action.w ?? 220
			const GEO_H = action.h ?? 160
			const layout = resolveLayout(action.layout, existing, {
				actionType: action.type,
				existingByType,
				defaultW: GEO_W,
				defaultH: GEO_H,
			})
			createShapeIfMissing(editor, {
				id: tldrawId(action.id),
				type: 'geo',
				x: layout.x,
				y: layout.y,
				props: {
					// `geo` schema requires a default — Zod fills 'rectangle'.
					geo: action.geo,
					w: GEO_W,
					h: GEO_H,
					color: action.color ?? 'black',
					// `none` makes the shape an outline only; default to `semi`
					// (translucent fill) so geos read as real shapes rather
					// than ghost outlines.
					fill: action.fill ?? 'semi',
					richText: toRichText(action.content ?? ''),
				},
			})
			break
		}
		case 'create_text': {
			// Native tldraw text shape — free-floating label. Auto-sizes
			// horizontally; we let tldraw pick the height from the font/size
			// token. `w` is required by the validator but ignored when
			// autoSize is true.
			const TEXT_W = 320
			const TEXT_H = 40
			const layout = resolveLayout(action.layout, existing, {
				actionType: action.type,
				existingByType,
				defaultW: TEXT_W,
				defaultH: TEXT_H,
			})
			createShapeIfMissing(editor, {
				id: tldrawId(action.id),
				type: 'text',
				x: layout.x,
				y: layout.y,
				props: {
					richText: toRichText(action.content),
					color: action.color ?? 'black',
					size: action.size ?? 'm',
					w: TEXT_W,
					autoSize: true,
				},
			})
			break
		}
		case 'create_note': {
			// Native tldraw sticky-note shape. The user's "add a box / note / jot
			// this down" requests land here — anything the agent can't shoehorn
			// into a meeting-specific card. We use tldraw's built-in `note`
			// shape (not a custom util) so it inherits the native colour
			// palette, in-place editing, drag-to-resize, etc.
			//
			// The note shape's text lives in `richText: TLRichText`. We build
			// that with the documented `toRichText(string)` helper rather than
			// constructing the doc/paragraph tree by hand.
			const NOTE_W = 200
			const NOTE_H = 200
			const layout = resolveLayout(action.layout, existing, {
				actionType: action.type,
				existingByType,
				defaultW: NOTE_W,
				defaultH: NOTE_H,
			})
			createShapeIfMissing(editor, {
				id: tldrawId(action.id),
				type: 'note',
				x: layout.x,
				y: layout.y,
				props: {
					// `color` is a styled-prop on the native note. yellow is the
					// classic sticky-note default — only override when the
					// agent picked a colour explicitly.
					color: action.color ?? 'yellow',
					richText: toRichText(action.content),
				},
			})
			break
		}
		case 'create_question_card': {
			const layout = resolveLayout(action.layout, existing, {
				actionType: action.type,
				existingByType,
				defaultW: 280,
				defaultH: 100,
			})
			const sp = speakers[action.askedBySpeakerId] ?? {
				displayName: action.askedBySpeakerId,
				color: '#71717a',
			}
			createShapeIfMissing(editor, {
				id: tldrawId(action.id),
				type: 'question-card',
				x: layout.x,
				y: layout.y,
				props: {
					w: 280,
					h: 100,
					content: action.content,
					askerName: sp.displayName,
					askerColor: sp.color,
				},
			})
			break
		}
		case 'link_nodes': {
			const fromId = ID_MAP.get(action.from)
			const toId = ID_MAP.get(action.to)
			if (!fromId || !toId) return
			const linkColor: Record<string, string> = {
				supports: 'green',
				counters: 'red',
				contradicts: 'red',
				depends_on: 'grey',
				decides: 'orange',
				blocks: 'orange',
			}
			const arrowId = createShapeId()
			editor.createShape({
				id: arrowId,
				type: 'arrow',
				props: {
					// biome-ignore lint/suspicious/noExplicitAny: tldraw arrow color is a string literal enum
					color: (linkColor[action.kind] ?? 'grey') as any,
					// `elbow` = right-angle routing that snaps to shape edges and
					// navigates around obstacles. The default (`arc` with bend: 0
					// = straight line) ends up criss-crossing other cards and
					// makes dense canvases unreadable.
					kind: 'elbow',
					start: { x: 0, y: 0 },
					end: { x: 100, y: 0 },
					// v5: arrow text is rich-text-encoded. `toRichText(string)`
					// is the documented helper for one-line plain text.
					richText: toRichText(action.label ?? action.kind),
				},
			})
			editor.createBinding({
				type: 'arrow',
				fromId: arrowId,
				toId: fromId,
				props: {
					terminal: 'start',
					normalizedAnchor: { x: 0.5, y: 0.5 },
					isPrecise: false,
					isExact: false,
				},
			})
			editor.createBinding({
				type: 'arrow',
				fromId: arrowId,
				toId: toId,
				props: {
					terminal: 'end',
					normalizedAnchor: { x: 0.5, y: 0.5 },
					isPrecise: false,
					isExact: false,
				},
			})
			break
		}
		case 'lock_decision': {
			const tid = ID_MAP.get(action.id)
			if (!tid) return
			// biome-ignore lint/suspicious/noExplicitAny: cross-shape prop shape
			const s: any = editor.getShape(tid)
			if (s) {
				editor.updateShape({
					id: tid,
					type: s.type,
					props: { ...s.props, locked: true },
				})
			}
			break
		}
		case 'group_into_frame': {
			const layout = resolveLayout(undefined, existing, {
				actionType: action.type,
				existingByType,
				defaultW: 600,
				defaultH: 400,
				gap: 80,
			})
			const frameId = createShapeId()
			editor.createShape({
				id: frameId,
				type: 'frame',
				x: layout.x,
				y: layout.y,
				props: { w: 600, h: 400, name: action.label },
			})
			for (const nid of action.nodeIds) {
				const tid = ID_MAP.get(nid)
				if (tid) editor.reparentShapes([tid], frameId)
			}
			break
		}
		case 'update_card': {
			const tid = ID_MAP.get(action.id)
			if (!tid) return
			// biome-ignore lint/suspicious/noExplicitAny: cross-shape prop shape
			const s: any = editor.getShape(tid)
			if (!s) break
			// Filter patch to only keys that already exist on the shape's props.
			// Gemini sometimes echoes ACTION-level fields (like
			// `sourceProposalIds`, which is decision-card metadata used at
			// creation time to draw `decides` arrows — NOT a tldraw shape prop)
			// into update_card patches. tldraw's runtime validator rejects
			// unknown props, so we silently drop them with a console.warn.
			const allowed: Record<string, unknown> = {}
			for (const [k, v] of Object.entries(action.patch ?? {})) {
				if (k in s.props) {
					allowed[k] = v
				} else {
					console.warn(
						`[apply] update_card: dropping unknown prop "${k}" on ${s.type}`,
					)
				}
			}
			if (Object.keys(allowed).length > 0) {
				editor.updateShape({
					id: tid,
					type: s.type,
					props: { ...s.props, ...allowed },
				})
			}
			break
		}
		case 'create_priority_matrix': {
			const layout = resolveLayout(action.layout, existing, {
				actionType: action.type,
				existingByType,
				defaultW: 420,
				defaultH: 380,
			})
			createShapeIfMissing(editor, {
				id: tldrawId(action.id),
				type: 'priority-matrix',
				x: layout.x,
				y: layout.y,
				props: { w: 420, h: 380, items: action.items },
			})
			break
		}
		case 'create_budget_allocator': {
			const layout = resolveLayout(action.layout, existing, {
				actionType: action.type,
				existingByType,
				defaultW: 380,
				defaultH: 240,
			})
			createShapeIfMissing(editor, {
				id: tldrawId(action.id),
				type: 'budget-allocator',
				x: layout.x,
				y: layout.y,
				props: {
					w: 380,
					h: 240,
					total: action.total,
					currency: action.currency ?? '%',
					splits: action.splits,
				},
			})
			break
		}
		// L3 widgets still to implement.
		case 'create_gantt':
		case 'create_bespoke_widget':
			console.warn('[apply] L3 widget not yet implemented:', action.type)
			break

		// ────────────────────────────────────────────────────────────────
		// L4 — shape manipulation primitives. Each maps to a documented
		// Editor method. Model ids → tldraw ids via ID_MAP; missing/
		// unmapped ids are silently skipped so a partially-stale chat
		// reference doesn't crash the whole turn.
		// ────────────────────────────────────────────────────────────────
		case 'delete_shapes': {
			const tlIds = action.ids
				.map((id) => ID_MAP.get(id))
				.filter((id): id is TLShapeId => Boolean(id))
			if (tlIds.length === 0) break
			editor.deleteShapes(tlIds)
			// Also evict from ID_MAP so future `link_nodes` / `update_card`
			// references don't resolve to a deleted shape.
			for (const modelId of action.ids) ID_MAP.delete(modelId)
			break
		}
		case 'move_shape': {
			const tid = ID_MAP.get(action.id)
			if (!tid) break
			// biome-ignore lint/suspicious/noExplicitAny: cross-shape prop access
			const s: any = editor.getShape(tid)
			if (!s) break
			// Absolute coords take precedence over deltas — matches the
			// "move to (100, 200)" vs "shift right by 50" semantic split.
			const nextX = typeof action.x === 'number'
				? action.x
				: s.x + (action.dx ?? 0)
			const nextY = typeof action.y === 'number'
				? action.y
				: s.y + (action.dy ?? 0)
			editor.updateShape({
				id: tid,
				type: s.type,
				x: nextX,
				y: nextY,
			})
			break
		}
		case 'resize_shape': {
			const tid = ID_MAP.get(action.id)
			if (!tid) break
			// biome-ignore lint/suspicious/noExplicitAny: cross-shape prop shape
			const s: any = editor.getShape(tid)
			if (!s) break
			// Some shapes don't expose w/h (note autoSizes, text autoSizes
			// horizontally). Only patch the props the shape actually carries
			// so we don't fail tldraw's runtime validator.
			const props: Record<string, unknown> = { ...s.props }
			if (typeof action.w === 'number' && 'w' in s.props) {
				props.w = action.w
			}
			if (typeof action.h === 'number' && 'h' in s.props) {
				props.h = action.h
			}
			editor.updateShape({ id: tid, type: s.type, props })
			break
		}
		case 'set_shape_style': {
			const tid = ID_MAP.get(action.id)
			if (!tid) break
			// biome-ignore lint/suspicious/noExplicitAny: cross-shape prop shape
			const s: any = editor.getShape(tid)
			if (!s) break
			// Only apply style props the shape actually has — color/fill/etc
			// aren't universal (text has color but no fill; note has color
			// but no dash; etc.). Silently drop unsupported keys.
			const patch: Record<string, unknown> = {}
			for (const k of ['color', 'fill', 'dash', 'size', 'font'] as const) {
				const v = action[k]
				if (typeof v === 'string' && k in s.props) {
					patch[k] = v
				}
			}
			if (Object.keys(patch).length === 0) break
			editor.updateShape({
				id: tid,
				type: s.type,
				props: { ...s.props, ...patch },
			})
			break
		}
		case 'align_shapes': {
			const tlIds = action.ids
				.map((id) => ID_MAP.get(id))
				.filter((id): id is TLShapeId => Boolean(id))
			if (tlIds.length < 2) break
			editor.alignShapes(tlIds, action.op)
			break
		}
		case 'distribute_shapes': {
			const tlIds = action.ids
				.map((id) => ID_MAP.get(id))
				.filter((id): id is TLShapeId => Boolean(id))
			if (tlIds.length < 3) break
			editor.distributeShapes(tlIds, action.op)
			break
		}
		case 'reorder_shapes': {
			const tlIds = action.ids
				.map((id) => ID_MAP.get(id))
				.filter((id): id is TLShapeId => Boolean(id))
			if (tlIds.length === 0) break
			switch (action.op) {
				case 'to_front':
					editor.bringToFront(tlIds)
					break
				case 'to_back':
					editor.sendToBack(tlIds)
					break
				case 'forward':
					editor.bringForward(tlIds)
					break
				case 'backward':
					editor.sendBackward(tlIds)
					break
			}
			break
		}
		case 'zoom_to_shapes': {
			// Empty/missing ids → fit ALL. The Editor API takes a bounds
			// box, so we compute the union of selected shapes' page bounds
			// and zoom to that. zoomToFit() with no args also works but
			// targets the whole document; we prefer explicit subset support.
			const tlIds = (action.ids ?? [])
				.map((id) => ID_MAP.get(id))
				.filter((id): id is TLShapeId => Boolean(id))
			if (tlIds.length === 0) {
				editor.zoomToFit({ animation: { duration: 400 } })
				break
			}
			// Select the targets then zoom — simplest path that uses the
			// public API. zoomToSelection respects the current selection.
			editor.select(...tlIds)
			editor.zoomToSelection({ animation: { duration: 400 } })
			break
		}
		case 'create_arrow': {
			// Freeform arrow — endpoints are raw page coords, no binding.
			// `link_nodes` is the other arrow path that binds endpoints to
			// existing shapes (they follow when those shapes move).
			const linkColor: Record<string, string> = {
				black: 'black',
				grey: 'grey',
				yellow: 'yellow',
				orange: 'orange',
				green: 'green',
				blue: 'blue',
				red: 'red',
				violet: 'violet',
				'light-blue': 'light-blue',
				'light-green': 'light-green',
				'light-red': 'light-red',
				'light-violet': 'light-violet',
			}
			createShapeIfMissing(editor, {
				id: tldrawId(action.id),
				type: 'arrow',
				x: 0,
				y: 0,
				props: {
					// biome-ignore lint/suspicious/noExplicitAny: tldraw's arrow color is a string literal enum
					color: (linkColor[action.color ?? 'black'] ?? 'black') as any,
					kind: action.kind ?? 'arc',
					start: { x: action.start.x, y: action.start.y },
					end: { x: action.end.x, y: action.end.y },
					// v5: arrow text is rich-text-encoded; see toRichText helper.
					richText: toRichText(action.text ?? ''),
				},
			})
			break
		}
		case 'create_mermaid_diagram': {
			// `@tldraw/mermaid` is async: it parses the source, layouts the
			// nodes via Mermaid's layout engine, and emits native tldraw
			// geo + arrow shapes onto the editor. Fire-and-forget so the
			// rest of the action stream isn't blocked on Mermaid's parser.
			// Errors land in the console as a MermaidDiagramError — voice
			// agent will see the failure on its next read_canvas and can
			// retry with cleaner source.
			const source = action.source
			createMermaidDiagram(editor, source).catch((err) => {
				if (err instanceof MermaidDiagramError) {
					console.warn(
						`[apply] create_mermaid_diagram: mermaid parse failed — ${err.message}`,
					)
				} else {
					console.error(
						'[apply] create_mermaid_diagram threw:',
						err instanceof Error ? err.message : err,
					)
				}
			})
			break
		}
	}
}
