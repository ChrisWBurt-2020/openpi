import { describe, expect, it } from 'vitest'
import type { CompanionProjectView } from '../src/lib/companionView'
import type { SessionListItem } from '../src/lib/ipc'
import { chatActivity, sidebarProjects } from '../src/lib/sidebarView'
import type { ProjectGroup } from '../src/lib/threadTree'

const at = '2026-07-27T00:00:00.000Z'

function thread(id: string, title = 'Review UI'): SessionListItem {
  return {
    id,
    path: `session-${id}`,
    cwd: 'C:/repo',
    workspacePath: 'C:/repo',
    workspaceName: 'repo',
    title,
    createdAt: at,
    updatedAt: at,
    messageCount: 1,
    firstMessage: title,
    parentSessionPath: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    entryCount: 1,
    branchCount: 0,
    lastModel: 'openai/gpt-5',
    active: false,
  }
}

function group(threads: SessionListItem[]): ProjectGroup {
  return {
    path: 'C:/repo',
    displayName: 'Heron workbench',
    threads,
    containsActive: false,
    location: undefined,
    connectionLabel: null,
    connectionStatus: null,
    executionMode: null,
  }
}

function companion(): CompanionProjectView {
  return {
    projectId: 'project_test',
    projectPath: 'C:/repo',
    revision: 1,
    profile: {
      projectId: 'project_test',
      projectPath: 'C:/repo',
      displayName: 'repo',
      revision: 0,
      appearance: {
        accentOverride: null,
        accessory: 'scarf',
        scale: 1,
        motion: 'full',
        visible: true,
        pinned: false,
        alwaysOnTop: true,
        placement: null,
        petPackId: 'builtin-graphic-heron',
      },
      modelRoles: {},
      reviewChecks: [],
      signalsMode: 'balanced',
      sentinelEnabled: false,
      memoryPolicy: 'propose',
      contextSources: ['session'],
      acknowledgedAttentionRevision: null,
      createdAt: at,
      updatedAt: at,
    },
    state: {
      kind: 'review',
      since: at,
      evidence: [
        {
          kind: 'review',
          id: 'review-1',
          label: 'Review',
          at,
          threadId: 'thread-1',
          uri: 'evidence://review/review-1/diff',
          available: true,
        },
      ],
    },
    attention: null,
    activity: { openLoop: null, actions: [], evidenceCount: 1 },
    sprite: {
      packId: 'builtin-graphic-heron',
      clipId: 'review',
      palette: { accent: '#fff', signal: '#fff', alert: '#fff' },
      accessory: 'scarf',
    },
    evidence: [
      {
        kind: 'review',
        id: 'review-1',
        label: 'Review',
        at,
        threadId: 'thread-1',
        uri: 'evidence://review/review-1/diff',
        available: true,
      },
    ],
    updatedAt: at,
  }
}

describe('sidebar project view', () => {
  it('filters projects by chat metadata without dropping matching project context', () => {
    const projects = sidebarProjects(
      [group([thread('thread-1', 'Review panel'), thread('thread-2', 'Other')])],
      {},
      {},
      'review'
    )
    expect(projects).toHaveLength(1)
    expect(projects[0]?.threads.map((item) => item.id)).toEqual(['thread-1'])
  })

  it('does not apply project review state to an unrelated chat', () => {
    const project = sidebarProjects(
      [group([thread('thread-1'), thread('thread-2')])],
      { project_test: companion() },
      {},
      ''
    )[0]
    expect(project).toBeDefined()
    if (!project) return
    expect(chatActivity(thread('thread-1'), project, new Set())).toBe('review')
    expect(chatActivity(thread('thread-2'), project, new Set())).toBeNull()
  })

  it('uses the live connection state over stale workspace state', () => {
    const remote = {
      ...group([]),
      location: { kind: 'ssh' as const, connectionId: 'connection-1', path: '/repo' },
      connectionStatus: 'disconnected' as const,
    }
    expect(
      sidebarProjects([remote], {}, { 'connection-1': 'connected' }, '')[0]?.connectionStatus
    ).toBe('connected')
  })
})
