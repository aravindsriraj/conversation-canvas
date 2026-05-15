import { createShapeId, type Editor, type TLShapeId } from 'tldraw'
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

function getExistingBoxes(editor: Editor): Map<string, ShapeBox> {
	const map = new Map<string, ShapeBox>()
	for (const [modelId, shapeId] of ID_MAP.entries()) {
		// biome-ignore lint/suspicious/noExplicitAny: tldraw shape props vary per type, generic read is fine here
		const s: any = editor.getShape(shapeId)
		if (s) {
			map.set(modelId, {
				x: s.x,
				y: s.y,
				w: s.props?.w ?? 280,
				h: s.props?.h ?? 140,
			})
		}
	}
	return map
}

export function applyAction(editor: Editor, action: Action, speakers: Registry) {
	const existing = getExistingBoxes(editor)

	switch (action.type) {
		case 'create_proposal_card': {
			const sp = speakers[action.proposerSpeakerId] ?? {
				displayName: action.proposerSpeakerId,
				color: '#71717a',
			}
			const layout = resolveLayout(action.layout, existing, {
				defaultW: 280,
				defaultH: 140,
			})
			editor.createShape({
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
				defaultW: 320,
				defaultH: 160,
			})
			editor.createShape({
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
			// proposal → decision transition reflected on existing cards.
			if (action.sourceProposalIds) {
				for (const sid of action.sourceProposalIds) {
					const tid = ID_MAP.get(sid)
					if (!tid) continue
					// biome-ignore lint/suspicious/noExplicitAny: cross-shape prop shape
					const s: any = editor.getShape(tid)
					if (s) {
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
				defaultW: 280,
				defaultH: 120,
			})
			const sp = speakers[action.ownerSpeakerId] ?? {
				displayName: action.ownerSpeakerId,
				color: '#71717a',
			}
			editor.createShape({
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
				defaultW: 280,
				defaultH: 100,
			})
			editor.createShape({
				id: tldrawId(action.id),
				type: 'blocker-card',
				x: layout.x,
				y: layout.y,
				props: { w: 280, h: 100, content: action.content },
			})
			break
		}
		case 'create_question_card': {
			const layout = resolveLayout(action.layout, existing, {
				defaultW: 280,
				defaultH: 100,
			})
			const sp = speakers[action.askedBySpeakerId] ?? {
				displayName: action.askedBySpeakerId,
				color: '#71717a',
			}
			editor.createShape({
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
					start: { x: 0, y: 0 },
					end: { x: 100, y: 0 },
					text: action.label ?? action.kind,
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
				defaultW: 600,
				defaultH: 400,
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
			if (s) {
				editor.updateShape({
					id: tid,
					type: s.type,
					props: { ...s.props, ...action.patch },
				})
			}
			break
		}
		case 'create_priority_matrix': {
			const layout = resolveLayout(action.layout, existing, {
				defaultW: 420,
				defaultH: 380,
			})
			editor.createShape({
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
				defaultW: 380,
				defaultH: 240,
			})
			editor.createShape({
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
	}
}
