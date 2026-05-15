import { google } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { Action } from '@/lib/actions/schema'
import type {
	ChatThread,
	SharedMeta,
	VoiceThread,
} from '@/lib/db/memories'

/*
 * Memory summarizer — compresses N raw messages (voice ticks or chat
 * turns) into a structured thread + shared_meta delta, MERGED with the
 * existing summary so we don't recompact from scratch each rollover.
 *
 * Why a separate module:
 *   - Independent retry/log boundary from the orchestrator loop and
 *     chat agent runner.
 *   - Uses a CHEAPER model (Flash Lite) because compression doesn't
 *     need the same reasoning depth as the main paths.
 *   - Easy to swap the prompt / schema without touching the producers.
 *
 * Failure policy:
 *   - Network error → throw; caller releases the lock and lets the
 *     next rollover try again.
 *   - Schema validation failure → throw with summary of issues.
 *   - Empty input → return the existing summary unchanged.
 */

// Cheap, fast tier for the compression task. The summarizer doesn't
// need the full Flash's reasoning chops — it just rewrites prose +
// merges bullet lists. If quality regresses, escalate to
// gemini-3-flash-preview.
const SUMMARIZER_MODEL_ID = 'gemini-3.1-flash-lite'

// Zod schema mirroring the JSONB shape we store. Used both as the
// generateObject contract AND for runtime guarding before commit.
const VoiceThreadSchema = z.object({
	narrative: z.string().max(2000),
	key_moments: z.array(z.string().max(240)).max(8),
})
const ChatThreadSchema = z.object({
	narrative: z.string().max(2000),
	intents_pursued: z.array(z.string().max(240)).max(8),
})
const SharedMetaSchema = z.object({
	open_tensions: z.array(z.string().max(240)).max(8),
	recurring_themes: z.array(z.string().max(240)).max(8),
	abandoned_paths: z.array(z.string().max(240)).max(8),
	pending_followups: z.array(z.string().max(240)).max(8),
})

const VoiceSummaryOutputSchema = z.object({
	voice_thread: VoiceThreadSchema,
	shared_meta: SharedMetaSchema,
})

const ChatSummaryOutputSchema = z.object({
	chat_thread: ChatThreadSchema,
	shared_meta: SharedMetaSchema,
})

/*
 * Render the actions/turns that are being aged out into a compact
 * prose log for the summarizer's input. Voice items get the
 * `summarizeAction` treatment we already do elsewhere; chat turns get
 * a `[USER]:` / `[AI]:` label.
 */
function renderVoiceItems(items: Action[]): string {
	if (items.length === 0) return '(none)'
	return items.map((a, i) => `${i + 1}. ${shortAction(a)}`).join('\n')
}

function renderChatItems(
	items: Array<{ role: 'user' | 'assistant'; text: string }>,
): string {
	if (items.length === 0) return '(none)'
	return items
		.map(
			(t, i) =>
				`${i + 1}. [${t.role === 'user' ? 'USER' : 'AI'}] ${t.text.slice(0, 600)}`,
		)
		.join('\n')
}

/*
 * Single-line summary of an action — same shape as the chat agent
 * context builder. Duplicated rather than imported to keep this module
 * loadable from server side without crossing the orchestrator boundary.
 */
