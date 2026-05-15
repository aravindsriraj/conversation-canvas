import { z } from 'zod'

const LayoutHint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('below'), of: z.string() }),
  z.object({ kind: z.literal('right_of'), of: z.string() }),
  z.object({ kind: z.literal('inside_frame'), of: z.string() }),
  z.object({ kind: z.literal('grid'), columns: z.number().int().positive() }),
  z.object({ kind: z.literal('cluster_with'), nodeIds: z.array(z.string()) }),
])

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
])

export type Action = z.infer<typeof ActionSchema>

export const ActionStreamSchema = z.object({
  actions: z.array(ActionSchema),
})

export type ActionStream = z.infer<typeof ActionStreamSchema>
