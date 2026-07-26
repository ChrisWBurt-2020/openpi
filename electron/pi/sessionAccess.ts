/**
 * sessionAccess.ts — one decision: how may we open this session file?
 *
 * Combines the two ADR-003 checks (format-version preflight, advisory owner
 * lock) into a single answer the sidecar can act on, because the interesting
 * question isn't "is the version ok" or "did we get the lock" separately — it's
 * "may we write to this file, and if not, what do we open instead?"
 *
 * The safe fallback is an auto-clone: copy the session to a scratch file and
 * open that. The user keeps their history and can keep working; the file
 * another process owns (or that we can't safely interpret) is never written.
 * "Clone to new session" is one of the four outcomes ADR-003 calls for, so
 * this is that outcome chosen automatically as the default, with the reason
 * reported so the UI can say what happened.
 *
 * Deliberately NOT chosen: silently opening read-write anyway (the old
 * behaviour — detects the conflict, then races anyway), or refusing to open at
 * all (turns a recoverable situation into a dead end). Both were worse.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  acquireSessionLock,
  type LockHolderState,
  type SessionLockAcquireResult,
} from './sessionLock'
import { preflightSessionFile, type SessionPreflightResult } from './sessionPreflight'

/**
 * 'read-write' — we own the requested file and may append to it.
 * 'cloned'     — unsafe to write, so we opened a scratch copy instead.
 * 'blocked'    — unsafe to write AND the clone failed. We open nothing.
 *
 * 'blocked' exists so that a clone failure can never silently degrade into
 * writing the file we just judged unsafe. A dead end the user can clear (close
 * the other window, free some disk) beats corrupting a session.
 */
export type SessionAccessMode = 'read-write' | 'cloned' | 'blocked'

export type SessionAccessReason =
  | 'version-newer'
  | 'unparseable-header'
  | 'lock-conflict'
  | 'clone-failed'

export interface SessionAccessDecision {
  mode: SessionAccessMode
  /** The file SessionManager should actually open. Null when mode is 'blocked'. */
  openPath: string | null
  /** The file the user asked for. Equal to openPath when mode is 'read-write'. */
  requestedPath: string
  reasons: SessionAccessReason[]
  /** Human-readable lines, safe to show the user verbatim. */
  messages: string[]
  preflight: SessionPreflightResult
  lock: SessionLockAcquireResult | null
}

export interface ResolveSessionAccessOptions {
  /** Pre-migration snapshots (older formats). Passed through to preflight. */
  backupDir?: string
  /** Where scratch clones live. Required for cloning to be possible. */
  cloneDir?: string
  now?: Date
  /** Injectable for tests. Defaults to the real advisory lock. */
  acquire?: typeof acquireSessionLock
}

/** Holder states that mean someone else may still be writing. */
const BLOCKING_HOLDER_STATES: ReadonlyArray<LockHolderState | 'unreadable'> = [
  'live',
  'stale',
  'foreign',
  'unreadable',
]

/**
 * Copy a session to a scratch file we can safely own.
 *
 * Uses copyFileSync rather than a rename/link so the original is untouched
 * even if the clone write fails partway.
 */
export function cloneSessionFile(
  requestedPath: string,
  cloneDir: string,
  now: Date = new Date()
): { ok: true; clonePath: string } | { ok: false; error: string } {
  try {
    fs.mkdirSync(cloneDir, { recursive: true })
    const stamp = now.toISOString().replace(/[:.]/g, '-')
    const base = path.basename(requestedPath, '.jsonl')
    const clonePath = path.join(cloneDir, `${base}.detached.${stamp}.jsonl`)
    fs.copyFileSync(requestedPath, clonePath)
    return { ok: true, clonePath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Default scratch location, alongside the backups dir from preflight. */
export function defaultCloneDir(agentDir: string): string {
  return path.join(agentDir, '.pi-workbench', 'detached')
}

export function resolveSessionAccess(
  requestedPath: string,
  options: ResolveSessionAccessOptions = {}
): SessionAccessDecision {
  const acquire = options.acquire ?? acquireSessionLock
  const messages: string[] = []
  const reasons: SessionAccessReason[] = []

  const preflight = preflightSessionFile(requestedPath, {
    backupDir: options.backupDir,
    now: options.now,
  })
  if (preflight.reason !== 'current') messages.push(preflight.message)

  if (preflight.decision === 'read-only') {
    reasons.push(preflight.reason === 'newer' ? 'version-newer' : 'unparseable-header')
  }

  // Only bother with the lock if the file is otherwise writable — taking a
  // lock on a file we've already decided not to write would be noise, and
  // would leave a lockfile behind for no reason.
  let lock: SessionLockAcquireResult | null = null
  if (reasons.length === 0) {
    lock = acquire(requestedPath, { app: 'openpi' })
    if (!lock.acquired && BLOCKING_HOLDER_STATES.includes(lock.holderState)) {
      reasons.push('lock-conflict')
      messages.push(lock.message)
    }
  }

  if (reasons.length === 0) {
    return {
      mode: 'read-write',
      openPath: requestedPath,
      requestedPath,
      reasons,
      messages,
      preflight,
      lock,
    }
  }

  // Unsafe to write the requested file. Fall back to a scratch clone.
  //
  // If the clone can't be made we return 'blocked' rather than opening the
  // original: we have already established that writing it risks another
  // process's data or a file we can't parse, and a failed workaround doesn't
  // make that risk go away.
  if (!options.cloneDir) {
    reasons.push('clone-failed')
    messages.push(
      'No scratch directory is configured, so this session cannot be opened as a detached copy. Not opening it read-write, because doing so risks the conflict described above.'
    )
    return { mode: 'blocked', openPath: null, requestedPath, reasons, messages, preflight, lock }
  }

  const clone = cloneSessionFile(requestedPath, options.cloneDir, options.now)
  if (!clone.ok) {
    reasons.push('clone-failed')
    messages.push(
      `Could not create a detached copy of this session (${clone.error}), so it was not opened. Opening it read-write would risk the conflict described above.`
    )
    return { mode: 'blocked', openPath: null, requestedPath, reasons, messages, preflight, lock }
  }

  // The clone is ours alone, so this lock should always succeed. Take it
  // anyway: it keeps the invariant "an open session always holds its lock".
  const cloneLock = acquire(clone.clonePath, { app: 'openpi' })
  messages.push(
    `Opened as a detached copy at ${clone.clonePath}. Changes here will not be written back to ${requestedPath}.`
  )

  return {
    mode: 'cloned',
    openPath: clone.clonePath,
    requestedPath,
    reasons,
    messages,
    preflight,
    lock: cloneLock,
  }
}
