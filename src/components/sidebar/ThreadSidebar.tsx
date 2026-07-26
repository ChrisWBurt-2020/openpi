import {
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  FolderOpen,
  MessageSquarePlus,
  MessagesSquare,
  PanelLeftClose,
} from 'lucide-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { SessionListItem, WorkspaceInfo } from '../../lib/ipc'
import { formatRelativeTime } from '../../lib/sessionView'
import { buildThreadTree, threadLabel } from '../../lib/threadTree'

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

  const tree = createMemo(() =>
    buildThreadTree(props.sessions, props.workspaces, props.activeSessionPath)
  )

  const toggle = (path: string) => setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))

  return (
    <>
      <nav class="thread-sidebar" aria-label="Projects and chats">
        <div class="thread-sidebar-header">
          <span class="thread-sidebar-title">Projects</span>
          <div class="thread-sidebar-header-actions">
            <button
              type="button"
              class="thread-sidebar-icon-btn"
              title="Open a folder"
              aria-label="Open a folder"
              onClick={() => props.onOpenWorkspace()}
            >
              <FolderOpen size={14} />
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
                        <span class="thread-sidebar-project-name">{project.displayName}</span>
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
