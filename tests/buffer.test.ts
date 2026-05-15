import { describe, expect, it, vi } from 'vitest'
import { TranscriptBuffer } from '@lib/orchestrator/buffer'

describe('TranscriptBuffer', () => {
  it('accumulates final segments', () => {
    const buf = new TranscriptBuffer({ windowSeconds: 90, onTick: () => {} })
    buf.add({ speaker: 'S0', text: 'hello', isFinal: true, ts: 1000 })
    buf.add({ speaker: 'S1', text: 'world', isFinal: true, ts: 2000 })
    expect(buf.window().map((s) => s.text)).toEqual(['hello', 'world'])
  })

  it('ignores non-final segments in the window', () => {
    const buf = new TranscriptBuffer({ windowSeconds: 90, onTick: () => {} })
    buf.add({ speaker: 'S0', text: 'partial', isFinal: false, ts: 1000 })
    expect(buf.window()).toHaveLength(0)
  })

  it('debounces calls to onTick after final segments', async () => {
    vi.useFakeTimers()
    const onTick = vi.fn()
    const buf = new TranscriptBuffer({ windowSeconds: 90, onTick, debounceMs: 50 })
    buf.add({ speaker: 'S0', text: 'one', isFinal: true, ts: 0 })
    buf.add({ speaker: 'S0', text: 'two', isFinal: true, ts: 10 })
    expect(onTick).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60)
    expect(onTick).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('evicts segments older than windowSeconds', () => {
    const buf = new TranscriptBuffer({ windowSeconds: 60, onTick: () => {} })
    buf.add({ speaker: 'S0', text: 'old', isFinal: true, ts: 0 })
    buf.add({ speaker: 'S0', text: 'new', isFinal: true, ts: 90_000 })
    expect(buf.window().map((s) => s.text)).toEqual(['new'])
  })
})
