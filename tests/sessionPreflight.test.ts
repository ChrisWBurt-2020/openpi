import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  backupSessionFile,
  classifySessionVersion,
  preflightSessionFile,
  readFirstLine,
  readSessionHeader,
  UNVERSIONED_SESSION_VERSION,
} from '../electron/pi/sessionPreflight'

/**
 * ADR-003 item 3. Terminal Pi (0.82.x) and the GUI share
 * ~/.pi/agent/sessions/*.jsonl and Pi migrates older formats IN PLACE on open.
 * The MUSTs being tested: never write to a file written by a newer Pi, and
 * always snapshot before an in-place migration.
 */

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-preflight-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function writeSession(name: string, header: unknown, extraLines: string[] = []): string {
  const file = path.join(tmp, name)
  const lines = [JSON.stringify(header), ...extraLines]
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf-8')
  return file
}

/** Fixed timestamp: header() is called twice in some tests and compared. */
const FIXED_TS = '2026-07-25T18:00:00.000Z'

function header(version?: number) {
  return {
    type: 'session',
    ...(version === undefined ? {} : { version }),
    id: 'sess-1',
    timestamp: FIXED_TS,
    cwd: 'C:\\repo',
  }
}

describe('readFirstLine', () => {
  it('reads only the first line of a multi-line file', () => {
    const file = writeSession('a.jsonl', header(3), ['{"type":"message"}', '{"type":"message"}'])
    expect(readFirstLine(file)).toBe(JSON.stringify(header(3)))
  })

  it('returns the whole content when the file has no newline', () => {
    const file = path.join(tmp, 'noeol.jsonl')
    fs.writeFileSync(file, 'abc', 'utf-8')
    expect(readFirstLine(file)).toBe('abc')
  })

  it('returns null when a single line exceeds the read window', () => {
    const file = path.join(tmp, 'huge.jsonl')
    fs.writeFileSync(file, 'x'.repeat(200), 'utf-8')
    // Window smaller than the file and no newline found: refuse to guess.
    expect(readFirstLine(file, 50)).toBeNull()
  })

  it('returns null for a nonexistent file', () => {
    expect(readFirstLine(path.join(tmp, 'nope.jsonl'))).toBeNull()
  })
})

describe('readSessionHeader', () => {
  it('reads an explicit version', () => {
    const result = readSessionHeader(writeSession('v3.jsonl', header(3)))
    expect(result).toMatchObject({ ok: true, version: 3 })
  })

  it('treats a missing version field as the pre-versioning format', () => {
    const result = readSessionHeader(writeSession('v0.jsonl', header()))
    expect(result).toMatchObject({ ok: true, version: UNVERSIONED_SESSION_VERSION })
  })
})

