export interface ShapeBox {
  x: number
  y: number
  w: number
  h: number
}

export type LayoutHint =
  | { kind: 'below'; of: string }
  | { kind: 'right_of'; of: string }
  | { kind: 'inside_frame'; of: string }
  | { kind: 'grid'; columns: number }
  | { kind: 'cluster_with'; nodeIds: string[] }

interface ResolveOpts {
  defaultW: number
  defaultH: number
  gap?: number
}

const GAP = 32

export function resolveLayout(
  hint: LayoutHint | undefined,
  existing: Map<string, ShapeBox>,
  opts: ResolveOpts,
): { x: number; y: number } {
  const gap = opts.gap ?? GAP

  if (hint && 'of' in hint) {
    const ref = existing.get(hint.of)
    if (ref) {
      if (hint.kind === 'below') return { x: ref.x, y: ref.y + ref.h + gap }
      if (hint.kind === 'right_of') return { x: ref.x + ref.w + gap, y: ref.y }
      if (hint.kind === 'inside_frame') return { x: ref.x + 16, y: ref.y + 32 }
    }
  }

  if (hint?.kind === 'cluster_with' && hint.nodeIds.length > 0) {
    const refs = hint.nodeIds.map((id) => existing.get(id)).filter(Boolean) as ShapeBox[]
    if (refs.length > 0) {
      const avgX = refs.reduce((a, b) => a + b.x, 0) / refs.length
      const avgY = refs.reduce((a, b) => a + b.y, 0) / refs.length
      return { x: avgX + opts.defaultW + gap, y: avgY }
    }
  }

  // Fallback: next free slot in a grid
  const cols = hint?.kind === 'grid' ? hint.columns : 3
  const used = Array.from(existing.values())
  const slot = used.length
  const col = slot % cols
  const row = Math.floor(slot / cols)
  return {
    x: 80 + col * (opts.defaultW + gap),
    y: 80 + row * (opts.defaultH + gap),
  }
}
