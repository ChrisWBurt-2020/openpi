import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  companionOperationalStateSchema,
  projectHarnessProfileUpdateSchema,
} from '../src/lib/companion'
import { CompanionStore } from '../electron/services/companionStore'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function createStore(): CompanionStore {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-companion-'))
  directories.push(directory)
  return new CompanionStore(path.join(directory, 'companion.sqlite'))
}

describe('companion truth contracts', () => {
  it('rejects non-idle operational states without evidence', () => {
    expect(
      companionOperationalStateSchema.safeParse({
        kind: 'active',
        phase: 'executing',
        since: new Date().toISOString(),
        evidence: [],
      }).success
    ).toBe(false)
  })

  it('persists profiles and rejects a stale revision', () => {
    const store = createStore()
    const profile = store.ensureProfile('C:/work/one', 'One')
    const result = store.updateProfile(
      projectHarnessProfileUpdateSchema.parse({
        projectId: profile.projectId,
        expectedRevision: profile.revision,
        patch: { appearance: { ...profile.appearance, pinned: true } },
      })
    )
    expect(result.status).toBe('updated')
    expect(store.findProfileByPath('C:/work/one')?.appearance.pinned).toBe(true)
    const stale = store.updateProfile({
      projectId: profile.projectId,
      expectedRevision: profile.revision,
      patch: { displayName: 'Still stale' },
    })
    expect(stale.status).toBe('conflict')
    store.close()
  })

  it('resolves an evidence address only for an indexed project', () => {
    const store = createStore()
    const profile = store.ensureProfile('C:/work/two', 'Two')
    const record = {
      uri: 'evidence://run/abc/state/1',
      projectId: profile.projectId,
      sourceType: 'run' as const,
      sourceVersion: '1',
      label: 'Run checkpoint',
      createdAt: new Date().toISOString(),
      available: true,
    }
    store.registerEvidence(record)
    expect(store.resolveEvidence(record.uri)).toEqual(record)
    store.close()
  })
})
