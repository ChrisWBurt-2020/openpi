import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveSessionAccess } from '../electron/pi/sessionAccess'
import type { SessionLockAcquireResult } from '../electron/pi/sessionLock'

/**
 * ADR-003, the part that actually protects data: when a session file is unsafe
 * to write, we must not write it. Detecting the conflict and then opening
 * read-write anyway (the behaviour this replaced) is the bug.
 *
 * The MUST under test throughout: the requested file is byte-identical after
 * any unsafe open.
 */

let tmp: string
let sessions: string
let clones: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-access-'))
  sessions = path.join(tmp, 'sessions')
  clones = path.join(tmp, 'detached')
  fs.mkdirSync(sessions, { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const FIXED_TS = '2026-07-25T18:00:00.000Z'

function writeSession(name: string, version?: number, extra: string[] = []): string {
  const file = path.join(sessions, name)
  const header = {
    type: 'session',
    ...(version === undefined ? {} : { version }),
    id: 'sess-1',
    timestamp: FIXED_TS,
    cwd: 'C:\\repo',
  }
  fs.writeFileSync(file, `${[JSON.stringify(header), ...extra].join('\n')}\n`, 'utf-8')
  return file
}

/** A lock stub that always reports a live holder on this host. */
const heldByLiveHolder = (file: string): SessionLockAcquireResult => ({
  acquired: false,
  lockPath: `${file}.lock`,
  holder: { pid: 4242, app: 'pi', hostname: os.hostname(), ts: Date.now() },
  holderState: 'live',
  message: 'This session is open in pi (pid 4242).',
})

describe('the ordinary case', () => {
  it('opens the requested file read-write when nothing is wrong', () => {
    const file = writeSession('ok.jsonl', CURRENT_SESSION_VERSION)

    const decision = resolveSessionAccess(file, { cloneDir: clones })

    expect(decision.mode).toBe('read-write')
    expect(decision.openPath).toBe(file)
    expect(decision.reasons).toEqual([])
    // No clone directory should be created when it isn't needed.
    expect(fs.existsSync(clones)).toBe(false)
  })
})

describe('a session written by a newer Pi', () => {
  it('opens a detached copy and leaves the original untouched', () => {
    const file = writeSession('newer.jsonl', CURRENT_SESSION_VERSION + 1, ['{"type":"message"}'])
    const before = fs.readFileSync(file, 'utf-8')

    const decision = resolveSessionAccess(file, { cloneDir: clones })

    expect(decision.mode).toBe('cloned')
    expect(decision.reasons).toContain('version-newer')
    expect(decision.openPath).not.toBe(file)
    // MUST: the file we refused to write is unchanged...
    expect(fs.readFileSync(file, 'utf-8')).toBe(before)
    // ...and the copy carries the full history.
    expect(fs.readFileSync(decision.openPath as string, 'utf-8')).toBe(before)
  })

  it('tells the user which file it is really working in', () => {
    const file = writeSession('newer2.jsonl', CURRENT_SESSION_VERSION + 1)
    const decision = resolveSessionAccess(file, { cloneDir: clones })

    expect(decision.requestedPath).toBe(file)
    expect(decision.messages.join(' ')).toContain('detached copy')
    expect(decision.messages.join(' ')).toContain(file)
  })
})

describe('a session another process is holding', () => {
  it('opens a detached copy rather than racing the lock holder', () => {
    const file = writeSession('locked.jsonl', CURRENT_SESSION_VERSION, ['{"type":"message"}'])
    const before = fs.readFileSync(file, 'utf-8')

    const decision = resolveSessionAccess(file, {
      cloneDir: clones,
      acquire: (target) =>
        target === file
          ? heldByLiveHolder(file)
          : {
              acquired: true,
              lockPath: `${target}.lock`,
              info: { pid: 1, app: 'openpi', hostname: os.hostname(), ts: 0 },
            },
    })

    expect(decision.mode).toBe('cloned')
    expect(decision.reasons).toEqual(['lock-conflict'])
    expect(fs.readFileSync(file, 'utf-8')).toBe(before)
    // The holder's own message must reach the user, not just our summary.
    expect(decision.messages.join(' ')).toContain('pid 4242')
  })

  it('holds a lock on the copy it actually opened', () => {
    const file = writeSession('locked2.jsonl', CURRENT_SESSION_VERSION)
    const locked: string[] = []

    const decision = resolveSessionAccess(file, {
      cloneDir: clones,
      acquire: (target) => {
        if (target === file) return heldByLiveHolder(file)
        locked.push(target)
        return {
          acquired: true,
          lockPath: `${target}.lock`,
          info: { pid: 1, app: 'openpi', hostname: os.hostname(), ts: 0 },
        }
      },
    })

    expect(locked).toEqual([decision.openPath])
  })
})

describe('a session we cannot parse', () => {
  it('opens a detached copy instead of appending to something unreadable', () => {
    const file = path.join(sessions, 'corrupt.jsonl')
    fs.writeFileSync(file, '{"type":"session", truncated\n', 'utf-8')
    const before = fs.readFileSync(file, 'utf-8')

    const decision = resolveSessionAccess(file, { cloneDir: clones })

    expect(decision.mode).toBe('cloned')
    expect(decision.reasons).toContain('unparseable-header')
    expect(fs.readFileSync(file, 'utf-8')).toBe(before)
  })
})

describe('when the detached copy cannot be made', () => {
  it('MUST block rather than fall back to writing the unsafe file', () => {
    const file = writeSession('newer3.jsonl', CURRENT_SESSION_VERSION + 1)
    // A file where the clone directory needs to be.
    const blocker = path.join(tmp, 'blocker')
    fs.writeFileSync(blocker, 'not a directory', 'utf-8')

    const decision = resolveSessionAccess(file, { cloneDir: path.join(blocker, 'nested') })

    expect(decision.mode).toBe('blocked')
    expect(decision.openPath).toBeNull()
    expect(decision.reasons).toContain('clone-failed')
  })

  it('MUST block when no scratch directory is configured at all', () => {
    const file = writeSession('newer4.jsonl', CURRENT_SESSION_VERSION + 1)

    const decision = resolveSessionAccess(file)

    expect(decision.mode).toBe('blocked')
    expect(decision.openPath).toBeNull()
    // The explanation must say why we did not just open it anyway.
    expect(decision.messages.join(' ')).toMatch(/risk/i)
  })
})

describe('lock hygiene', () => {
  it('does not take a lock on a file it has already decided not to write', () => {
    const file = writeSession('newer5.jsonl', CURRENT_SESSION_VERSION + 1)
    const lockAttempts: string[] = []

    resolveSessionAccess(file, {
      cloneDir: clones,
      acquire: (target) => {
        lockAttempts.push(target)
        return {
          acquired: true,
          lockPath: `${target}.lock`,
          info: { pid: 1, app: 'openpi', hostname: os.hostname(), ts: 0 },
        }
      },
    })

    // Only the clone should ever be locked — leaving a lockfile next to a
    // session we refused to open would misrepresent who owns it.
    expect(lockAttempts).toHaveLength(1)
    expect(lockAttempts[0]).not.toBe(file)
  })
})

describe('older formats still open normally', () => {
  it('backs up and opens read-write rather than detaching', () => {
    const file = writeSession('old.jsonl', 1)
    const backups = path.join(tmp, 'backups')

    const decision = resolveSessionAccess(file, { cloneDir: clones, backupDir: backups })

    // An older format is Pi's own supported migration path, not a conflict.
    expect(decision.mode).toBe('read-write')
    expect(decision.openPath).toBe(file)
    expect(fs.readdirSync(backups)).toHaveLength(1)
  })
})
