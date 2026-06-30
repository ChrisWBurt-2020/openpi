import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findTaskIdForToolCall,
  MAX_TIME_DELTA_MS,
  readTaskSessionHistory,
  type TaskHistoryEntry,
} from '../electron/services/piTaskArtifacts'

describe('readTaskSessionHistory', () => {
  it('returns the parsed entries when the file exists', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openpi-history-'))
    const file = path.join(dir, '.pi', 'task-session-history.json')
    mkdirSync(path.dirname(file), { recursive: true })
    const entries: TaskHistoryEntry[] = [
      { id: 'mqzbadgj-3a1e', agentType: 'scout', description: 'Research A', startedAt: 1000 },
      { id: 'mqzbj13u-5803', agentType: 'planner', description: 'Research B', startedAt: 2000 },
    ]
    writeFileSync(file, JSON.stringify(entries))
    try {
      expect(readTaskSessionHistory(dir)).toEqual(entries)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns an empty array when the file is missing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openpi-history-'))
    try {
      expect(readTaskSessionHistory(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns an empty array when the file is malformed JSON', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openpi-history-'))
    const file = path.join(dir, '.pi', 'task-session-history.json')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, 'not json')
    try {
      expect(readTaskSessionHistory(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('drops entries without a string id', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'openpi-history-'))
    const file = path.join(dir, '.pi', 'task-session-history.json')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify([
        { id: 'mqzbadgj-3a1e', agentType: 'scout' },
        { id: 42, agentType: 'scout' }, // bad
        null, // bad
        'string', // bad
      ])
    )
    try {
      expect(readTaskSessionHistory(dir)).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('findTaskIdForToolCall', () => {
  const history: TaskHistoryEntry[] = [
    { id: 'mqzbadgj-3a1e', agentType: 'scout', description: 'Research A', startedAt: 1_000_000 },
    { id: 'mqzbj13u-5803', agentType: 'planner', description: 'Research B', startedAt: 2_000_000 },
    { id: 'mqzc232v-0698', agentType: 'scout', description: 'Research C', startedAt: 3_000_000 },
  ]

  it('returns null for empty history', () => {
    expect(findTaskIdForToolCall([], 'scout', 'Research A', 1_000_000)).toBeNull()
  })

  it('returns null when neither agentType nor description is provided', () => {
    expect(findTaskIdForToolCall(history, null, null, 1_000_000)).toBeNull()
  })

  it('matches by agentType only', () => {
    expect(findTaskIdForToolCall(history, 'scout', null, undefined)).toBe('mqzc232v-0698')
  })

  it('matches by description only', () => {
    expect(findTaskIdForToolCall(history, null, 'Research B', undefined)).toBe('mqzbj13u-5803')
  })

  it('matches by agentType + description', () => {
    expect(findTaskIdForToolCall(history, 'scout', 'Research A', 1_000_000)).toBe('mqzbadgj-3a1e')
  })

  it('picks the closest by startedAt when multiple entries match the agent', () => {
    // Tool started at 2_950_000 — between 2_000_000 (delta 950_000) and 3_000_000 (delta 50_000).
    expect(findTaskIdForToolCall(history, 'scout', null, 2_950_000)).toBe('mqzc232v-0698')
  })

  it('falls back to most recent matching entry when no candidate is within the time window', () => {
    // Tool started 1 hour after the latest entry — outside MAX_TIME_DELTA_MS.
    // Better to navigate to the most recent matching sub-session than to fail.
    expect(findTaskIdForToolCall(history, 'scout', null, 1_000_000 + 60 * 60 * 1000)).toBe(
      'mqzc232v-0698'
    )
  })

  it('treats the cap as the configured 5 minutes', () => {
    expect(MAX_TIME_DELTA_MS).toBe(5 * 60 * 1000)
  })

  it('returns null when no entries match the filter', () => {
    expect(findTaskIdForToolCall(history, 'reviewer', 'X', 1_000_000)).toBeNull()
  })

  it('skips entries with no startedAt when time is provided', () => {
    const sparse: TaskHistoryEntry[] = [
      { id: 'aaaaaaaa-bbbb', agentType: 'scout', description: 'X' }, // no startedAt
      { id: 'cccccccc-dddd', agentType: 'scout', description: 'X', startedAt: 1_000_000 },
    ]
    expect(findTaskIdForToolCall(sparse, 'scout', 'X', 1_000_000)).toBe('cccccccc-dddd')
  })
})
