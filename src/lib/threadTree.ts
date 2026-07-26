/**
 * threadTree.ts — group chats under the project they belong to.
 *
 * The app knows about workspaces and sessions as two flat lists. The sidebar
 * wants one tree: Projects, each holding its Chats, newest first.
 *
 * Kept pure and separate from the component so the ordering and grouping rules
 * can be tested without rendering anything.
 */

import type { ConnectionStatus, ProjectExecutionMode, SessionListItem, WorkspaceInfo } from './ipc'

export interface ProjectGroup {
  path: string
  displayName: string
  threads: SessionListItem[]
  /** True when this project holds the thread currently open. */
  containsActive: boolean
  location: WorkspaceInfo['location']
  connectionLabel: string | null
  connectionStatus: ConnectionStatus | null
  executionMode: ProjectExecutionMode | null
}

/** Newest first. Sessions carry ISO timestamps, which sort lexicographically. */
function byNewest(a: SessionListItem, b: SessionListItem): number {
  return b.updatedAt.localeCompare(a.updatedAt)
}

export function buildThreadTree(
  sessions: SessionListItem[],
  workspaces: WorkspaceInfo[],
  activeSessionPath: string | null
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>()

  // Seed from the workspace list so a project with no chats yet still appears
  // — otherwise opening a folder looks like nothing happened.
  for (const workspace of workspaces) {
    groups.set(workspace.path, {
      path: workspace.path,
      displayName: workspace.displayName,
      threads: [],
      containsActive: false,
      location: workspace.location,
      connectionLabel: workspace.connectionLabel ?? null,
      connectionStatus: workspace.connectionStatus ?? null,
      executionMode: workspace.executionMode ?? null,
    })
  }

  for (const session of sessions) {
    let group = groups.get(session.workspacePath)
    if (!group) {
      // A session whose workspace isn't in the list (index still catching up,
      // or a worktree). Better to show it under a derived heading than to drop
      // the user's conversation from the sidebar entirely.
      group = {
        path: session.workspacePath,
        displayName: session.workspaceName || session.workspacePath,
        threads: [],
        containsActive: false,
        location: undefined,
        connectionLabel: null,
        connectionStatus: null,
        executionMode: null,
      }
      groups.set(session.workspacePath, group)
    }
    group.threads.push(session)
    if (activeSessionPath && session.path === activeSessionPath) group.containsActive = true
  }

  for (const group of groups.values()) group.threads.sort(byNewest)

  return [...groups.values()].sort(sortProjects)
}

/**
 * The project holding the open thread sorts first — it's the one you're
 * working in. Everything else falls back to its most recent chat, so projects
 * you've touched lately stay near the top, and empty projects sink rather than
 * pushing active work down.
 */
function sortProjects(a: ProjectGroup, b: ProjectGroup): number {
  if (a.containsActive !== b.containsActive) return a.containsActive ? -1 : 1
  const aLatest = a.threads[0]?.updatedAt ?? ''
  const bLatest = b.threads[0]?.updatedAt ?? ''
  if (aLatest !== bLatest) return bLatest.localeCompare(aLatest)
  return a.displayName.localeCompare(b.displayName)
}

/** Label for a chat row. Sessions often have no title until they're named. */
export function threadLabel(thread: SessionListItem): string {
  const title = thread.title?.trim()
  if (title) return title
  const first = thread.firstMessage?.trim()
  if (first) return first.length > 60 ? `${first.slice(0, 57)}…` : first
  return 'Untitled chat'
}
