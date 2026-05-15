import { describe, expect, it } from 'vitest'
import { resolveLayout } from '@lib/actions/layout-resolver'

describe('resolveLayout', () => {
  const existing = new Map([['p1', { x: 100, y: 100, w: 280, h: 140 }]])

  it('falls back to next-slot when no hint provided', () => {
    const out = resolveLayout(undefined, existing, { defaultW: 280, defaultH: 140 })
    expect(out.x).toBeGreaterThanOrEqual(0)
    expect(out.y).toBeGreaterThanOrEqual(0)
  })

  it('places below when hint is below', () => {
    const out = resolveLayout({ kind: 'below', of: 'p1' }, existing, {
      defaultW: 280,
      defaultH: 140,
    })
    expect(out.x).toBe(100)
    expect(out.y).toBeGreaterThan(100 + 140)
  })

  it('places right_of correctly', () => {
    const out = resolveLayout({ kind: 'right_of', of: 'p1' }, existing, {
      defaultW: 280,
      defaultH: 140,
    })
    expect(out.x).toBeGreaterThan(100 + 280)
    expect(out.y).toBe(100)
  })

  it('falls back when referenced shape does not exist', () => {
    const out = resolveLayout({ kind: 'below', of: 'unknown' }, existing, {
      defaultW: 280,
      defaultH: 140,
    })
    expect(out.x).toBeGreaterThanOrEqual(0)
    expect(out.y).toBeGreaterThanOrEqual(0)
  })
})
