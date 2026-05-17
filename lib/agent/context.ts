import type { Action } from '@/lib/actions/schema'
import { renderMemoryBlock } from '@/lib/orchestrator/prompt'
import type { Room } from '@server/room'

/**
 * Build a single compact context blob to hand to the agent LLM.
 *
 * What the agent sees (in order, separated by labeled section headers):
 *   1. CANVAS NAME — so it can reference the canvas by title.
 *   2. SPEAKERS — `id = displayName` pairs for every enrolled speaker plus
 *      the primary user, so the agent can address commitments to people by
 *      name without us baking name-resolution into prompt logic.
 *   3. CANVAS SHAPES — id, type, summary for every shape known to the room.
 *      Same source the voice orchestrator uses (room.canvasShapes), which
 *      is rebuilt from action history on hydrate + updated on each new
 *      action. Includes any shape the voice loop or a prior agent turn
 *      created.
 *   4. RECENT ACTIONS — the last 25 actions, in order, condensed to a single
 *      line each. Helps the agent understand "what happened just now" so a
 *      user request like "rearrange the last few cards" has anchor points.
 *   5. RECENT TRANSCRIPT — the live voice buffer's 90-second window. Lets
 *      the agent reference things the user JUST said out loud even if no
 *      action has been emitted for them yet.
 *   6. CHAT HISTORY — previous user/assistant turns in this canvas session.
 *
 * Style notes:
 *   - Plain text (not JSON) — Gemini Flash handles labeled-section prose at
 *     least as well as nested JSON, and it's easier for us to debug-log.
 *   - Truncated content (200 chars per shape, 25 actions, 90s transcript,
 *     last 8 chat turns) — total target ~3-6KB so we stay well inside the
 *     model's preferred context.
 *   - All speaker ids stay as their internal short tokens (S0, S1, …) —
 *     the SPEAKERS section is the only translation table.
 */
export function buildAgentContext(room: Room): string {
	const lines: string[] = []

	// 1. canvas name — we don't carry it on Room, fall back to a placeholder.
	lines.push(`CANVAS_ID: ${room.id}`)

	// 2. speakers
	const speakers = Array.from(room.speakers.entries()).map(
		([id, v]) => `  ${id} = ${v.displayName}`,
	)
	if (room.primaryUser) {
		speakers.unshift(
			`  (primary user) = ${room.primaryUser.displayName}`,
		)
	}
	lines.push('SPEAKERS:')
	lines.push(speakers.length > 0 ? speakers.join('\n') : '  (none)')

	// 3. canvas shapes
	lines.push('CANVAS_SHAPES:')
	if (room.canvasShapes.size === 0) {
		lines.push('  (empty)')
	} else {
		for (const [id, v] of room.canvasShapes.entries()) {
			lines.push(`  ${id} (${v.type}): ${v.summary}`)
		}
	}

	// 3b. long-term compressed memory (cross-pollinated — chat agent
	// sees both the voice thread AND the chat thread plus shared meta).
	lines.push('')
	lines.push(renderMemoryBlock(room.memory))

	// 4. recent actions — last 25, condensed
	const recent = room.actionHistory.slice(-25)
	lines.push(`RECENT_ACTIONS (last ${recent.length}):`)
	if (recent.length === 0) {
		lines.push('  (none)')
	} else {
		for (const a of recent) {
			lines.push(`  - ${summarizeAction(a)}`)
		}
	}

	// 5. transcript window
	const transcript = room.buffer.window()
	lines.push(`RECENT_TRANSCRIPT (last 90s, ${transcript.length} segs):`)
	if (transcript.length === 0) {
		lines.push('  (silence)')
	} else {
		// The voice orchestrator coalesces consecutive same-speaker segments
		// for its own prompt, but for chat we let the agent see raw segments —
		// it's reading for reference, not aggregation, and the gaps tell it
		// something about turn-taking pace.
		for (const seg of transcript) {
			lines.push(`  [${seg.speaker}] ${seg.text}`)
		}
	}

	// 6. chat history — last 8 turns
	const chat = room.chatHistory.slice(-8)
	lines.push(`CHAT_HISTORY (last ${chat.length} turns):`)
	if (chat.length === 0) {
		lines.push('  (first turn)')
	} else {
		for (const t of chat) {
			const tag = t.role === 'user' ? 'USER' : 'AI'
			const ids =
				t.actionIds && t.actionIds.length > 0
					? `  [emitted: ${t.actionIds.join(', ')}]`
					: ''
			lines.push(`  ${tag}: ${t.text.slice(0, 400)}${ids}`)
		}
	}

	return lines.join('\n')
}

