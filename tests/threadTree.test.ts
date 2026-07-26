import { describe, expect, it } from 'vitest'
import type { SessionListItem, WorkspaceInfo } from '../src/lib/ipc'
import { buildThreadTree, threadLabel } from '../src/lib/threadTree'

/**
 * The sidebar exists because threads were unnavigable: creating one replaced
 * the current one and there was no way back. Grouping rules are tested here so
 * the ordering is a decision, not an accident of Map iteration.
 */

function thread(over: Partial<SessionListItem> & { path: string }): SessionListItem {
  return {
    id: over.path,
    cwd: 'C:\\repo',
    workspacePath: 'C:\\repo',
    workspaceName: 'repo',
    title: '',
    createdAt: '2026-07-25T10:00:00.000Z',
    updatedAt: '2026-07-25T10:00:00.000Z',
    messageCount: 1,
    firstMessage: '',
    parentSessionPath: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    entryCount: 1,
    branchCount: 0,
    lastModel: '',
    active: false,
    ...over,
  } as SessionListItem
}

function workspace(path: string, displayName: string): WorkspaceInfo {
  return { path, displayName, lastOpenedAt: null, sessionCount: 0 } as WorkspaceInfo
}

describe('grouping chats under projects', () => {
  it('groups by workspace and sorts chats newest first', () => {
    const tree = buildThreadTree(
      [
        thread({ path: 'a', updatedAt: '2026-07-25T09:00:00.000Z' }),
        thread({ path: 'b', updatedAt: '2026-07-25T11:00:00.000Z' }),
      ],
      [workspace('C:\\repo', 'repo')],
      null
    )

    expect(tree).toHaveLength(1)
    expect(tree[0]?.threads.map((t) => t.path)).toEqual(['b', 'a'])
  })

  it('shows a project that has no chats yet', () => {
    // Opening a folder must visibly do something even before the first chat.
    const tree = buildThreadTree([], [workspace('C:\\fresh', 'fresh')], null)
    expect(tree.map((g) => g.displayName)).toEqual(['fresh'])
    expect(tree[0]?.threads).toEqual([])
  })

  it('MUST NOT drop a chat whose workspace is missing from the index', () => {
    // Worktrees, or the index still catching up. Dropping it would hide the
    // user's conversation entirely.
    const tree = buildThreadTree(
      [thread({ path: 'a', workspacePath: 'C:\\other', workspaceName: 'other' })],
      [],
      null
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]?.displayName).toBe('other')
    expect(tree[0]?.threads.map((t) => t.path)).toEqual(['a'])
  })
})

describe('project ordering', () => {
  it('puts the project holding the open chat first', () => {
    const tree = buildThreadTree(
      [
        thread({ path: 'old', workspacePath: 'C:\\a', workspaceName: 'a' }),
        thread({
          path: 'active',
          workspacePath: 'C:\\b',
          workspaceName: 'b',
          // Deliberately older, so only the active flag can float it up.
          updatedAt: '2020-01-01T00:00:00.000Z',
        }),
      ],
      [workspace('C:\\a', 'a'), workspace('C:\\b', 'b')],
      'active'
    )

    expect(tree[0]?.displayName).toBe('b')
    expect(tree[0]?.containsActive).toBe(true)
  })

  it('otherwise orders by most recent chat, with empty projects last', () => {
    const tree = buildThreadTree(
      [
        thread({ path: 'a1', workspacePath: 'C:\\a', updatedAt: '2026-07-20T00:00:00.000Z' }),
        thread({ path: 'b1', workspacePath: 'C:\\b', updatedAt: '2026-07-25T00:00:00.000Z' }),
      ],
      [workspace('C:\\a', 'a'), workspace('C:\\b', 'b'), workspace('C:\\empty', 'empty')],
      null
    )

    expect(tree.map((g) => g.displayName)).toEqual(['b', 'a', 'empty'])
  })
})

describe('thread labels', () => {
  it('prefers the title, falls back to the first message, then a placeholder', () => {
    expect(threadLabel(thread({ path: 'a', title: 'Named' }))).toBe('Named')
    expect(threadLabel(thread({ path: 'a', firstMessage: 'hello there' }))).toBe('hello there')
    expect(threadLabel(thread({ path: 'a' }))).toBe('Untitled chat')
  })

  it('truncates a long first message rather than letting it overflow the rail', () => {
    const label = threadLabel(thread({ path: 'a', firstMessage: 'x'.repeat(200) }))
    expect(label.length).toBeLessThanOrEqual(60)
    expect(label.endsWith('…')).toBe(true)
  })
})
