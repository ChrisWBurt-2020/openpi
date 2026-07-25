/**
 * sessionPreflight.ts — read a session file's header before opening it.
 *
 * Terminal Pi and the GUI share `~/.pi/agent/sessions/*.jsonl`. Session files
 * carry a format version and Pi migrates old -> new *in place* on open. That
 * makes two situations dangerous:
 *
 *   - A file written by a NEWER Pi than the one we bundle. Our SDK does not
 *     know those entry shapes; opening read-write risks writing a downgraded
 *     or lossy file over the user's history.
 *   - A file written by an OLDER Pi. Opening it is fine and expected, but the
 *     migration is destructive-in-place, so we snapshot first.
 *
 * This module is deliberately pure-ish and fs-light: it reads only the first
 * line of the file (headers are line 1 of the JSONL) and returns a decision.
 * The caller decides what to do with it. That keeps it unit-testable without
 * constructing real sessions.
 */

import fs from 'node:fs'
import path from 'node:path'
import { CURRENT_SESSION_VERSION, type SessionHeader } from '@earendil-works/pi-coding-agent'

/**
 * Sessions written before versioning was introduced have no `version` field.
 * SessionHeader types it optional; Pi treats absent as the original format.
 */
export const UNVERSIONED_SESSION_VERSION = 1

/** How much of the file to read while looking for the first newline. */
const HEADER_READ_BYTES = 64 * 1024

export type SessionHeaderReadFailure = 'missing' | 'empty' | 'malformed' | 'not-a-header'

export type SessionHeaderReadResult =
  | { ok: true; header: SessionHeader; version: number }
  | { ok: false; reason: SessionHeaderReadFailure; detail?: string }

/**
 * Read the first line of a file without slurping the whole thing. Session
 * files routinely reach tens of MB; we only ever need line 1.
 *
 * Returns null when the file cannot be opened. Returns '' for an empty file.
 * A file whose first line exceeds HEADER_READ_BYTES is treated as malformed
 * by the caller — a real header is a few hundred bytes.
 */
export function readFirstLine(filePath: string, maxBytes = HEADER_READ_BYTES): string | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(maxBytes)
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0)
    const chunk = buf.subarray(0, bytesRead).toString('utf-8')
    const newlineIdx = chunk.indexOf('\n')
    // No newline within the window: only trustworthy if we read the whole file.
    if (newlineIdx === -1) return bytesRead < maxBytes ? chunk : null
    return chunk.slice(0, newlineIdx)
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        /* already closed */
      }
    }
  }
}

export function readSessionHeader(filePath: string): SessionHeaderReadResult {
  if (!fs.existsSync(filePath)) return { ok: false, reason: 'missing' }

  const line = readFirstLine(filePath)
  if (line === null)
    return { ok: false, reason: 'malformed', detail: 'unreadable or no line break' }
  if (line.trim() === '') return { ok: false, reason: 'empty' }

  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (err) {
    return {
      ok: false,
      reason: 'malformed',
      detail: err instanceof Error ? err.message : String(err),
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'not-a-header', detail: 'first line is not an object' }
  }
  const record = parsed as Record<string, unknown>
  if (record.type !== 'session') {
    return {
      ok: false,
      reason: 'not-a-header',
      detail: `first entry type is ${String(record.type)}`,
    }
  }

  // `version` is optional in SessionHeader: absent means pre-versioning.
  const rawVersion = record.version
  const version =
    typeof rawVersion === 'number' && Number.isFinite(rawVersion)
      ? rawVersion
      : UNVERSIONED_SESSION_VERSION

  return { ok: true, header: parsed as SessionHeader, version }
}

export type SessionVersionClass = 'current' | 'older' | 'newer'

export function classifySessionVersion(
  fileVersion: number,
  supportedVersion: number = CURRENT_SESSION_VERSION
): SessionVersionClass {
  if (fileVersion > supportedVersion) return 'newer'
  if (fileVersion < supportedVersion) return 'older'
  return 'current'
}

/**
 * Snapshot a session file before Pi's in-place migration touches it.
 * Best-effort by design: a failed backup must not block the user from opening
 * their own session, so the caller gets the error and decides. Returns the
 * backup path on success.
 */
