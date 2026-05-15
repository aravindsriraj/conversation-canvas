import type { TranscriptSegment } from '@/lib/speechmatics/client'

interface BufferOptions {
  windowSeconds: number
  debounceMs?: number
  onTick: () => void | Promise<void>
}

export class TranscriptBuffer {
  private segments: TranscriptSegment[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private opts: Required<BufferOptions>

  constructor(opts: BufferOptions) {
    this.opts = { debounceMs: 3000, ...opts } as Required<BufferOptions>
  }

  add(seg: TranscriptSegment) {
    if (!seg.isFinal) return
    this.segments.push(seg)
    this.evictOld()
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.opts.onTick()
    }, this.opts.debounceMs)
  }

  window(): TranscriptSegment[] {
    this.evictOld()
    return [...this.segments]
  }

  private evictOld() {
    if (this.segments.length === 0) return
    const latest = this.segments[this.segments.length - 1].ts
    const cutoff = latest - this.opts.windowSeconds * 1000
    this.segments = this.segments.filter((s) => s.ts >= cutoff)
  }

  forceTick() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.opts.onTick()
  }
}
