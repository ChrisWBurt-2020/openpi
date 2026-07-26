import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireSessionLock,
  classifyLockHolder,
  DEFAULT_STALE_MS,
  isProcessAlive,
  readLockFile,
  refreshSessionLock,
  releaseSessionLock,
  sessionLockPath,
} from '../electron/pi/sessionLock'

/**
 * ADR-003 item 1. This lock is ADVISORY — terminal Pi does not participate.
 * What it must guarantee: two OpenPi processes never both believe they own a
 * session, a crashed holder's lock ages out, and we never delete a lock owned
 * by someone else.
 */

let tmp: string
let sessionFile: string
const HOST = 'test-host'

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-lock-'))
  sessionFile = path.join(tmp, 'session.jsonl')
  fs.writeFileSync(sessionFile, '{"type":"session"}\n', 'utf-8')
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const alive = () => true
const dead = () => false

describe('acquiring an uncontended lock', () => {
  it('writes a lockfile next to the session', () => {
    const result = acquireSessionLock(sessionFile, { pid: 111, hostname: HOST, now: 1000 })
    expect(result.acquired).toBe(true)
    expect(result.lockPath).toBe(`${sessionFile}.lock`)
    expect(readLockFile(sessionLockPath(sessionFile))).toEqual({
      pid: 111,
      app: 'openpi',
      hostname: HOST,
      ts: 1000,
    })
  })
})

describe('contended locks', () => {
  it('MUST refuse when a live holder on this host owns it', () => {
    acquireSessionLock(sessionFile, { pid: 111, hostname: HOST, now: 1000 })

    const second = acquireSessionLock(sessionFile, {
      pid: 222,
      hostname: HOST,
      now: 1000,
      isAlive: alive,
    })

    expect(second.acquired).toBe(false)
    if (second.acquired) return
    expect(second.holderState).toBe('live')
    expect(second.holder?.pid).toBe(111)
    // The live holder's lock must be left exactly as it was.
    expect(readLockFile(second.lockPath)?.pid).toBe(111)
  })
})

describe('crashed and hung holders', () => {
  it('takes over a lock whose process no longer exists', () => {
    acquireSessionLock(sessionFile, { pid: 111, hostname: HOST, now: 1000 })

    const second = acquireSessionLock(sessionFile, {
      pid: 222,
      hostname: HOST,
      now: 2000,
      isAlive: dead,
    })

    expect(second.acquired).toBe(true)
    if (!second.acquired) return
    expect(second.tookOverFrom?.pid).toBe(111)
    expect(readLockFile(second.lockPath)?.pid).toBe(222)
  })

  it('does NOT auto-steal from a running holder whose heartbeat aged out', () => {
    acquireSessionLock(sessionFile, { pid: 111, hostname: HOST, now: 1000 })

    const second = acquireSessionLock(sessionFile, {
      pid: 222,
      hostname: HOST,
      now: 1000 + DEFAULT_STALE_MS + 1,
      isAlive: alive,
    })

    // Stale-but-alive is a user decision, not an automatic take-over.
    expect(second.acquired).toBe(false)
    if (second.acquired) return
    expect(second.holderState).toBe('stale')
    expect(second.message).toMatch(/hung/i)
  })

  it('takes over a stale holder when the caller opts in explicitly', () => {
    acquireSessionLock(sessionFile, { pid: 111, hostname: HOST, now: 1000 })

    const second = acquireSessionLock(sessionFile, {
      pid: 222,
      hostname: HOST,
      now: 1000 + DEFAULT_STALE_MS + 1,
      isAlive: alive,
      takeOver: ['dead', 'stale'],
    })

    expect(second.acquired).toBe(true)
  })
})

describe('cross-machine holders', () => {
  it('never auto-takes-over a lock held by another host', () => {
    acquireSessionLock(sessionFile, { pid: 111, hostname: 'other-machine', now: 1000 })

    const second = acquireSessionLock(sessionFile, {
      pid: 222,
      hostname: HOST,
      // Far past the staleness window, and the pid "exists" locally by
      // coincidence — neither fact tells us anything about the other host.
      now: 1000 + DEFAULT_STALE_MS * 100,
      isAlive: dead,
      takeOver: ['dead', 'stale'],
    })

    expect(second.acquired).toBe(false)
    if (second.acquired) return
    expect(second.holderState).toBe('foreign')
  })
})

describe('corrupt lockfiles', () => {
  it('treats an unparseable lock as held rather than clobbering it', () => {
    fs.writeFileSync(sessionLockPath(sessionFile), '{half-writ', 'utf-8')

    const result = acquireSessionLock(sessionFile, { pid: 222, hostname: HOST, now: 1000 })

    expect(result.acquired).toBe(false)
    if (result.acquired) return
    expect(result.holderState).toBe('unreadable')
  })

  it('rejects a lockfile missing required fields', () => {
    fs.writeFileSync(sessionLockPath(sessionFile), JSON.stringify({ pid: 1 }), 'utf-8')
    expect(readLockFile(sessionLockPath(sessionFile))).toBeNull()
  })
})

describe('reacquiring our own lock', () => {
  it('refreshes rather than failing when the same pid reopens the session', () => {
    acquireSessionLock(sessionFile, { pid: 111, hostname: HOST, now: 1000 })
    const again = acquireSessionLock(sessionFile, { pid: 111, hostname: HOST, now: 5000 })

    expect(again.acquired).toBe(true)
    expect(readLockFile(sessionLockPath(sessionFile))?.ts).toBe(5000)
  })
})

describe('heartbeat', () => {
  it('advances the timestamp so a live holder never looks stale', () => {
    const { lockPath } = acquireSessionLock(sessionFile, { pid: 111, hostname: HOST, now: 1000 })

    expect(refreshSessionLock(lockPath, { pid: 111, hostname: HOST, now: 9000 })).toBe(true)

    const holder = readLockFile(lockPath)
    expect(holder?.ts).toBe(9000)
    expect(classifyLockHolder(holder as never, { now: 9500, hostname: HOST, isAlive: alive })).toBe(
      'live'
    )
  })

  it('MUST NOT refresh a lock another process now owns', () => {
    const lockPath = sessionLockPath(sessionFile)
    acquireSessionLock(sessionFile, { pid: 999, hostname: HOST, now: 1000 })

    expect(refreshSessionLock(lockPath, { pid: 111, hostname: HOST, now: 9000 })).toBe(false)
    expect(readLockFile(lockPath)?.ts).toBe(1000)
  })
})

describe('release', () => {
  it('removes our own lock so the next opener need not wait out staleness', () => {
    const { lockPath } = acquireSessionLock(sessionFile, { pid: 111, hostname: HOST, now: 1000 })

    expect(releaseSessionLock(lockPath, { pid: 111, hostname: HOST })).toBe(true)
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it("MUST NOT delete another process's lock", () => {
    const lockPath = sessionLockPath(sessionFile)
    acquireSessionLock(sessionFile, { pid: 999, hostname: HOST, now: 1000 })

    expect(releaseSessionLock(lockPath, { pid: 111, hostname: HOST })).toBe(false)
    expect(fs.existsSync(lockPath)).toBe(true)
  })

  it('is a no-op when there is no lock', () => {
    expect(releaseSessionLock(sessionLockPath(sessionFile), { pid: 111, hostname: HOST })).toBe(
      false
    )
  })
})

describe('isProcessAlive', () => {
  it('recognises this very process', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it('rejects impossible pids instead of throwing', () => {
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-1)).toBe(false)
    expect(isProcessAlive(Number.NaN)).toBe(false)
  })
})
