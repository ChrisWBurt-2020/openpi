import { describe, expect, it } from 'vitest'
import { CompanionHost } from '../electron/services/companionHost'
import { companionColor, companionStateSchema } from '../src/lib/companion'

const project = 'C:\\code\\heron'
const at = '2026-07-26T12:00:00.000Z'

describe('Heron companion truth state', () => {
  it('rejects a non-idle state without evidence', () => {
    expect(companionStateSchema.safeParse({ kind: 'active', since: at })).toMatchObject({
      success: false,
    })
    expect(companionStateSchema.safeParse({ kind: 'idle', since: at }).success).toBe(true)
  })

  it('generates stable project colors', () => {
    expect(companionColor(project)).toEqual(companionColor(project))
    expect(companionColor(project)).not.toEqual(companionColor('C:\\code\\other'))
  })

  it('keeps simultaneous project truth and applies severity precedence', () => {
    const host = new CompanionHost()
    host.ensure(project, 'heron')
    host.ensure('C:\\code\\review', 'review')
    host.apply({
      type: 'activity_started',
      projectPath: project,
      evidence: {
        kind: 'session',
        id: 'thread-a',
        threadId: 'thread-a',
        label: 'Agent working',
        at,
      },
    })
    host.apply({
      type: 'review_pending',
      projectPath: 'C:\\code\\review',
      evidence: { kind: 'review', id: 'review-a', label: 'Review note.ts', at },
    })
    host.apply({
      type: 'error',
      projectPath: project,
      evidence: { kind: 'error', id: 'error-a', label: 'Provider failed', at },
    })

    expect(host.list()[project]?.state.kind).toBe('error')
    expect(host.list()['C:\\code\\review']?.state.kind).toBe('review')
  })
})
