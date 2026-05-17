import { describe, expect, it } from 'vitest'
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt'
import { VOICE_AGENT_SYSTEM_PROMPT } from '@/lib/orchestrator/voice-agent-prompt'

/**
 * Lock-in tests for the "STREAMING — emit ONE action per step" guidance.
 *
 * These prompts are the contract that makes parallel-tool-calling models
 * (like Gemini Flash) emit actions sequentially within a turn. Without this
 * guidance the model batches all tool calls into a single step and the
 * client sees a burst dump rather than progressive shape-by-shape
 * appearance.
 *
 * If a future refactor deletes or weakens these blocks, these tests fail
 * loudly — surfacing a regression that wouldn't otherwise show up in
 * unit tests (it manifests as "shapes appear all at once" at runtime,
 * which only humans catch).
 */

describe('streaming prompts', () => {
	describe('chat agent (AGENT_SYSTEM_PROMPT)', () => {
		it('mentions the streaming behavior explicitly', () => {
			expect(AGENT_SYSTEM_PROMPT).toMatch(/STREAMING/)
		})

		it('tells the model to emit one action per step', () => {
			// Allow both "ONE action per step" and "one action per step"
			// phrasings — case shouldn't be load-bearing for the test.
			expect(AGENT_SYSTEM_PROMPT).toMatch(/one action per step/i)
		})

		it('warns explicitly against batching all actions in a single step', () => {
			expect(AGENT_SYSTEM_PROMPT.toLowerCase()).toMatch(/not batch/)
		})

		it('declares the new 15-step cap', () => {
			expect(AGENT_SYSTEM_PROMPT).toMatch(/up to 15 steps/i)
		})

		it('keeps read tools explicitly parallel-friendly', () => {
			// We want the model to know reads CAN parallelize within a
			// step — only emits should serialize. This guards against an
			// over-aggressive future edit that says "everything one per
			// step" and slows the agent down on observation work.
			expect(AGENT_SYSTEM_PROMPT.toLowerCase()).toMatch(/read tools/)
			expect(AGENT_SYSTEM_PROMPT.toLowerCase()).toMatch(/parallel/)
		})
	})

	describe('voice MODE-B agent (VOICE_AGENT_SYSTEM_PROMPT)', () => {
		it('mentions the streaming behavior explicitly', () => {
			expect(VOICE_AGENT_SYSTEM_PROMPT).toMatch(/STREAMING/)
		})

		it('tells the model to emit one action per step', () => {
			expect(VOICE_AGENT_SYSTEM_PROMPT).toMatch(/one action per step/i)
		})

		it('declares the new 8-step cap (voice is latency-sensitive)', () => {
			expect(VOICE_AGENT_SYSTEM_PROMPT).toMatch(/up to 8 steps/i)
		})

		it('keeps read tools explicitly parallel-friendly', () => {
			expect(VOICE_AGENT_SYSTEM_PROMPT.toLowerCase()).toMatch(/read tools/)
			expect(VOICE_AGENT_SYSTEM_PROMPT.toLowerCase()).toMatch(/parallel/)
		})
	})
})
