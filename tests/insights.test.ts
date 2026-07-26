import { describe, expect, it } from 'vitest'
import { insightInstructions, restoreInsightFingerprints } from '../electron/pi/insightsExtension'
import { insightFingerprint, insightPayloadSchema } from '../src/lib/insights'

const valid = {
  category: 'architecture',
  title: 'Sessions are isolated by thread',
  explanation:
    'Each live conversation owns a sidecar, so a stalled agent cannot block another thread.',
  whyItMatters: 'Foreground work remains responsive while background work continues.',
  evidence: [{ type: 'file', path: 'electron/session/sessionHost.ts', startLine: 36, endLine: 65 }],
  confidence: 'high',
  basis: 'observed',
  knowledgeCandidate: true,
} as const

describe('Pi Signals contract', () => {
  it('accepts evidence-backed file and command signals', () => {
    const parsed = insightPayloadSchema.safeParse({
      ...valid,
      evidence: [
        ...valid.evidence,
        {
          type: 'command',
          command: 'npm run typecheck',
          description: 'Verified the worker routing types.',
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects inverted source ranges', () => {
    const parsed = insightPayloadSchema.safeParse({
      ...valid,
      evidence: [{ type: 'file', path: 'src/App.tsx', startLine: 14, endLine: 3 }],
    })
    expect(parsed.success).toBe(false)
  })

  it('uses normalized category, title, and evidence as a stable dedupe key', () => {
    const first = insightPayloadSchema.parse(valid)
    const second = insightPayloadSchema.parse({
      ...valid,
      title: 'sessions are isolated by thread',
      evidence: [{ ...valid.evidence[0], path: 'ELECTRON/session/sessionHost.ts' }],
    })
    expect(insightFingerprint(first)).toBe(insightFingerprint(second))
  })

  it('rejects oversized or evidence-free observations', () => {
    expect(insightPayloadSchema.safeParse({ ...valid, evidence: [] }).success).toBe(false)
    expect(insightPayloadSchema.safeParse({ ...valid, title: 'x'.repeat(121) }).success).toBe(false)
  })

  it('injects a cadence-specific prompt and restores prior signal fingerprints', () => {
    expect(insightInstructions('mentor')).toContain('at most 4')
    expect(insightInstructions('critical')).toContain('at most 1')
    const fingerprints = restoreInsightFingerprints([
      {
        message: {
          content: [{ type: 'toolCall', name: 'emit_insight', arguments: valid }],
        },
      },
    ])
    expect(fingerprints.has(insightFingerprint(insightPayloadSchema.parse(valid)))).toBe(true)
  })
})
