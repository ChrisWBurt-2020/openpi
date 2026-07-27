import {
  ChevronDown,
  ChevronRight,
  Globe2,
  MessageSquarePlus,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-solid'
import { For, Show } from 'solid-js'
import type { SessionListItem } from '../../lib/ipc'
import type { SidebarProjectView } from '../../lib/sidebarView'
import { chatActivity } from '../../lib/sidebarView'
import { HeronBadge } from '../companion/HeronBadge'
import { ChatRow } from './ChatRow'

interface Props {
  expanded: boolean
  project: SidebarProjectView
  activeSessionPath: string | null
  runningSessionPaths: ReadonlySet<string>
  onToggle: () => void
  onSelectProject: () => void
  onSelectSession: (path: string) => void
  onNewSession: () => void
}

export function Project(props: Props) {
  const remote = () => props.project.location?.kind === 'ssh'
  const pinned = () => props.project.companion?.profile.appearance.pinned === true
  const secondary = () => {
    if (!remote()) return 'Local workspace'
    const mode =
      props.project.executionMode === 'persistent-runner' ? 'Remote runner' : 'Local models'
    return `${mode} · ${props.project.connectionLabel ?? 'SSH workspace'}`
  }
  const toggleMode = () => {
    const next =
      props.project.executionMode === 'ssh-workspace' ? 'persistent-runner' : 'ssh-workspace'
    void window.openpi.remote.setProjectMode(props.project.path, next)
  }
  const remove = () => {
    if (
      window.confirm(
        `Remove ${props.project.displayName} from OpenPi?\n\nFiles and sessions on the remote host are untouched.`
      )
    ) {
      void window.openpi.remote.removeProject(props.project.path)
    }
  }
  return (
    <section class={`navigator-project${props.project.containsActive ? ' is-active-project' : ''}`}>
      <div class="navigator-project-row">
        <button
          type="button"
          class="navigator-project-main"
          aria-expanded={props.expanded}
          title={props.project.path}
          onClick={() => {
            props.onSelectProject()
            props.onToggle()
          }}
        >
          <span class="navigator-chevron">
            {props.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <HeronBadge view={props.project.companion} />
          <span class="navigator-project-copy">
            <span class="navigator-project-title">
              <strong>{props.project.displayName}</strong>
              <small>{props.project.threads.length}</small>
            </span>
            <span class="navigator-project-subtitle">
              <Show when={remote()}>
                <Globe2 size={12} />
              </Show>
              <span>{secondary()}</span>
              <Show when={props.project.connectionStatus}>
                {(status) => (
                  <span class={`connection-status-dot is-${status()}`} title={`SSH ${status()}`} />
                )}
              </Show>
              <Show when={props.project.attentionLabel}>
                <span title={props.project.attentionLabel ?? undefined}>
                  <TriangleAlert size={12} class="navigator-attention" />
                </span>
              </Show>
            </span>
          </span>
        </button>
        <div
          class="navigator-project-actions"
          role="toolbar"
          aria-label={`${props.project.displayName} actions`}
        >
          <button
            type="button"
            title={`New chat in ${props.project.displayName}`}
            aria-label={`New chat in ${props.project.displayName}`}
            onClick={props.onNewSession}
          >
            <MessageSquarePlus size={14} />
          </button>
          <button
            type="button"
            title={pinned() ? 'Unpin Heron' : 'Pin Heron'}
            aria-label={pinned() ? 'Unpin Heron' : 'Pin Heron'}
            onClick={() => void window.openpi.companion.pin(props.project.path, !pinned())}
          >
            {pinned() ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <Show when={remote()}>
            <button
              type="button"
              title="Change remote execution mode"
              aria-label="Change remote execution mode"
              onClick={toggleMode}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              class="is-danger"
              title={`Remove ${props.project.displayName}`}
              aria-label={`Remove ${props.project.displayName}`}
              onClick={remove}
            >
              <Trash2 size={14} />
            </button>
          </Show>
        </div>
      </div>
      <Show when={props.expanded}>
        <div class="navigator-chats">
          <For each={props.project.threads}>
            {(thread: SessionListItem) => (
              <ChatRow
                thread={thread}
                projectName={props.project.displayName}
                active={thread.path === props.activeSessionPath}
                activity={chatActivity(thread, props.project, props.runningSessionPaths)}
                onSelect={() => props.onSelectSession(thread.path)}
              />
            )}
          </For>
          <Show when={props.project.threads.length === 0}>
            <button type="button" class="navigator-empty" onClick={props.onNewSession}>
              <MessageSquarePlus size={13} /> No chats yet — start one
            </button>
          </Show>
        </div>
      </Show>
    </section>
  )
}
