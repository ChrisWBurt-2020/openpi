import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  MessageSquarePlus,
  PanelLeftClose,
} from 'lucide-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { SessionListItem, WorkspaceInfo } from '../../lib/ipc'
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
  onSelectSession: (path: string) => void
  onNewSession: () => void
  onSelectWorkspace: (path: string) => void
  onOpenWorkspace: () => void
  onCollapse: () => void
}

export function ThreadSidebar(props: ThreadSidebarProps) {
  // Collapsed projects, by path. Default is expanded: hiding a user's chats by
  // default is the failure mode this whole component exists to fix.
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})

  const tree = createMemo(() =>
    buildThreadTree(props.sessions, props.workspaces, props.activeSessionPath)
  )

  const toggle = (path: string) => setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))

  return (
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
                      onClick={() => toggle(project.path)}
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
                              onClick={() => props.onSelectSession(chat.path)}
                            >
                              {/* Inner span is the moving part: on hover it
                                  slides far enough to reveal whatever the
                                  ellipsis cut off, then eases back. */}
                              <span class="thread-sidebar-thread-label">
                                <span class="thread-sidebar-thread-text">{threadLabel(chat)}</span>
                              </span>
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
  )
}