export function backupSessionFile(
  filePath: string,
  backupDir: string,
  version: number,
  now: Date = new Date()
): { ok: true; backupPath: string } | { ok: false; error: string } {
  try {
    fs.mkdirSync(backupDir, { recursive: true })
    const stamp = now.toISOString().replace(/[:.]/g, '-')
    const base = path.basename(filePath, '.jsonl')
    const backupPath = path.join(backupDir, `${base}.v${version}.${stamp}.jsonl`)
    fs.copyFileSync(filePath, backupPath)
    return { ok: true, backupPath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Default backup location: alongside the sessions they protect, not in the repo. */
export function defaultBackupDir(agentDir: string): string {
  return path.join(agentDir, '.pi-workbench', 'backups')
}

export interface SessionPreflightResult {
  /**
   * 'open'      — safe to open read-write.
   * 'read-only' — open without writing; caller should offer "clone to new session".
   */
  decision: 'open' | 'read-only'
  /** Machine-readable cause, for UI copy and telemetry. */
  reason:
    | 'current'
    | 'older-backed-up'
    | 'older-backup-failed'
    | 'newer'
    | 'missing'
    | 'empty'
    | 'unparseable'
  /** Resolved file format version, when the header could be read. */
  version?: number
  supportedVersion: number
  backupPath?: string
  /** Human-readable explanation, safe to surface directly in the UI. */
  message: string
}

export interface SessionPreflightOptions {
  /** Where to put pre-migration snapshots. Omit to skip backups entirely. */
  backupDir?: string
  supportedVersion?: number
  now?: Date
}

/**
 * Decide how a session file may be opened.
 *
 * Judgment call worth knowing about: an unparseable header resolves to
 * 'read-only'. We cannot reason about a file we cannot parse, and appending to
 * a corrupt session compounds the corruption. The cost is that a genuinely
 * novel-but-valid header would be treated as untouchable until this code
 * learns about it — an inconvenience, versus data loss on the other side.
 */
export function preflightSessionFile(
  filePath: string,
  options: SessionPreflightOptions = {}
): SessionPreflightResult {
  const supportedVersion = options.supportedVersion ?? CURRENT_SESSION_VERSION
  const read = readSessionHeader(filePath)

  if (!read.ok) {
    if (read.reason === 'missing') {
      return {
        decision: 'open',
        reason: 'missing',
        supportedVersion,
        message: 'Session file not found; letting Pi report the error.',
      }
    }
    if (read.reason === 'empty') {
      return {
        decision: 'open',
        reason: 'empty',
        supportedVersion,
        message: 'Session file is empty; opening as a fresh session.',
      }
    }
    return {
      decision: 'read-only',
      reason: 'unparseable',
      supportedVersion,
      message:
        `Could not read this session's header (${read.reason}` +
        `${read.detail ? `: ${read.detail}` : ''}). ` +
        'Opening read-only so nothing is written over a file we cannot interpret.',
    }
  }

  const { version } = read
  const versionClass = classifySessionVersion(version, supportedVersion)

  if (versionClass === 'newer') {
    return {
      decision: 'read-only',
      reason: 'newer',
      version,
      supportedVersion,
      message:
        `This session was written by a newer Pi (session format v${version}; ` +
        `this build understands v${supportedVersion}). Opening read-only — ` +
        'clone it to a new session to continue here, or reopen it in the newer Pi.',
    }
  }

  if (versionClass === 'older') {
    if (!options.backupDir) {
      return {
        decision: 'open',
        reason: 'older-backup-failed',
        version,
        supportedVersion,
        message: `Session format v${version} will be migrated to v${supportedVersion}. No backup directory configured, so no snapshot was taken.`,
      }
    }
    const backup = backupSessionFile(filePath, options.backupDir, version, options.now)
    if (!backup.ok) {
      return {
        decision: 'open',
        reason: 'older-backup-failed',
        version,
        supportedVersion,
        message:
          `Session format v${version} will be migrated to v${supportedVersion}, ` +
          `but the pre-migration snapshot failed: ${backup.error}`,
      }
    }
    return {
      decision: 'open',
      reason: 'older-backed-up',
      version,
      supportedVersion,
      backupPath: backup.backupPath,
      message: `Session format v${version} will be migrated to v${supportedVersion}. Snapshot saved to ${backup.backupPath}.`,
    }
  }

  return {
    decision: 'open',
    reason: 'current',
    version,
    supportedVersion,
    message: `Session format v${version} matches this build.`,
  }
}
