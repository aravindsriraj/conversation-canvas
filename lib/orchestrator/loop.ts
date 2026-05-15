import { google } from '@ai-sdk/google'
import { generateObject, NoObjectGeneratedError } from 'ai'
import type { Room } from '@server/room'
import { ActionStreamSchema, type Action } from '@/lib/actions/schema'
import { SYSTEM_PROMPT, buildUserPrompt } from '@/lib/orchestrator/prompt'

const MODEL_ID = 'gemini-3-flash-preview'

/**
 * One pass of the orchestrator. Reads the buffered transcript window,
 * snapshots the canvas + speaker registry, calls Gemini via the Vercel
 * AI SDK, and returns the validated action list.
 *
 * Implementation notes:
 *  - We request `output: 'no-schema'` so the SDK does NOT enforce our
 *    Zod schema. Gemini reliably parses our discriminated union but
 *    has two quirks we need to clean up before strict validation:
 *      1. emits `"layout": null` for missing optional layout hints
 *         (Zod `.optional()` rejects `null`, only accepts `undefined`),
 *      2. sometimes flattens `splits` in `create_budget_allocator`
 *         into bare strings instead of objects.
 *    We sanitize, then run our canonical `ActionStreamSchema.safeParse`.
 *  - We pass a `schemaDescription` via the prompt body (see prompt.ts).
 *  - All failures resolve to an empty action list so the server tick
 *    loop never throws.
 */
export async function runOrchestratorTick(room: Room): Promise<Action[]> {
	const transcript = room.buffer.window()
	if (transcript.length === 0) return []

	const canvas = Array.from(room.canvasShapes.entries()).map(([id, v]) => ({
		id,
		type: v.type,
		summary: v.summary,
	}))
	const speakers = Array.from(room.speakers.entries()).map(([id, v]) => ({
		id,
		displayName: v.displayName,
	}))

	const userPrompt = buildUserPrompt({ transcript, canvas, speakers })

	const startedAt = Date.now()
	try {
		const { object: raw } = await generateObject({
			model: google(MODEL_ID),
			output: 'no-schema',
			system: SYSTEM_PROMPT,
			prompt: userPrompt,
			temperature: 0.2,
		})

		const cleaned = sanitizeRawObject(raw)
		const parsed = ActionStreamSchema.safeParse(cleaned)
		const ms = Date.now() - startedAt

		if (!parsed.success) {
			console.error(
				`[orchestrator] tick: schema validation failed after ${ms}ms`,
				{
					issues: parsed.error.issues.slice(0, 8),
					rawPreview: JSON.stringify(raw).slice(0, 400),
				},
			)
			return []
		}

		console.log(
			`[orchestrator] tick: ${transcript.length} transcript segs -> ${parsed.data.actions.length} actions (${ms}ms)`,
		)
		return parsed.data.actions
	} catch (err) {
		const ms = Date.now() - startedAt
		if (NoObjectGeneratedError.isInstance(err)) {
			console.error(
				`[orchestrator] tick failed: model returned unparseable object after ${ms}ms`,
				{
					cause: err.cause,
					textPreview: typeof err.text === 'string' ? err.text.slice(0, 400) : undefined,
					finishReason: err.finishReason,
				},
			)
		} else {
			console.error(
				`[orchestrator] tick failed after ${ms}ms:`,
				err instanceof Error ? err.message : err,
			)
		}
		return []
	}
}

/**
 * Strip Gemini's well-known structured-output quirks before Zod validation:
 *  - drop any explicit `null` values (Zod `.optional()` is undefined-or-missing
 *    only; Gemini's JSON-mode emits `null` for unset optionals),
 *  - coerce `splits: ["60% enterprise", ...]` into objects.
 *
 * Pure / non-throwing. Operates on a copy.
 */
function sanitizeRawObject(value: unknown): unknown {
	if (value == null) return value
	if (Array.isArray(value)) return value.map(sanitizeRawObject)
	if (typeof value !== 'object') return value

	const obj = value as Record<string, unknown>
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(obj)) {
		if (v === null) continue // drop nulls so optional fields stay undefined
		if (k === 'splits' && Array.isArray(v)) {
			out[k] = v.map((s) => coerceSplit(s))
			continue
		}
		out[k] = sanitizeRawObject(v)
	}
	return out
}

function coerceSplit(s: unknown): unknown {
	if (typeof s !== 'string') return sanitizeRawObject(s)
	// Best-effort parse of "60% enterprise" / "Enterprise: 60%" / "Enterprise 60".
	const m = s.match(/(\d+(?:\.\d+)?)\s*%?\s*[-:]?\s*(.+)/) ?? s.match(/(.+?)\s*[-:]?\s*(\d+(?:\.\d+)?)\s*%?/)
	if (!m) return { label: s, amountPct: 0 }
	const a = m[1]
	const b = m[2]
	const asNum = Number(a)
	if (!Number.isNaN(asNum)) return { label: String(b).trim(), amountPct: asNum }
	const asNum2 = Number(b)
	return { label: String(a).trim(), amountPct: Number.isNaN(asNum2) ? 0 : asNum2 }
}
