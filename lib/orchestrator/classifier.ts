import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import type { TranscriptSegment } from '@/lib/speechmatics/client'

/**
 * Voice MODE classifier.
 *
 * Decides per-tick whether the most-recent transcript window contains a
 * direct canvas command (MODE B) or passive thinking-out-loud (MODE A).
 * MODE B routes to the multi-step ReAct agent; MODE A stays on the
 * single-shot `generateObject` path for latency.
 *
 * We use `gemini-3.1-flash-lite` here — same model as our memory
 * summarizer. The classifier's job is single-token output, so the cheap
 * tier is the right pick: ~$0.075/M input tokens, ~150-300ms p95.
 * Cost is rounded down by the 3-second debounce anyway.
 *
 * Earlier we tried a regex classifier and it kept missing turns of phrase
 * ("let's add some colors" — verb matched, target list didn't include
 * "colors"). Pattern matching on natural speech is whack-a-mole. The LLM
 * classifies on intent, so vocabulary drift becomes a non-issue.
 *
 * Failure policy: on ANY error (LLM down, network, schema mismatch), we
 * default to MODE A. The single-shot orchestrator still works for
 * everything we supported before MODE B existed, so this degrades to
 * "the flowchart bug comes back" rather than "the canvas freezes".
 */

// gemini-3.1-flash-lite is intentionally the lighter tier for this hop.
// The classifier doesn't need our discriminated-union vocabulary —
// it just answers a binary question.
const CLASSIFIER_MODEL_ID = 'gemini-3.1-flash-lite'

const ClassificationSchema = z.object({
	mode: z.enum(['A', 'B']),
})

const CLASSIFIER_SYSTEM_PROMPT = `
You classify voice transcript snippets from a thinking-canvas app, where
the user talks out loud through a decision/plan/problem and the canvas
captures the structure as they speak.

Return MODE B if the speaker is GIVING THE CANVAS AN IMPERATIVE COMMAND
that operates on canvas content — drawing, restyling, rearranging,
deleting, grouping, locking, focusing, etc.
Examples (all MODE B):
  - "Draw a flowchart with three boxes"
  - "Add a sticky note for next week"
  - "Color the proposals blue"
  - "Delete the blocker about hiring"
  - "Rank these by impact and effort"
  - "Let's add some colors"
  - "Make those bigger"
  - "Highlight the decision card"
  - "Move the blocker to the right"
  - "Group all the commitments together"
  - "Swap these two"
  - "Duplicate the matrix"
  - "Shrink the boxes"

Return MODE A for PASSIVE THINKING-OUT-LOUD — the speaker is reasoning
through their topic, not addressing the canvas.
Examples (all MODE A):
  - "I think we should focus on enterprise customers"
  - "That's a good point"
  - "What's the timeline if legal clears next week?"
  - "Lisbon SMB has 3x conversion"
  - "Alice will own it by Friday"
  - "Locking it in — we go Berlin"
  - "Blocker — we need to hire a senior engineer"
  - "I propose we double down on SMB"

Heuristic markers:
  - MODE B usually has imperative verbs (draw, add, delete, move, color,
    align, group, make, highlight, swap, duplicate, shrink, rotate)
    and refers to canvas content (these, the boxes, the matrix, them).
  - MODE A usually has first-person reasoning ("I think", "I propose",
    "we should"), declarative statements about the topic, or open
    questions about the substance (not the canvas).
  - When in doubt, prefer A. False negatives on MODE B just mean the
    single-shot orchestrator handles it; false positives on MODE B
    waste a multi-step turn.

Return ONLY the mode letter, no explanation.
`.trim()

/**
 * Build the user-side prompt for the classifier. Exported so tests can
 * pin down the exact prompt without spinning up an LLM call.
 */
export function buildClassifierUserPrompt(
	transcript: TranscriptSegment[],
): string {
	const tail = transcript.slice(-3)
	const text = tail
		.map((s) => s.text)
		.join(' ')
		.trim()
	return `Most-recent voice transcript:\n"${text}"`
}

/**
 * Classify the live voice transcript window into MODE A or MODE B. Used
 * by `runOrchestratorTick` to decide whether to route this tick to the
 * single-shot orchestrator (MODE A) or the multi-step ReAct voice agent
 * (MODE B).
 *
 * Looks at the last 3 segments only — a flowchart command issued 60s
 * ago is already in the action history; we don't want to re-fire it
 * every tick.
 */
export async function classifyTranscript(
	transcript: TranscriptSegment[],
): Promise<'A' | 'B'> {
	const tail = transcript.slice(-3)
	if (tail.length === 0) return 'A'

	const userPrompt = buildClassifierUserPrompt(transcript)
	const startedAt = Date.now()
	try {
		const { object } = await generateObject({
			model: google(CLASSIFIER_MODEL_ID),
			schema: ClassificationSchema,
			system: CLASSIFIER_SYSTEM_PROMPT,
			prompt: userPrompt,
			temperature: 0,
		})
		const ms = Date.now() - startedAt
		const preview = tail
			.map((s) => s.text)
			.join(' ')
			.slice(0, 100)
		console.log(`[classifier] mode=${object.mode} (${ms}ms): "${preview}"`)
		return object.mode
	} catch (err) {
		const ms = Date.now() - startedAt
		console.warn(
			`[classifier] failed after ${ms}ms; defaulting to MODE A:`,
			err instanceof Error ? err.message : err,
		)
		return 'A'
	}
}
