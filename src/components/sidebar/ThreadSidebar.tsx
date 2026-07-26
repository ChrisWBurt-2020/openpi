import {
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  FolderOpen,
  Globe2,
  MessageSquarePlus,
  MessagesSquare,
  PanelLeftClose,
  Plus,
  Repeat2,
  Trash2,
} from 'lucide-solid'
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { ConnectionStatus, SessionListItem, WorkspaceInfo } from '../../lib/ipc'
import { formatRelativeTime } from '../../lib/sessionView'
import { buildThreadTree, threadLabel } from '../../lib/threadTree'
import { ProjectPicker } from '../ProjectPicker'

/**
 * ThreadSidebar — Projects and their Chats, always visible.
 *
 * Sessions used to live as tabs in the top bar plus a full-screen homescreen
 * overlay, which meant navigating between conversations hid the one you were
 * reading. A persistent rail keeps the whole set in view.
 */

interface ThreadSidebarProps {
  sessions: SessionListItem[]
  workspaces: WorkspaceInfo[]
  activeSessionPath: string | null
  runningSessionPaths: ReadonlySet<string>
  onSelectSession: (path: string) => void
  onNewSession: () => void
  onSelectWorkspace: (path: string) => void
  onOpenWorkspace: () => void
  onCollapse: () => void
}

interface HoverCard {
  chat: SessionListItem
  projectName: string
  top: number
  left: number
}

