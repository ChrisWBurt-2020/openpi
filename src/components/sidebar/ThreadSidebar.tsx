import { Bird, PanelLeftClose, Plus, Search, X } from 'lucide-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { CompanionViews } from '../../lib/companionView'
import type { ConnectionStatus, SessionListItem, WorkspaceInfo } from '../../lib/ipc'
import { sidebarProjects } from '../../lib/sidebarView'
import { buildThreadTree } from '../../lib/threadTree'
import { Project } from './Project'

const EXPANDED_KEY = 'openpi.navigator.v1.expanded'

interface ThreadSidebarProps {
  sessions: SessionListItem[]
  workspaces: WorkspaceInfo[]
  activeSessionPath: string | null
  runningSessionPaths: ReadonlySet<string>
  connectionStates: Record<string, ConnectionStatus>
  width: number
  onSelectSession: (path: string) => void
  onNewSession: () => void
  onSelectWorkspace: (path: string) => void
  onOpenWorkspace: () => void
  onCollapse: () => void
  companions: CompanionViews
  onShowSiege: () => void
}

function savedExpanded(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}')
    return booleanRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function booleanRecord(value: unknown): value is Record<string, boolean> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === 'boolean')
  )
}

export function ThreadSidebar(props: ThreadSidebarProps) {
  const [query, setQuery] = createSignal('')
  const [expanded, setExpanded] = createSignal(savedExpanded())
  const tree = createMemo(() =>
    buildThreadTree(props.sessions, props.workspaces, props.activeSessionPath)
  )
  const projects = createMemo(() =>
    sidebarProjects(tree(), props.companions, props.connectionStates, query())
  )
  const isExpanded = (path: string, active: boolean) =>
    Boolean(query()) || active || expanded()[path] === true
  const toggle = (path: string, active: boolean) => {
    if (active || query()) return
    setExpanded((previous) => {
      const next = { ...previous, [path]: !previous[path] }
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(next))
      return next
    })
  }
  return (
    <nav
      class="thread-sidebar"
      style={{ width: `${props.width}px`, 'min-width': `${props.width}px` }}
      aria-label="Projects and chats"
    >
      <header class="navigator-header">
        <div class="navigator-heading">
          <span>Projects</span>
          <small>{projects().length}</small>
        </div>
        <div class="navigator-header-actions">
          <button type="button" class="navigator-add" onClick={props.onOpenWorkspace}>
            <Plus size={14} /> Add Project
          </button>
          <button
            type="button"
            class="thread-sidebar-icon-btn"
            title="Show Heron Siege"
            aria-label="Show Heron Siege"
            onClick={props.onShowSiege}
          >
            <Bird size={15} />
          </button>
          <button
            type="button"
            class="thread-sidebar-icon-btn"
            title="Hide sidebar"
            aria-label="Hide sidebar"
            onClick={props.onCollapse}
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
      </header>
      <label class="navigator-search">
        <Search size={14} aria-hidden="true" />
        <input
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search projects and chats"
          aria-label="Search projects and chats"
        />
        <Show when={query()}>
          <button type="button" aria-label="Clear project search" onClick={() => setQuery('')}>
            <X size={13} />
          </button>
        </Show>
      </label>
      <div class="thread-sidebar-body">
        <Show
          when={projects().length > 0}
          fallback={<p class="thread-sidebar-empty">No matching projects or chats.</p>}
        >
          <For each={projects()}>
            {(project) => (
              <Project
                project={project}
                expanded={isExpanded(project.path, project.containsActive)}
                activeSessionPath={props.activeSessionPath}
                runningSessionPaths={props.runningSessionPaths}
                onSelectProject={() => props.onSelectWorkspace(project.path)}
                onToggle={() => toggle(project.path, project.containsActive)}
                onSelectSession={props.onSelectSession}
                onNewSession={() => {
                  props.onSelectWorkspace(project.path)
                  props.onNewSession()
                }}
              />
            )}
          </For>
        </Show>
      </div>
    </nav>
  )
}