/**
 * Single-line summary of an action for the RECENT_ACTIONS section. We
 * deliberately mirror the format the voice orchestrator's canvas snapshot
 * uses (`summarizeAction` in server/room.ts) so the agent reads a consistent
 * canvas description across both surfaces.
 */
function summarizeAction(a: Action): string {
	const id = 'id' in a ? a.id : ''
	switch (a.type) {
		case 'create_proposal_card':
			return `+proposal ${id}: "${a.content.slice(0, 160)}"`
		case 'create_decision_card':
			return `+decision ${id}: "${a.content.slice(0, 160)}"`
		case 'create_commitment_card':
			return `+commit ${id}: ${a.ownerSpeakerId} "${a.action.slice(0, 120)}"${a.deadline ? ` by ${a.deadline}` : ''}`
		case 'create_blocker_card':
			return `+blocker ${id}: "${a.content.slice(0, 160)}"`
		case 'create_question_card':
			return `+question ${id}: "${a.content.slice(0, 160)}"`
		case 'create_note':
			return `+note ${id}: "${a.content.slice(0, 160)}"`
		case 'create_geo':
			return `+${a.geo} ${id}${a.content ? `: "${a.content.slice(0, 120)}"` : ''}`
		case 'create_text':
			return `+text ${id}: "${a.content.slice(0, 160)}"`
		case 'create_priority_matrix':
			return `+matrix ${id} items=[${a.items
				.map((i) => `${i.id}:"${i.label.slice(0, 40)}"`)
				.join(', ')}]`
		case 'create_budget_allocator':
			return `+budget ${id}: ${a.splits.map((s) => `${s.label} ${s.amountPct}%`).join(', ')}`
		case 'create_gantt':
			return `+gantt ${id} items=[${a.items
				.map((i) => `${i.id}:"${i.label.slice(0, 40)}"`)
				.join(', ')}]`
		case 'create_bespoke_widget':
			return `+widget ${id}`
		case 'link_nodes':
			return `link ${a.from} → ${a.to} (${a.kind})`
		case 'lock_decision':
			return `lock ${a.id}`
		case 'update_card':
			return `update ${a.id}: ${JSON.stringify(a.patch).slice(0, 120)}`
		case 'group_into_frame':
			return `group "${a.label}" (${a.nodeIds.join(',')})`
		case 'delete_shapes':
			return `delete ${a.ids.join(',')}`
		case 'move_shape':
			return `move ${a.id} → (${a.x ?? `+${a.dx ?? 0}`}, ${a.y ?? `+${a.dy ?? 0}`})`
		case 'resize_shape':
			return `resize ${a.id} → ${a.w ?? '?'}×${a.h ?? '?'}`
		case 'set_shape_style':
			return `style ${a.id} ${[a.color && `color=${a.color}`, a.fill && `fill=${a.fill}`, a.dash && `dash=${a.dash}`, a.size && `size=${a.size}`, a.font && `font=${a.font}`].filter(Boolean).join(' ')}`
		case 'align_shapes':
			return `align ${a.op} (${a.ids.join(',')})`
		case 'distribute_shapes':
			return `distribute ${a.op} (${a.ids.join(',')})`
		case 'reorder_shapes':
			return `${a.op.replace('_', ' ')} (${a.ids.join(',')})`
		case 'zoom_to_shapes':
			return `zoom${a.ids?.length ? ` → ${a.ids.join(',')}` : ' to fit'}`
		case 'create_arrow':
			return `+arrow ${a.id}: (${a.start.x},${a.start.y}) → (${a.end.x},${a.end.y})`
		default:
			return (a as { type: string }).type
	}
}
