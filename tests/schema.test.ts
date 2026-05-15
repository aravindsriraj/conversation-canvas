import { describe, expect, it } from 'vitest'
import { ActionSchema, ActionStreamSchema } from '@lib/actions/schema'

describe('ActionSchema', () => {
  it('accepts a valid create_proposal_card', () => {
    const parsed = ActionSchema.parse({
      type: 'create_proposal_card',
      id: 'p1',
      proposerSpeakerId: 'S0',
      content: 'Q3 focus on enterprise',
      ts: Date.now(),
    })
    expect(parsed.type).toBe('create_proposal_card')
  })

  it('rejects an unknown action type', () => {
    expect(() => ActionSchema.parse({ type: 'create_unicorn' })).toThrow()
  })

  it('accepts link_nodes with valid kind', () => {
    const parsed = ActionSchema.parse({
      type: 'link_nodes',
      from: 'p1',
      to: 'p2',
      kind: 'counters',
    })
    expect(parsed.type).toBe('link_nodes')
  })

  it('rejects link_nodes with invalid kind', () => {
    expect(() =>
      ActionSchema.parse({ type: 'link_nodes', from: 'a', to: 'b', kind: 'invalid' }),
    ).toThrow()
  })

  it('accepts a stream array', () => {
    const stream = ActionStreamSchema.parse({
      actions: [
        { type: 'create_proposal_card', id: 'p1', proposerSpeakerId: 'S0', content: 'x', ts: 0 },
        { type: 'link_nodes', from: 'p1', to: 'p2', kind: 'supports' },
      ],
    })
    expect(stream.actions).toHaveLength(2)
  })
})
