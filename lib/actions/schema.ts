import { z } from 'zod'

const LayoutHint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('below'), of: z.string() }),
  z.object({ kind: z.literal('above'), of: z.string() }),
  z.object({ kind: z.literal('right_of'), of: z.string() }),
  z.object({ kind: z.literal('left_of'), of: z.string() }),
  z.object({ kind: z.literal('inside_frame'), of: z.string() }),
  z.object({ kind: z.literal('grid'), columns: z.number().int().positive() }),
  z.object({ kind: z.literal('cluster_with'), nodeIds: z.array(z.string()) }),
])

// tldraw's default style enums — must match TLDefaultColorStyle etc. exactly.
// Centralised so every action that touches styling stays in lockstep.
const ColorEnum = z.enum([
  'black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue',
  'yellow', 'orange', 'green', 'light-green', 'light-red', 'red', 'white',
])
const FillEnum = z.enum(['none', 'semi', 'solid', 'pattern'])
const DashEnum = z.enum(['draw', 'solid', 'dashed', 'dotted'])
const SizeEnum = z.enum(['s', 'm', 'l', 'xl'])
const FontEnum = z.enum(['draw', 'sans', 'serif', 'mono'])
const AlignEnum = z.enum(['left', 'right', 'center-horizontal', 'top', 'bottom', 'center-vertical'])
const DistributeEnum = z.enum(['horizontal', 'vertical'])
const ReorderEnum = z.enum(['to_front', 'to_back', 'forward', 'backward'])

const Base = { id: z.string() }

