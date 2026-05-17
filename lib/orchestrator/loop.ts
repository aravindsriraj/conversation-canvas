import { google } from '@ai-sdk/google'
import { generateObject, NoObjectGeneratedError } from 'ai'
import type { Room } from '@server/room'
import { ActionStreamSchema, type Action } from '@/lib/actions/schema'
import { SYSTEM_PROMPT, buildUserPrompt } from '@/lib/orchestrator/prompt'

// gemini-3-flash-preview — the full Flash tier. We moved off the lite variant
// (`gemini-3.1-flash-lite`) because the orchestrator's job is
// classification + dedup + relation inference, and the lite tier was missing
// subtle "this proposal vs. that proposal" overlap calls. Flash takes the
// quality hit on cost / latency in exchange. If latency becomes a problem
// again, the fallback is `gemini-3.1-flash-lite`.
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
	const rawTranscript = room.buffer.window()
	if (rawTranscript.length === 0) return []

	// Speechmatics finalizes in small phrase chunks (e.g. "I think" / "we should"
	// / "target enterprise" / "customers in Q3" / "."). Sent one-per-line to
	// Gemini, the meaning fragments. Coalesce consecutive same-speaker segments
	// that are < 2.5s apart into a single utterance line. The coalesced version
	// is what we hand to Gemini; the raw buffer stays for the per-segment forward.
	const transcript = coalesceUtterances(rawTranscript, 2500)

	const canvas = Array.from(room.canvasShapes.entries()).map(([id, v]) => ({
		id,
		type: v.type,
		summary: v.summary,
	}))

	// Single-user mode: every Speechmatics speaker label that shows up in this
	// tick's transcript is mapped to the enrolled primary user. Speechmatics'
	// diarization sometimes flickers between labels (S0, S1, S2…) even for one
	// voice; we coalesce them all to the same identity so cards consistently
	// show "Alice" instead of switching between "Speaker S0" / "Speaker S1".
	//
	// Falls back to a generic "Speaker S<n>" placeholder if no primary user
	// has enrolled yet (e.g. if someone races the form).
	const primary = room.primaryUser
	for (const seg of transcript) {
		if (!seg.speaker || room.speakers.has(seg.speaker)) continue
		if (primary) {
			room.recordSpeaker(seg.speaker, primary.displayName, primary.color)
		} else {
			room.recordSpeaker(seg.speaker, `Speaker ${seg.speaker}`, '#71717a')
		}
	}
	const speakers = Array.from(room.speakers.entries()).map(([id, v]) => ({
		id,
		displayName: v.displayName,
	}))

	// Hand the model the last 25 actions across both voice and chat so it
	// can see what was *just* emitted and avoid re-emitting the same
	// proposal / link / refinement on the next tick while the same
	// utterance is still in the 90s transcript window.
	const recentActions = room.actionHistory.slice(-25)
	const userPrompt = buildUserPrompt({
		transcript,
		canvas,
		speakers,
		recentActions,
		memory: room.memory,
	})

	// Verbose-ish per-tick logging during demo bring-up. Truncated to stay
	// readable. If this gets noisy in production, gate behind DEBUG_ORCH=1.
	console.log(
		`[orchestrator] tick start: ${transcript.length} segs, ${speakers.length} speakers, ${canvas.length} on canvas`,
	)
	console.log('[orchestrator] transcript window:')
	for (const seg of transcript) {
		console.log(`  [${seg.speaker}] ${seg.text}`)
	}

	const startedAt = Date.now()
	try {
		const { object: raw } = await generateObject({
			model: google(MODEL_ID),
			output: 'no-schema',
			system: SYSTEM_PROMPT,
			prompt: userPrompt,
			temperature: 0.2,
		})

		const ms = Date.now() - startedAt
		const rawPreview = JSON.stringify(raw).slice(0, 1200)
		console.log(`[orchestrator] gemini raw (${ms}ms):`, rawPreview)

		const cleaned = sanitizeRawObject(raw)
		injectMissingTimestamps(cleaned, Date.now())
		const parsed = ActionStreamSchema.safeParse(cleaned)

		if (!parsed.success) {
			console.error(
				`[orchestrator] schema validation failed after ${ms}ms`,
				{ issues: parsed.error.issues.slice(0, 8) },
			)
			return []
		}

		// Server-side dedup pass. Gemini drifts under pressure: across
		// consecutive ticks with the same transcript window, it will re-emit
		// near-identical `create_decision_card` actions with slightly different
		// wording. The prompt asks for `update_card` instead but it's a
		// suggestion the model frequently ignores. Convert those drift-creates
		// to update_cards before broadcasting.
		const filtered = filterDuplicateCreates(parsed.data.actions, room)

		console.log(
			`[orchestrator] tick: ${transcript.length} transcript segs -> ${filtered.length} actions (was ${parsed.data.actions.length} pre-dedup, ${ms}ms)`,
		)
		for (const a of filtered) {
			console.log(`  + ${a.type}${'id' in a ? ` ${a.id}` : ''}`)
		}
		return filtered
	} catch (err) {
		const ms = Date.now() - startedAt
		if (NoObjectGeneratedError.isInstance(err)) {
			console.error(
				`[orchestrator] tick failed: model returned unparseable object after ${ms}ms`,
				{
					cause: err.cause,
					textPreview: typeof err.text === 'string' ? err.text.slice(0, 800) : undefined,
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
 * Strip near-duplicate create_* actions before broadcasting. We look at the
 * room's existing canvas (NOT just this tick — Gemini sees the canvas
 * snapshot in its prompt, so anything already there is "known state").
 *
 * Heuristic: for each `create_decision_card` / `create_proposal_card` /
 * `create_blocker_card` / `create_question_card` / `create_commitment_card`
 * we extract the main content string and compare token-overlap against every
 * existing card of the same type. If overlap > 0.5, drop the create. We
 * don't synthesize an update_card replacement — the existing card is fine.
 *
 * Also drops redundant `update_card` actions whose patch matches the
 * existing prop values (we've seen Gemini emit "update b1.total to 100000"
 * when b1.total is already 100000).
 */
// Exported for unit testing — see tests/orchestrator-dedup.test.ts. The
// production call site is still within `runOrchestratorTick` below.
export function filterDuplicateCreates(
	actions: Action[],
	room: Room,
): Action[] {
	// Three-pass dedup:
	//   1. Text-content overlap — catches duplicate proposals/decisions/etc.
	//      For decision_card duplicates we synthesize an update_card on the
	//      existing decision so Gemini's refinement intent is preserved (e.g.
	//      "Lisbon decision — first week of August").
	//   2. L3 widget singleton — at most ONE of each L3 widget type
	//      (priority_matrix, budget_allocator, gantt) is allowed on the
	//      canvas. Extra creates become update_cards on the existing widget
	//      so item/split changes still propagate.
	//   3. Orphan-link drop — any link_nodes / lock_decision referencing an
	//      id that was just dropped (or doesn't exist in the canvas or this
	//      tick's surviving creates) is dropped too. Without this we leak
	//      arrows pointing at non-existent shapes.

	// --- Pre-index existing canvas (across all past actions in the room).
	const pastByType = new Map<string, { id: string; content: string }[]>()
	const pastL3IdByType = new Map<string, string>() // type → existing id
	const existingIds = new Set<string>() // every model id that has a shape
	// Set of "from::to::kind" tuples for every link_nodes already emitted.
	// Used in the per-action loop below to skip duplicate arrows the model
	// re-emits while Speechmatics is still re-finalizing the same utterance.
	// Without this guard, the canvas accumulates layered identical arrows
	// since each tldraw arrow shape gets a fresh id even when its
	// (from, to, kind) tuple matches a previous one.
	const pastLinks = new Set<string>()
	for (const past of room.actionHistory) {
		if ('id' in past && typeof past.id === 'string') existingIds.add(past.id)
		if (past.type === 'link_nodes') {
			pastLinks.add(`${past.from}::${past.to}::${past.kind}`)
		}
		if (isL3Widget(past.type)) {
			if (!pastL3IdByType.has(past.type) && 'id' in past) {
				pastL3IdByType.set(past.type, past.id)
			}
		}
		const c = pickContent(past)
		if (!c) continue
		const list = pastByType.get(past.type) ?? []
		list.push({ id: 'id' in past ? past.id : '', content: c })
		pastByType.set(past.type, list)
	}

	const droppedIds = new Set<string>() // ids that were dedup'd in this tick
	const localL3IdByType = new Map<string, string>() // also dedup intra-tick
	const localTextByType = new Map<string, { id: string; content: string }[]>()
	const localLinks = new Set<string>() // intra-tick link dedup

	const out: Action[] = []
	for (const a of actions) {
		// Link-node dedup: same (from, to, kind) tuple already emitted →
		// drop silently. Catches re-emissions when the same utterance
		// re-finalizes inside the 90s transcript window.
		if (a.type === 'link_nodes') {
			const key = `${a.from}::${a.to}::${a.kind}`
			if (pastLinks.has(key) || localLinks.has(key)) {
				console.log(
					`[orchestrator] DEDUP dropped link_nodes (already exists: ${key})`,
				)
				continue
			}
			localLinks.add(key)
			out.push(a)
			continue
		}

		// L3 widgets: at most one per type allowed
		if (isL3Widget(a.type) && 'id' in a) {
			const existingId =
				pastL3IdByType.get(a.type) ?? localL3IdByType.get(a.type)
			if (existingId) {
				console.log(
					`[orchestrator] DEDUP dropped ${a.type} (L3 singleton — keeping ${existingId})`,
				)
				droppedIds.add(a.id)
				// Convert to update_card on the existing widget so item/split
				// changes still land. Patches differ per widget; we copy
				// "items" or "splits" from the new create.
				const patch = l3Patch(a)
				if (patch) {
					out.push({
						type: 'update_card',
						id: existingId,
						patch,
					})
				}
				continue
			}
			localL3IdByType.set(a.type, a.id)
			out.push(a)
			continue
		}

		// Text-content cards: dedup by content overlap. Convert dedup'd
		// decisions into update_cards on the existing decision (preserves
		// the refinement intent).
		const content = pickContent(a)
		if (content) {
			const peers = [
				...(pastByType.get(a.type) ?? []),
				...(localTextByType.get(a.type) ?? []),
			]
			const match = peers.find((p) => tokenOverlap(p.content, content) >= 0.5)
			if (match && 'id' in a) {
				console.log(
					`[orchestrator] DEDUP dropped ${a.type} (overlap with ${match.id}) "${content.slice(0, 60)}"`,
				)
				droppedIds.add(a.id)
				if (a.type === 'create_decision_card' && content !== match.content) {
					// Convert to an update_card so the refinement propagates.
					console.log(
						`[orchestrator]   ↳ converted to update_card on ${match.id}`,
					)
					out.push({
						type: 'update_card',
						id: match.id,
						patch: { content },
					})
				}
				continue
			}
			const list = localTextByType.get(a.type) ?? []
			list.push({ id: 'id' in a ? a.id : '', content })
			localTextByType.set(a.type, list)
		}
		out.push(a)
	}

	// --- Pass 3: drop orphan link_nodes / lock_decision actions whose
	// referenced id was dropped this tick AND doesn't already exist on the
	// canvas. Without this, arrows leak pointing at non-existent shapes.
	const finalOut = out.filter((a) => {
		if (a.type === 'link_nodes') {
			const fromBad =
				droppedIds.has(a.from) && !existingIds.has(a.from)
			const toBad = droppedIds.has(a.to) && !existingIds.has(a.to)
			if (fromBad || toBad) {
				console.log(
					`[orchestrator] DEDUP dropped link_nodes (orphan — ${a.from} → ${a.to})`,
				)
				return false
			}
		}
		if (a.type === 'lock_decision') {
			if (droppedIds.has(a.id) && !existingIds.has(a.id)) {
				console.log(
					`[orchestrator] DEDUP dropped lock_decision (orphan — ${a.id})`,
				)
				return false
			}
		}
		return true
	})

	return finalOut
}

function isL3Widget(type: string): boolean {
	return (
		type === 'create_priority_matrix' ||
		type === 'create_budget_allocator' ||
		type === 'create_gantt'
	)
}

/** Build an update_card patch from an L3 widget create. Items/splits move; other props stay. */
function l3Patch(a: Action): Record<string, unknown> | null {
	if (a.type === 'create_priority_matrix') return { items: a.items }
	if (a.type === 'create_budget_allocator') {
		return {
			total: a.total,
			currency: a.currency ?? '%',
			splits: a.splits,
		}
	}
	if (a.type === 'create_gantt') return { items: a.items }
	return null
}

function pickContent(a: Action): string | null {
	if ('content' in a && typeof a.content === 'string') return a.content
	if (a.type === 'create_commitment_card') return a.action
	return null
}

/**
 * Jaccard-style overlap of word tokens, lowercased, ≥3 chars. Returns 0..1.
 * 0.5 means half the meaningful words match — empirically enough to catch
 * "Launch on iOS first; lower effort..." vs "Launch the new mobile app on iOS
 * first, as it is lower effort..." as the same idea.
 */
function tokenOverlap(a: string, b: string): number {
	const tokens = (s: string) =>
		new Set(
			s
				.toLowerCase()
				.split(/[^a-z0-9]+/)
				.filter((w) => w.length >= 3),
		)
	const ta = tokens(a)
	const tb = tokens(b)
	if (ta.size === 0 || tb.size === 0) return 0
	let inter = 0
	for (const t of ta) if (tb.has(t)) inter += 1
	return inter / Math.min(ta.size, tb.size)
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

/**
 * Gemini reliably omits required scalar fields like `ts` from action variants
 * (we ask for a discriminated union; it returns minimal objects). Inject a
 * server-side timestamp for action types whose schema requires one. The
 * server's wall-clock is good enough for ordering and demo display.
 */
function injectMissingTimestamps(obj: unknown, now: number): void {
	if (!obj || typeof obj !== 'object') return
	const actions = (obj as { actions?: unknown }).actions
	if (!Array.isArray(actions)) return
	for (const action of actions) {
		if (!action || typeof action !== 'object') continue
		const a = action as Record<string, unknown>
		if (a.type === 'create_proposal_card' && typeof a.ts !== 'number') {
			a.ts = now
		}
	}
}

/**
 * Coalesce consecutive same-speaker segments within `gapMs` into one logical
 * utterance line. Punctuation tokens (`,` `.` `?` `!` `;` `:`) are merged
 * without a leading space; word tokens get a single space.
 */
function coalesceUtterances<T extends { speaker: string; text: string; isFinal: boolean; ts: number }>(
	segs: T[],
	gapMs: number,
): T[] {
	if (segs.length <= 1) return segs
	const out: T[] = []
	for (const seg of segs) {
		const prev = out[out.length - 1]
		const gap = prev ? seg.ts - prev.ts : Number.POSITIVE_INFINITY
		const sameSpeaker = prev && prev.speaker === seg.speaker
		if (prev && sameSpeaker && gap <= gapMs) {
			const isPunct = /^[.,!?;:]+$/.test(seg.text.trim())
			prev.text = isPunct ? prev.text + seg.text : `${prev.text} ${seg.text}`
			prev.ts = seg.ts
		} else {
			out.push({ ...seg })
		}
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