function shortAction(a: Action): string {
	const id = 'id' in a ? a.id : ''
	switch (a.type) {
		case 'create_proposal_card':
			return `+proposal ${id}: "${a.content.slice(0, 140)}"`
		case 'create_decision_card':
			return `+decision ${id}: "${a.content.slice(0, 140)}"`
		case 'create_commitment_card':
			return `+commit ${id}: ${a.ownerSpeakerId} "${a.action.slice(0, 100)}"${a.deadline ? ` by ${a.deadline}` : ''}`
		case 'create_blocker_card':
			return `+blocker ${id}: "${a.content.slice(0, 140)}"`
		case 'create_question_card':
			return `+question ${id}: "${a.content.slice(0, 140)}"`
		case 'create_note':
			return `+note ${id}: "${a.content.slice(0, 140)}"`
		case 'create_geo':
			return `+${a.geo} ${id}${a.content ? `: "${a.content.slice(0, 100)}"` : ''}`
		case 'create_text':
			return `+text ${id}: "${a.content.slice(0, 140)}"`
		case 'create_priority_matrix':
			return `+matrix ${id}: ${a.items.length} items`
		case 'create_budget_allocator':
			return `+budget ${id}: ${a.splits.map((s) => `${s.label} ${s.amountPct}%`).join(', ').slice(0, 100)}`
		case 'create_gantt':
			return `+gantt ${id}: ${a.items.length} items`
		case 'link_nodes':
			return `link ${a.from} → ${a.to} (${a.kind})`
		case 'lock_decision':
			return `lock ${a.id}`
		case 'update_card':
			return `update ${a.id}: ${JSON.stringify(a.patch).slice(0, 100)}`
		case 'group_into_frame':
			return `group "${a.label}"`
		case 'delete_shapes':
			return `delete ${a.ids.join(',')}`
		case 'move_shape':
			return `move ${a.id}`
		case 'resize_shape':
			return `resize ${a.id}`
		case 'set_shape_style':
			return `style ${a.id}`
		case 'align_shapes':
			return `align ${a.op}`
		case 'distribute_shapes':
			return `distribute ${a.op}`
		case 'reorder_shapes':
			return `reorder ${a.op}`
		case 'zoom_to_shapes':
			return `zoom`
		case 'create_arrow':
			return `+arrow ${id}`
		default:
			return (a as { type: string }).type
	}
}

const VOICE_SYSTEM_PROMPT = `
You are the memory compressor for a meeting canvas. The voice path of the
app captures what was SAID in the meeting; you are aging out a batch of
voice messages from the working window into the long-term summary.

Your output is JSON with two fields:
  - voice_thread: a prose NARRATIVE (≤ 2000 chars) of what was said in
    the batch, plus 0–8 KEY_MOMENTS (one-line each, ≤ 240 chars).
  - shared_meta: cross-mode observations — open tensions still
    unresolved, recurring themes, abandoned lines of thought, implicit
    pending follow-ups. Each list is 0–8 strings, ≤ 240 chars each.

You MUST merge with the existing summary if one was provided. The new
narrative continues the old one (don't restart the story). The new
shared_meta extends/refines the old one (don't lose still-relevant
items; do prune items that have been resolved per the new content).

Style:
  - Compress, don't list. The narrative is the story of the meeting;
    factual structured stuff (decisions, commitments, etc.) lives on
    the canvas itself, so DON'T duplicate that. Focus on:
      • Why a decision was reached (reasoning, push-back)
      • Lines of thought pursued and dropped
      • Recurring themes / speaker tendencies
      • Unresolved tensions that didn't become explicit cards
      • Implicit follow-ups ("revisit next week")
  - Reference speakers by their displayName if known.
  - Past tense, neutral voice. No "I", no "we"; the summary is
    third-person observational.
  - Never invent. If you don't know, omit.
`

const CHAT_SYSTEM_PROMPT = `
You are the memory compressor for a meeting canvas. The chat path of the
app captures what the user ASKED via the Ask-AI panel; you are aging out
a batch of chat turns from the working window into the long-term summary.

Your output is JSON with two fields:
  - chat_thread: a prose NARRATIVE (≤ 2000 chars) of what the user
    pursued via chat in this batch, plus 0–8 INTENTS_PURSUED bullets
    (one-line each, ≤ 240 chars). Intents are user goals across one
    or more turns (e.g. "redesigned the trip-planning layout twice").
  - shared_meta: same cross-mode observations as the voice summarizer —
    open tensions, recurring themes, abandoned paths, pending follow-ups.

You MUST merge with the existing summary if one was provided. The new
narrative continues the old one. shared_meta extends/refines, pruning
items the new content resolves.

Style:
  - Compress, don't list. The structured outcomes (cards created /
    deleted / styled) live on the canvas; DON'T duplicate them. Focus
    on the USER'S INTENT: what they were trying to achieve, what they
    iterated on, what they gave up on.
  - Past tense, third-person. Refer to the asker as "the user".
  - Never invent. If a turn is short or unclear, just describe the
    surface ("user asked for a color change") without making up reasons.
`

