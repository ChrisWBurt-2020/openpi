/**
 * sessionLock.ts — advisory owner lock for session files (ADR-003 item 1).
 *
 * Terminal Pi and the GUI both append to `~/.pi/agent/sessions/*.jsonl`, and
 * upstream Pi documents no multi-writer locking. Two live writers can
 * interleave appends and corrupt the tree.
 *
 * This is *advisory*: terminal Pi does not know about these lockfiles and will
 * happily write anyway. What this buys us is that OpenPi can detect a likely
 * second writer and tell the user, instead of silently racing. Calling it a
 * security or correctness guarantee would be a lie — see ADR-005 on naming the
 * boundary a mechanism actually enforces.
 *
 * Mechanism: `<session>.lock` written with O_EXCL (atomic create-if-absent),
 * containing {pid, app, hostname, ts}. Heartbeat refreshes ts so a crashed
 * holder's lock ages out instead of wedging the session forever.
 */

import fs from 'node:fs'
import os from 'node:os'

export interface SessionLockInfo {
  pid: number
  app: string
  hostname: string
  /** Epoch ms of the last heartbeat. */
  ts: number
}

/** A lock older than this with no heartbeat is treated as abandoned. */
export const DEFAULT_STALE_MS = 5 * 60 * 1000

/**
 * What we can say about the process named in an existing lockfile.
 *
 * 'live'    — same host, pid is running, heartbeat is fresh. A real conflict.
 * 'stale'   — same host, pid is running, but the heartbeat aged out. Probably
 *             a hung or suspended holder; the user decides.
 * 'dead'    — same host, no such pid. Safe to take over.
 * 'foreign' — different host (network-mounted home dir). We cannot check
 *             liveness at all, so we never auto-take-over.
 */
export type LockHolderState = 'live' | 'stale' | 'dead' | 'foreign'

export type SessionLockAcquireResult =
  | { acquired: true; lockPath: string; info: SessionLockInfo; tookOverFrom?: SessionLockInfo }
  | {
      acquired: false
      lockPath: string
      holder: SessionLockInfo | null
      holderState: LockHolderState | 'unreadable'
      message: string
    }

export function sessionLockPath(sessionFile: string): string {
  return `${sessionFile}.lock`
}

/** Signal-0 liveness probe. Throws EPERM when the pid exists but is another user's. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function readLockFile(lockPath: string): SessionLockInfo | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as Record<string, unknown>
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.app !== 'string' ||
      typeof parsed.hostname !== 'string' ||
      typeof parsed.ts !== 'number'
    ) {
      return null
    }
    return parsed as unknown as SessionLockInfo
  } catch {
    return null
  }
}

export function classifyLockHolder(
  holder: SessionLockInfo,
  opts: {
    now?: number
    staleMs?: number
    hostname?: string
    isAlive?: (pid: number) => boolean
  } = {}
): LockHolderState {
  const now = opts.now ?? Date.now()
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS
  const hostname = opts.hostname ?? os.hostname()
  const isAlive = opts.isAlive ?? isProcessAlive

  if (holder.hostname !== hostname) return 'foreign'
  if (!isAlive(holder.pid)) return 'dead'
  return now - holder.ts > staleMs ? 'stale' : 'live'
}

export interface AcquireSessionLockOptions {
  app?: string
  pid?: number
  hostname?: string
  now?: number
  staleMs?: number
  isAlive?: (pid: number) => boolean
  /**
   * Take over a lock whose holder is provably gone ('dead') or whose heartbeat
   * aged out ('stale'). Defaults to dead-only: a stale-but-running holder is a
   * user decision, not ours. Never applies to 'foreign' holders.
   */
  takeOver?: LockHolderState[]
}

function writeLockFileExclusive(lockPath: string, info: SessionLockInfo): boolean {
  try {
    // 'wx' = O_CREAT | O_EXCL — atomic, so two racing sidecars cannot both win.
    fs.writeFileSync(lockPath, JSON.stringify(info), { flag: 'wx', encoding: 'utf-8' })
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  }
}