export const ActionSchema = z.discriminatedUnion('type', [
  // L1 cards
  z.object({
    type: z.literal('create_proposal_card'),
    ...Base,
    proposerSpeakerId: z.string(),
    content: z.string().min(1).max(500),
    ts: z.number(),
    layout: LayoutHint.optional(),
  }),
  z.object({
    type: z.literal('create_decision_card'),
    ...Base,
    content: z.string().min(1).max(500),
    ownerSpeakerId: z.string().optional(),
    deadline: z.string().optional(),
    sourceProposalIds: z.array(z.string()).optional(),
    layout: LayoutHint.optional(),
  }),
  z.object({
    type: z.literal('create_commitment_card'),
    ...Base,
    ownerSpeakerId: z.string(),
    action: z.string().min(1).max(300),
    deadline: z.string().optional(),
    layout: LayoutHint.optional(),
  }),
  z.object({
    type: z.literal('create_blocker_card'),
    ...Base,
    content: z.string().min(1).max(300),
    blockedNodeIds: z.array(z.string()).optional(),
    layout: LayoutHint.optional(),
  }),
  z.object({
    type: z.literal('create_question_card'),
    ...Base,
    content: z.string().min(1).max(300),
    askedBySpeakerId: z.string(),
    layout: LayoutHint.optional(),
  }),
  z.object({
    type: z.literal('group_into_frame'),
    nodeIds: z.array(z.string()).min(2),
    label: z.string(),
  }),
  // Free-form sticky note. Maps to tldraw's native `note` shape — used when
  // the agent needs to jot something generic that doesn't fit any of the
  // meeting-specific cards above ("add a box for X", "remind me to Y", etc.).
  z.object({
    type: z.literal('create_note'),
    ...Base,
    content: z.string().min(1).max(2000),
    // tldraw's TLDefaultColorStyle palette. Optional — we default to yellow
    // (the classic sticky-note colour). Restrict to the documented values so
    // the LLM can't drift into hex codes.
    color: z
      .enum([
        'black',
        'grey',
        'light-violet',
        'violet',
        'blue',
        'light-blue',
        'yellow',
        'orange',
        'green',
        'light-green',
        'light-red',
        'red',
        'white',
      ])
      .optional(),
    layout: LayoutHint.optional(),
  }),
  // Generic tldraw geo shape — rectangle, ellipse, triangle, diamond, star,
  // hexagon, heart, etc. Lets the agent "draw a box / circle / triangle"
  // for diagramming requests that don't fit the meeting-card schema. The
  // `content` lands inside the shape as native richText.
  z.object({
    type: z.literal('create_geo'),
    ...Base,
    geo: z
      .enum([
        'rectangle',
        'ellipse',
        'triangle',
        'diamond',
        'pentagon',
        'hexagon',
        'octagon',
        'star',
        'rhombus',
        'oval',
        'trapezoid',
        'cloud',
        'heart',
        'x-box',
        'check-box',
        'arrow-right',
        'arrow-left',
        'arrow-up',
        'arrow-down',
      ])
      .default('rectangle'),
    content: z.string().max(500).optional(),
    color: z
      .enum([
        'black',
        'grey',
        'light-violet',
        'violet',
        'blue',
        'light-blue',
        'yellow',
        'orange',
        'green',
        'light-green',
        'light-red',
        'red',
        'white',
      ])
      .optional(),
    fill: z.enum(['none', 'semi', 'solid', 'pattern']).optional(),
    w: z.number().positive().max(2000).optional(),
    h: z.number().positive().max(2000).optional(),
    layout: LayoutHint.optional(),
  }),
  // Free-floating plain text label. Maps to tldraw's native `text` shape —
  // for headings, callouts, or any text not anchored inside a card/geo.
  z.object({
    type: z.literal('create_text'),
    ...Base,
    content: z.string().min(1).max(2000),
    color: z
      .enum([
        'black',
        'grey',
        'light-violet',
        'violet',
        'blue',
        'light-blue',
        'yellow',
        'orange',
        'green',
        'light-green',
        'light-red',
        'red',
        'white',
      ])
      .optional(),
    // tldraw's text shape supports a size token instead of explicit pixels.
    size: z.enum(['s', 'm', 'l', 'xl']).optional(),
    layout: LayoutHint.optional(),
  }),
  // L2 relations
  z.object({
    type: z.literal('link_nodes'),
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
    kind: z.enum(['supports', 'counters', 'depends_on', 'decides', 'blocks', 'contradicts']),
  }),
  // State transitions
  z.object({ type: z.literal('lock_decision'), id: z.string() }),
  z.object({
    type: z.literal('update_card'),
    id: z.string(),
    patch: z.record(z.string(), z.any()),
  }),
  // L3 bespoke widgets
  z.object({
    type: z.literal('create_priority_matrix'),
    ...Base,
    items: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        impact: z.number().min(0).max(1),
        effort: z.number().min(0).max(1),
      }),
    ),
    layout: LayoutHint.optional(),
  }),
  z.object({
    type: z.literal('create_budget_allocator'),
    ...Base,
    total: z.number().positive(),
    currency: z.string().default('USD'),
    splits: z.array(
      z.object({
        label: z.string(),
        amountPct: z.number().min(0).max(100),
        ownerSpeakerId: z.string().optional(),
      }),
    ),
    layout: LayoutHint.optional(),
  }),
  z.object({
    type: z.literal('create_gantt'),
    ...Base,
    items: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        ownerSpeakerId: z.string().optional(),
        startDays: z.number(),
        endDays: z.number(),
      }),
    ),
    layout: LayoutHint.optional(),
  }),
  z.object({
    type: z.literal('create_bespoke_widget'),
    ...Base,
    spec: z.any(), // validated by BespokeWidgetSpec separately
    layout: LayoutHint.optional(),
  }),
  // ────────────────────────────────────────────────────────────────────────
  // L4 — shape manipulation primitives. These wrap tldraw Editor methods so
  // the agent can rearrange / restyle / delete / reorder / camera existing
  // shapes (referenced by their MODEL id — same id used when the shape was
  // created; apply.ts resolves to the underlying TLShapeId via ID_MAP).
  // ────────────────────────────────────────────────────────────────────────
  z.object({
    type: z.literal('delete_shapes'),
    ids: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal('move_shape'),
    id: z.string(),
    // Pass either absolute x/y OR relative dx/dy. Apply.ts prefers absolute
    // if both supplied — relative is for "move right by 200px" intent.
    x: z.number().optional(),
    y: z.number().optional(),
    dx: z.number().optional(),
    dy: z.number().optional(),
  }),
  z.object({
    type: z.literal('resize_shape'),
    id: z.string(),
    w: z.number().positive().max(4000).optional(),
    h: z.number().positive().max(4000).optional(),
  }),
  z.object({
    type: z.literal('set_shape_style'),
    id: z.string(),
    color: ColorEnum.optional(),
    fill: FillEnum.optional(),
    dash: DashEnum.optional(),
    size: SizeEnum.optional(),
    font: FontEnum.optional(),
  }),
  z.object({
    type: z.literal('align_shapes'),
    ids: z.array(z.string()).min(2),
    op: AlignEnum,
  }),
  z.object({
    type: z.literal('distribute_shapes'),
    ids: z.array(z.string()).min(3),
    op: DistributeEnum,
  }),
  z.object({
    type: z.literal('reorder_shapes'),
    ids: z.array(z.string()).min(1),
    op: ReorderEnum,
  }),
  z.object({
    type: z.literal('zoom_to_shapes'),
    // Omit / empty → zoom-to-fit ALL shapes on the page.
    ids: z.array(z.string()).optional(),
  }),
  // Freeform arrow that does NOT bind to existing shape ids. Use `link_nodes`
  // when the agent wants an arrow that follows shapes as they move. This is
  // for arrows annotating empty canvas space ("draw an arrow from the title
  // pointing down to nothing").
  z.object({
    type: z.literal('create_arrow'),
    ...Base,
    start: z.object({ x: z.number(), y: z.number() }),
    end: z.object({ x: z.number(), y: z.number() }),
    text: z.string().max(200).optional(),
    color: ColorEnum.optional(),
    kind: z.enum(['arc', 'elbow']).optional(),
    layout: LayoutHint.optional(),
  }),
])

export type Action = z.infer<typeof ActionSchema>

export const ActionStreamSchema = z.object({
  actions: z.array(ActionSchema),
})

export type ActionStream = z.infer<typeof ActionStreamSchema>