export function ThreadSidebar(props: ThreadSidebarProps) {
  // Collapsed projects, by path. Default is expanded: hiding a user's chats by
  // default is the failure mode this whole component exists to fix.
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})
  const [hoverCard, setHoverCard] = createSignal<HoverCard | null>(null)
  const [projectPickerOpen, setProjectPickerOpen] = createSignal(false)
  const [connectionStates, setConnectionStates] = createSignal<Record<string, ConnectionStatus>>({})

  onMount(() => {
    const unsubscribe = window.openpi.connections.onStatus((state) => {
      setConnectionStates((previous) => ({ ...previous, [state.connectionId]: state.status }))
    })
    onCleanup(unsubscribe)
  })

  const tree = createMemo(() => {
    const workspaces = props.workspaces.map((workspace) => {
      if (workspace.location?.kind !== 'ssh') return workspace
      const status = connectionStates()[workspace.location.connectionId]
      return status ? { ...workspace, connectionStatus: status } : workspace
    })
    return buildThreadTree(props.sessions, workspaces, props.activeSessionPath)
  })

  const toggle = (path: string) => setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))

  return (
    <>
      <nav class="thread-sidebar" aria-label="Projects and chats">
        <div class="thread-sidebar-header">
          <span class="thread-sidebar-title">Projects</span>
          <div class="thread-sidebar-header-actions">
            <button
              type="button"
              class="thread-sidebar-add-btn"
              title="Add a local or remote project"
              onClick={() => setProjectPickerOpen(true)}
            >
              <Plus size={14} /> Add Project
            </button>
            <button
              type="button"
              class="thread-sidebar-icon-btn"
              title="Hide sidebar"
              aria-label="Hide sidebar"
              onClick={() => props.onCollapse()}
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
        </div>

        <div class="thread-sidebar-body">
          <Show
            when={tree().length > 0}
            fallback={
              <p class="thread-sidebar-empty">No projects yet. Open a folder to start a chat.</p>
            }
          >
            <For each={tree()}>
              {(project) => {
                const isCollapsed = () => collapsed()[project.path] === true
                return (
                  <section class="thread-sidebar-project">
                    <div class="thread-sidebar-project-row">
                      <button
                        type="button"
                        class="thread-sidebar-project-btn"
                        aria-expanded={!isCollapsed()}
                        title={project.path}
                        onClick={() => {
                          props.onSelectWorkspace(project.path)
                          toggle(project.path)
                        }}
                      >
                        {isCollapsed() ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                        <Show when={project.location?.kind === 'ssh'}>
                          <Globe2 size={13} class="thread-sidebar-project-remote" />
                        </Show>
                        <span class="thread-sidebar-project-name">{project.displayName}</span>
                        <Show when={project.connectionLabel}>
                          <span class="thread-sidebar-project-connection">
                            {project.executionMode === 'ssh-workspace'
                              ? 'Local models'
                              : 'Remote runner'}{' '}
                            · {project.connectionLabel}
                          </span>
                        </Show>
                        <Show when={project.connectionStatus}>
                          {(status) => (
                            <span
                              class={`connection-status-dot is-${status()}`}
                              title={`SSH ${status()}`}
                            />
                          )}
                        </Show>
                        <span class="thread-sidebar-count">{project.threads.length}</span>
                      </button>
                      <button
                        type="button"
                        class="thread-sidebar-icon-btn"
                        title={`New chat in ${project.displayName}`}
                        aria-label={`New chat in ${project.displayName}`}
                        onClick={() => {
                          // Point the app at this project before starting the
                          // chat, so "new chat" lands where it was clicked.
                          props.onSelectWorkspace(project.path)
                          props.onNewSession()
                        }}
                      >
                        <MessageSquarePlus size={14} />
                      </button>
                      <Show when={project.location?.kind === 'ssh'}>
                        <button
                          type="button"
                          class="thread-sidebar-icon-btn"
                          title={
                            project.executionMode === 'ssh-workspace'
                              ? 'Use Persistent Remote Runner for new chats'
                              : 'Use SSH Workspace with local models for new chats'
                          }
                          aria-label="Change remote project execution mode"
                          onClick={() => {
                            const executionMode =
                              project.executionMode === 'ssh-workspace'
                                ? 'persistent-runner'
                                : 'ssh-workspace'
                            void window.openpi.remote.setProjectMode(project.path, executionMode)
                          }}
                        >
                          <Repeat2 size={13} />
                        </button>
                        <button
                          type="button"
                          class="thread-sidebar-icon-btn"
                          title={`Remove ${project.displayName} from OpenPi`}
                          aria-label={`Remove ${project.displayName} from OpenPi`}
                          onClick={() => {
                            const approved = window.confirm(
                              `Remove ${project.displayName} from OpenPi?\n\nThis only removes the local project entry. Files and sessions on the remote host are untouched.`
                            )
                            if (approved) void window.openpi.remote.removeProject(project.path)
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </Show>
                    </div>

                    <Show when={!isCollapsed()}>
                      <ul class="thread-sidebar-threads">
                        <For each={project.threads}>
                          {(chat) => (
                            <li>
                              <button
                                type="button"
                                class={`thread-sidebar-thread${
                                  chat.path === props.activeSessionPath ? ' is-active' : ''
                                }`}
                                aria-current={
                                  chat.path === props.activeSessionPath ? 'true' : undefined
                                }
                                title={threadLabel(chat)}
                                onMouseEnter={(event) => {
                                  const rect = event.currentTarget.getBoundingClientRect()
                                  setHoverCard({
                                    chat,
                                    projectName: project.displayName,
                                    top: Math.min(rect.top, window.innerHeight - 190),
                                    left: Math.min(rect.right + 8, window.innerWidth - 372),
                                  })
                                }}
                                onMouseLeave={() => setHoverCard(null)}
                                onFocus={(event) => {
                                  const rect = event.currentTarget.getBoundingClientRect()
                                  setHoverCard({
                                    chat,
                                    projectName: project.displayName,
                                    top: Math.min(rect.top, window.innerHeight - 190),
                                    left: Math.min(rect.right + 8, window.innerWidth - 372),
                                  })
                                }}
                                onBlur={() => setHoverCard(null)}
                                onClick={() => props.onSelectSession(chat.path)}
                              >
                                {/* Inner span is the moving part: on hover it
                                  slides far enough to reveal whatever the
                                  ellipsis cut off, then eases back. */}
                                <span class="thread-sidebar-thread-label">
                                  <span class="thread-sidebar-thread-text">
                                    {threadLabel(chat)}
                                  </span>
                                </span>
                                <Show when={props.runningSessionPaths.has(chat.path)}>
                                  <span class="thread-sidebar-running" title="Chat is running" />
                                </Show>
                              </button>
                            </li>
                          )}
                        </For>
                        <Show when={project.threads.length === 0}>
                          <li class="thread-sidebar-no-threads">No chats yet</li>
                        </Show>
                      </ul>
                    </Show>
                  </section>
                )
              }}
            </For>
          </Show>
        </div>
      </nav>
      <ProjectPicker
        open={projectPickerOpen()}
        onClose={() => setProjectPickerOpen(false)}
        onOpenLocal={async () => props.onOpenWorkspace()}
        onProjectAdded={async () => undefined}
      />
      <Portal>
        <Show when={hoverCard()}>
          {(card) => (
            <aside
              class="thread-hover-card"
              style={{ top: `${card().top}px`, left: `${card().left}px` }}
              aria-hidden="true"
            >
              <div class="thread-hover-card-header">
                <strong>{threadLabel(card().chat)}</strong>
                <span>{formatRelativeTime(card().chat.updatedAt)}</span>
              </div>
              <div class="thread-hover-card-row">
                <FolderOpen size={15} />
                <span>{card().projectName}</span>
              </div>
              <div class="thread-hover-card-row">
                <Bot size={15} />
                <span>{card().chat.lastModel || 'Model not recorded'}</span>
              </div>
              <div class="thread-hover-card-row">
                <MessagesSquare size={15} />
                <span>{card().chat.messageCount} messages</span>
              </div>
              <div class="thread-hover-card-row">
                <Clock3 size={15} />
                <span>Updated {formatRelativeTime(card().chat.updatedAt)}</span>
              </div>
            </aside>
          )}
        </Show>
      </Portal>
    </>
  )
}
