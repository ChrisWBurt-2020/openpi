import { describe, expect, it } from 'vitest'
import { resolveBootTarget } from '../electron/session/bootTarget'

/**
 * Regression: after a restart the app restored the last WORKSPACE and handed
 * you a blank new session. The previous conversation was still on disk and in
 * the sidebar, but not in front of you, which reads as "my chat is gone" —
 * especially after a forced restart, which is how it was reported.
 */

const exists = () => true
const missing = () => false

describe('resuming where the user left off', () => {
  it('reopens the last session for the last workspace', () => {
    expect(
      resolveBootTarget({
        lastWorkspace: 'C:\\repo',
        lastSessionFile: 'C:\\sessions\\a.jsonl',
        sessionFileExists: exists,
      })
    ).toEqual({ kind: 'session', cwd: 'C:\\repo', sessionFile: 'C:\\sessions\\a.jsonl' })
  })
})

describe('degrading safely', () => {
  it('falls back to the workspace when the session file is gone', () => {
    // The index can outlive the file: sessions get deleted or moved behind
    // its back. Resuming a missing path would fail the whole boot.
    expect(
      resolveBootTarget({
        lastWorkspace: 'C:\\repo',
        lastSessionFile: 'C:\\sessions\\deleted.jsonl',
        sessionFileExists: missing,
      })
    ).toEqual({ kind: 'workspace', cwd: 'C:\\repo' })
  })

  it('falls back to the workspace when the workspace has no sessions yet', () => {
    expect(
      resolveBootTarget({
        lastWorkspace: 'C:\\repo',
        lastSessionFile: null,
        sessionFileExists: exists,
      })
    ).toEqual({ kind: 'workspace', cwd: 'C:\\repo' })
  })

  it('shows nothing on a genuinely first run', () => {
    expect(
      resolveBootTarget({
        lastWorkspace: null,
        lastSessionFile: null,
        sessionFileExists: exists,
      })
    ).toEqual({ kind: 'none' })
  })

  it('does not resume a session when there is no workspace to resume it into', () => {
    expect(
      resolveBootTarget({
        lastWorkspace: null,
        lastSessionFile: 'C:\\sessions\\orphan.jsonl',
        sessionFileExists: exists,
      })
    ).toEqual({ kind: 'none' })
  })
})