/**
 * Summarize a batch of voice ticks → updated voice_thread + shared_meta.
 *
 * Takes the existing thread/meta + the items being aged out + a
 * "canvas ground truth" snippet so the model can't drift on locked
 * facts (e.g., "decision d3 is still locked"). Returns the merged
 * outputs — caller is responsible for calling `commitSummary` to
 * persist.
 */
export async function summarizeVoiceBatch(args: {
	canvasName?: string
	existingThread: VoiceThread
	existingMeta: SharedMeta
	canvasGroundTruth: string
	items: Action[]
}): Promise<{ thread: VoiceThread; meta: SharedMeta }> {
	if (args.items.length === 0) {
		return { thread: args.existingThread, meta: args.existingMeta }
	}
	const userPrompt = `
CANVAS GROUND TRUTH (current shapes — these reflect what survived the
batch; use them to ground your summary, do NOT contradict them):
${args.canvasGroundTruth}

EXISTING SUMMARY (carry this forward; the new content adds to it, doesn't
replace it):
voice_thread.narrative: ${args.existingThread.narrative || '(empty — first summary)'}
voice_thread.key_moments:
${args.existingThread.key_moments.map((m) => `  - ${m}`).join('\n') || '  (none)'}
shared_meta.open_tensions:
${args.existingMeta.open_tensions.map((t) => `  - ${t}`).join('\n') || '  (none)'}
shared_meta.recurring_themes:
${args.existingMeta.recurring_themes.map((t) => `  - ${t}`).join('\n') || '  (none)'}
shared_meta.abandoned_paths:
${args.existingMeta.abandoned_paths.map((p) => `  - ${p}`).join('\n') || '  (none)'}
shared_meta.pending_followups:
${args.existingMeta.pending_followups.map((p) => `  - ${p}`).join('\n') || '  (none)'}

VOICE ITEMS BEING AGED OUT (oldest first):
${renderVoiceItems(args.items)}

Produce the updated voice_thread + shared_meta as JSON.`.trim()

	const { object } = await generateObject({
		model: google(SUMMARIZER_MODEL_ID),
		system: VOICE_SYSTEM_PROMPT,
		prompt: userPrompt,
		schema: VoiceSummaryOutputSchema,
		temperature: 0.3,
	})
	return { thread: object.voice_thread, meta: object.shared_meta }
}

/**
 * Summarize a batch of chat turns → updated chat_thread + shared_meta.
 * Symmetric counterpart to summarizeVoiceBatch; same merge semantics.
 */
export async function summarizeChatBatch(args: {
	existingThread: ChatThread
	existingMeta: SharedMeta
	canvasGroundTruth: string
	items: Array<{ role: 'user' | 'assistant'; text: string }>
}): Promise<{ thread: ChatThread; meta: SharedMeta }> {
	if (args.items.length === 0) {
		return { thread: args.existingThread, meta: args.existingMeta }
	}
	const userPrompt = `
CANVAS GROUND TRUTH:
${args.canvasGroundTruth}

EXISTING SUMMARY:
chat_thread.narrative: ${args.existingThread.narrative || '(empty — first summary)'}
chat_thread.intents_pursued:
${args.existingThread.intents_pursued.map((m) => `  - ${m}`).join('\n') || '  (none)'}
shared_meta.open_tensions:
${args.existingMeta.open_tensions.map((t) => `  - ${t}`).join('\n') || '  (none)'}
shared_meta.recurring_themes:
${args.existingMeta.recurring_themes.map((t) => `  - ${t}`).join('\n') || '  (none)'}
shared_meta.abandoned_paths:
${args.existingMeta.abandoned_paths.map((p) => `  - ${p}`).join('\n') || '  (none)'}
shared_meta.pending_followups:
${args.existingMeta.pending_followups.map((p) => `  - ${p}`).join('\n') || '  (none)'}

CHAT TURNS BEING AGED OUT (oldest first):
${renderChatItems(args.items)}

Produce the updated chat_thread + shared_meta as JSON.`.trim()

	const { object } = await generateObject({
		model: google(SUMMARIZER_MODEL_ID),
		system: CHAT_SYSTEM_PROMPT,
		prompt: userPrompt,
		schema: ChatSummaryOutputSchema,
		temperature: 0.3,
	})
	return { thread: object.chat_thread, meta: object.shared_meta }
}
