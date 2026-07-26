import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IpcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerGitIpc } from '../electron/git/ipc'
import { IPC } from '../src/lib/ipc'

/**
 * Regression, reported from real use:
 *
 *   Error occurred in handler for 'openpi:git-file-tree':
 *   GitError: fatal: not a git repository
 *
 * Opening a folder that isn't a git repository is normal — a plain documents
 * folder is a first-class case, not a mistake — but every git READ except
 * GIT_STATUS assumed a repo and let the error escape as a rejected IPC
 * handler, which surfaces in the renderer as an unhandled rejection instead
 * of an empty panel.
 *
 * MUTATIONS are intentionally not covered here: a silently swallowed commit
 * or checkout failure is far worse than a noisy one.
 */

type Handler = (event: unknown, ...args: unknown[]) => unknown

let tmp: string
let handlers: Map<string, Handler>

/** Minimal ipcMain that just records what got registered. */
function fakeIpcMain(): IpcMain {
  return {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener)
    },
    on: () => {},
  } as unknown as IpcMain
}

beforeEach(() => {
  // A real directory that is definitively not a git repository.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-nonrepo-'))
  fs.writeFileSync(path.join(tmp, 'notes.txt'), 'just a folder', 'utf-8')

  handlers = new Map()
  registerGitIpc({
    ipcMain: fakeIpcMain(),
    getCwd: () => tmp,
    getDeferredWorkspace: () => null,
    getGitHost: async () => await import('../electron/git/gitHost'),
    restartGitMonitoring: async () => {},
    filterBlockedPaths: (paths: string[]) => ({ allowed: paths, blocked: [] }),
    confirmHighRiskMutation: async () => false,
    getCommitAgentContext: async () => undefined,
  } as unknown as Parameters<typeof registerGitIpc>[0])
})

afterEach(() => {
  // Best-effort. On Windows the git child process can still hold a handle to
  // the directory when the test ends, and rmSync throws EPERM. Failing a test
  // on temp-dir cleanup would be reporting a lie about the behaviour under
  // test; the OS reclaims %TEMP% regardless.
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* leave it for the OS */
  }
})

async function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return handler({}, ...args)
}

describe('git reads in a folder that is not a repository', () => {
  it('MUST NOT reject GIT_FILE_TREE — the exact reported failure', async () => {
    await expect(call(IPC.GIT_FILE_TREE, tmp)).resolves.toBeNull()
  })

  it('does not reject the other panel reads either', async () => {
    await expect(call(IPC.GIT_STATUS, tmp)).resolves.toBeNull()
    await expect(call(IPC.GIT_REFS)).resolves.toBeNull()
    await expect(call(IPC.GIT_HISTORY, { query: '', limit: 20 })).resolves.toBeNull()
    await expect(call(IPC.GIT_REMOTE_URL)).resolves.toBeNull()
  })

  it('does not reject the scoped diff reads', async () => {
    await expect(call(IPC.GIT_STAGED_DIFF, {})).resolves.toBeNull()
    await expect(call(IPC.GIT_BRANCH_DIFF, {})).resolves.toBeNull()
    await expect(call(IPC.GIT_BRANCH_BASE, {})).resolves.toBeNull()
  })

  it('returns no search hits rather than throwing', async () => {
    await expect(
      call(IPC.SEARCH_FILE_CONTENTS, {
        query: 'anything',
        matchCase: false,
        wholeWord: false,
        useRegex: false,
      })
    ).resolves.toEqual([])
  })

  it('returns no commit message rather than throwing', async () => {
    await expect(call(IPC.GIT_GENERATE_COMMIT_MSG)).resolves.toBeNull()
  })
})
