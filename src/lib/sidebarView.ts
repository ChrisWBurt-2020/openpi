import type { CompanionProjectView, CompanionViews } from './companionView'
import type { ConnectionStatus, SessionListItem } from './ipc'
import type { ProjectGroup } from './threadTree'

export interface SidebarProjectView extends ProjectGroup {
  companion: CompanionProjectView | undefined
  attentionLabel: string | null
}

export type ChatActivity = 'running' | 'review' | 'blocked' | 'error' | null

export function sidebarProjects(
  projects: ProjectGroup[],
  companions: CompanionViews,
  connectionStates: Record<string, ConnectionStatus>,
  query: string
): SidebarProjectView[] {
  const needle = query.trim().toLocaleLowerCase()
  return projects.flatMap((project) => {
    const connectionId = project.location?.kind === 'ssh' ? project.location.connectionId : null
    const connectionStatus = connectionId ? connectionStates[connectionId] : undefined
    const companion = Object.values(companions).find((view) => view.projectPath === project.path)
    const matchesProject = matches(needle, project.displayName)
    const threads =
      matchesProject || !needle
        ? project.threads
        : project.threads.filter((thread) => matchesThread(needle, thread))
    if (needle && !matchesProject && threads.length === 0) return []
    return [
      {
        ...project,
        connectionStatus: connectionStatus ?? project.connectionStatus,
        threads,
        companion,
        attentionLabel:
          companion?.attention && !companion.attention.acknowledged
            ? companion.attention.label
            : null,
      },
    ]
  })
}

export function chatActivity(
  thread: SessionListItem,
  project: SidebarProjectView,
  running: ReadonlySet<string>
): ChatActivity {
  if (running.has(thread.path)) return 'running'
  const state = project.companion?.state
  const supported = state?.kind === 'review' || state?.kind === 'blocked' || state?.kind === 'error'
  if (
    !supported ||
    !project.companion?.evidence.some((evidence) => evidence.threadId === thread.id)
  ) {
    return null
  }
  return state.kind
}

function matchesThread(query: string, thread: SessionListItem): boolean {
  return [thread.title, thread.firstMessage, thread.lastModel].some((value) =>
    matches(query, value)
  )
}

function matches(query: string, value: string): boolean {
  return value.toLocaleLowerCase().includes(query)
}