describe('readSessionHeader failure modes', () => {
  it('reports missing files', () => {
    expect(readSessionHeader(path.join(tmp, 'gone.jsonl'))).toMatchObject({
      ok: false,
      reason: 'missing',
    })
  })

  it('reports an empty file', () => {
    const file = path.join(tmp, 'empty.jsonl')
    fs.writeFileSync(file, '', 'utf-8')
    expect(readSessionHeader(file)).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('reports malformed JSON', () => {
    const file = path.join(tmp, 'bad.jsonl')
    fs.writeFileSync(file, '{not json\n', 'utf-8')
    expect(readSessionHeader(file)).toMatchObject({ ok: false, reason: 'malformed' })
  })

  it('rejects a first line that is valid JSON but not a session header', () => {
    const file = writeSession('wrong.jsonl', { type: 'message', id: 'x' })
    expect(readSessionHeader(file)).toMatchObject({ ok: false, reason: 'not-a-header' })
  })

  it('rejects a JSON scalar as the first line', () => {
    const file = path.join(tmp, 'scalar.jsonl')
    fs.writeFileSync(file, '42\n', 'utf-8')
    expect(readSessionHeader(file)).toMatchObject({ ok: false, reason: 'not-a-header' })
  })
})

describe('classifySessionVersion', () => {
  it('classifies relative to the bundled SDK version', () => {
    expect(classifySessionVersion(3, 3)).toBe('current')
    expect(classifySessionVersion(2, 3)).toBe('older')
    expect(classifySessionVersion(4, 3)).toBe('newer')
  })

  it('defaults to the SDK constant we actually ship', () => {
    expect(classifySessionVersion(CURRENT_SESSION_VERSION)).toBe('current')
    expect(classifySessionVersion(CURRENT_SESSION_VERSION + 1)).toBe('newer')
  })
})

describe('preflightSessionFile', () => {
  it('MUST refuse to write a session from a newer Pi', () => {
    const file = writeSession('newer.jsonl', header(CURRENT_SESSION_VERSION + 1))
    const result = preflightSessionFile(file, { backupDir: path.join(tmp, 'backups') })
    expect(result.decision).toBe('read-only')
    expect(result.reason).toBe('newer')
    expect(result.message).toContain('read-only')
  })

  it('opens a current-version session with no fuss and no backup', () => {
    const backupDir = path.join(tmp, 'backups')
    const file = writeSession('cur.jsonl', header(CURRENT_SESSION_VERSION))
    const result = preflightSessionFile(file, { backupDir })
    expect(result).toMatchObject({ decision: 'open', reason: 'current' })
    expect(fs.existsSync(backupDir)).toBe(false)
  })

  it('MUST snapshot an older session before in-place migration', () => {
    const backupDir = path.join(tmp, 'backups')
    const file = writeSession('old.jsonl', header(1), ['{"type":"message"}'])
    const original = fs.readFileSync(file, 'utf-8')

    const result = preflightSessionFile(file, { backupDir })

    expect(result).toMatchObject({ decision: 'open', reason: 'older-backed-up', version: 1 })
    expect(result.backupPath).toBeDefined()
    // The snapshot must be a byte-for-byte copy of the pre-migration file.
    expect(fs.readFileSync(result.backupPath as string, 'utf-8')).toBe(original)
  })

  it('still opens an older session when the snapshot fails, and says so', () => {
    const file = writeSession('old2.jsonl', header(1))
    // Point the backup dir at a path that cannot be created (a file, not a dir).
    const blocker = path.join(tmp, 'blocker')
    fs.writeFileSync(blocker, 'not a directory', 'utf-8')

    const result = preflightSessionFile(file, { backupDir: path.join(blocker, 'nested') })

    expect(result.decision).toBe('open')
    expect(result.reason).toBe('older-backup-failed')
  })

  it('skips the snapshot entirely when no backup dir is configured', () => {
    const file = writeSession('old3.jsonl', header(1))
    const result = preflightSessionFile(file)
    expect(result).toMatchObject({ decision: 'open', reason: 'older-backup-failed' })
    expect(result.backupPath).toBeUndefined()
  })

  it('opens read-only rather than appending to an unparseable session', () => {
    const file = path.join(tmp, 'corrupt.jsonl')
    fs.writeFileSync(file, '{"type":"session", truncated\n', 'utf-8')
    const result = preflightSessionFile(file)
    expect(result).toMatchObject({ decision: 'read-only', reason: 'unparseable' })
  })

  it('defers to Pi for a missing file instead of masking its error', () => {
    const result = preflightSessionFile(path.join(tmp, 'absent.jsonl'))
    expect(result).toMatchObject({ decision: 'open', reason: 'missing' })
  })

  it('treats an empty file as a fresh session', () => {
    const file = path.join(tmp, 'blank.jsonl')
    fs.writeFileSync(file, '', 'utf-8')
    expect(preflightSessionFile(file)).toMatchObject({ decision: 'open', reason: 'empty' })
  })
})

describe('backupSessionFile', () => {
  it('encodes version and timestamp so repeat migrations never collide', () => {
    const file = writeSession('s.jsonl', header(1))
    const backupDir = path.join(tmp, 'backups')
    const a = backupSessionFile(file, backupDir, 1, new Date('2026-07-25T18:00:00.000Z'))
    const b = backupSessionFile(file, backupDir, 1, new Date('2026-07-25T19:30:00.000Z'))

    expect(a.ok && b.ok).toBe(true)
    const paths = fs.readdirSync(backupDir)
    expect(paths).toHaveLength(2)
    expect(paths.every((p) => p.includes('.v1.'))).toBe(true)
    // No colons: Windows rejects them in filenames.
    expect(paths.every((p) => !p.includes(':'))).toBe(true)
  })
})
