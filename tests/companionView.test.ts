import { describe, expect, it } from 'vitest'
import { companionOperationalStateSchema } from '../src/lib/companion'
import { companionSeverity, companionSpriteSchema } from '../src/lib/companionView'
import { petPackManifestSchema } from '../src/lib/petPack'

const evidence = [{ kind: 'run' as const, id: 'run', label: 'Run', at: '2026-07-26T12:00:00.000Z' }]
const at = '2026-07-26T12:00:00.000Z'

describe('companion projection contracts', () => {
  it('keeps unknown distinct from active and prioritizes severity', () => {
    const unknown = companionOperationalStateSchema.parse({ kind: 'unknown', reason: 'transport', since: at, evidence })
    const active = companionOperationalStateSchema.parse({ kind: 'active', phase: 'executing', since: at, evidence })
    expect(unknown.kind).toBe('unknown')
    expect(companionSeverity(unknown)).toBeGreaterThan(companionSeverity(active))
  })

  it('accepts phase-derived sprite choices without giving the renderer truth authority', () => {
    expect(companionSpriteSchema.parse({ packId: 'builtin-graphic-heron', clipId: 'active-verifying', palette: { accent: '#8cd7ff', signal: '#8cd7ff', alert: '#4488aa' }, accessory: 'scarf' }).clipId).toBe('active-verifying')
  })

  it('requires an atlas and bounded frames for a local pack', () => {
    expect(petPackManifestSchema.safeParse({
      schemaVersion: 1,
      id: 'test-heron',
      displayName: 'Test',
      atlas: { path: 'atlas.webp', cellWidth: 160, cellHeight: 160, columns: 2, rows: 1 },
      palette: { accent: '#00aaff', signal: '#ccdd44', alert: '#ff6644' },
      clips: [{ id: 'idle', frames: [{ column: 0, row: 0, durationMs: 180 }], hitbox: { x: 0, y: 0, width: 160, height: 160 } }],
    }).success).toBe(true)
  })
})