export function acquireSessionLock(
  sessionFile: string,
  options: AcquireSessionLockOptions = {}
): SessionLockAcquireResult {
  const lockPath = sessionLockPath(sessionFile)
  const info: SessionLockInfo = {
    pid: options.pid ?? process.pid,
    app: options.app ?? 'openpi',
    hostname: options.hostname ?? os.hostname(),
    ts: options.now ?? Date.now(),
  }
  const takeOver = options.takeOver ?? ['dead']

  if (writeLockFileExclusive(lockPath, info)) {
    return { acquired: true, lockPath, info }
  }

  // Someone holds it. Decide whether that someone still exists.
  const holder = readLockFile(lockPath)
  if (!holder) {
    // Unreadable/corrupt lockfile. Treat as held rather than clobbering it:
    // a truncated lock is more likely a live writer mid-write than garbage.
    return {
      acquired: false,
      lockPath,
      holder: null,
      holderState: 'unreadable',
      message: `A lock file exists at ${lockPath} but could not be parsed. Not taking it over automatically.`,
    }
  }

  // Our own pid already owns it (e.g. reopening the same session): refresh.
  if (holder.pid === info.pid && holder.hostname === info.hostname) {
    fs.writeFileSync(lockPath, JSON.stringify(info), 'utf-8')
    return { acquired: true, lockPath, info }
  }

  const holderState = classifyLockHolder(holder, {
    now: options.now,
    staleMs: options.staleMs,
    hostname: info.hostname,
    isAlive: options.isAlive,
  })

  if (takeOver.includes(holderState)) {
    try {
      fs.unlinkSync(lockPath)
    } catch {
      /* raced with the holder releasing it; the exclusive create below decides */
    }
    if (writeLockFileExclusive(lockPath, info)) {
      return { acquired: true, lockPath, info, tookOverFrom: holder }
    }
    // Lost a race to another acquirer between unlink and create.
    return {
      acquired: false,
      lockPath,
      holder: readLockFile(lockPath),
      holderState: 'live',
      message: 'Another process acquired this session lock first.',
    }
  }

  return {
    acquired: false,
    lockPath,
    holder,
    holderState,
    message: describeConflict(holder, holderState),
  }
}

export function describeConflict(holder: SessionLockInfo, state: LockHolderState): string {
  const who = `${holder.app} (pid ${holder.pid}) on ${holder.hostname}`
  switch (state) {
    case 'live':
      return `This session is open in ${who}. Open it read-only, clone it to a new session, or close the other window.`
    case 'stale':
      return `${who} still holds this session but has not checked in recently. It may be hung — take over only if you are sure it is not writing.`
    case 'foreign':
      return `This session is locked by ${who}. That is a different machine, so its liveness cannot be checked from here.`
    case 'dead':
      return `${who} left a lock behind but is no longer running.`
  }
}

/** Heartbeat. Only refreshes a lock we still own; returns false if someone took it. */
export function refreshSessionLock(
  lockPath: string,
  options: { pid?: number; hostname?: string; now?: number } = {}
): boolean {
  const pid = options.pid ?? process.pid
  const hostname = options.hostname ?? os.hostname()
  const holder = readLockFile(lockPath)
  if (!holder || holder.pid !== pid || holder.hostname !== hostname) return false
  try {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ ...holder, ts: options.now ?? Date.now() }),
      'utf-8'
    )
    return true
  } catch {
    return false
  }
}

/** Release a lock we own. Never removes someone else's. */
export function releaseSessionLock(
  lockPath: string,
  options: { pid?: number; hostname?: string } = {}
): boolean {
  const pid = options.pid ?? process.pid
  const hostname = options.hostname ?? os.hostname()
  const holder = readLockFile(lockPath)
  if (!holder || holder.pid !== pid || holder.hostname !== hostname) return false
  try {
    fs.unlinkSync(lockPath)
    return true
  } catch {
    return false
  }
}
