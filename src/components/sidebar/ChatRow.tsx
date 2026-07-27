import { Bot, Clock3, Coins, MessagesSquare } from 'lucide-solid'
import { createSignal, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { SessionListItem } from '../../lib/ipc'
import { formatRelativeTime } from '../../lib/sessionView'
import type { ChatActivity } from '../../lib/sidebarView'
import { threadLabel } from '../../lib/threadTree'

interface Props {
  activity: ChatActivity
  active: boolean
  projectName: string
  thread: SessionListItem
  onSelect: () => void
}

interface Position {
  left: number
  top: number
}

export function ChatRow(props: Props) {
  const [position, setPosition] = createSignal<Position | null>(null)
  const showCard = (target: HTMLButtonElement) => {
    const bounds = target.getBoundingClientRect()
    setPosition({
      left: Math.min(bounds.right + 8, window.innerWidth - 372),
      top: Math.min(bounds.top, window.innerHeight - 208),
    })
  }
  const activityLabel = () =>
    props.activity && props.activity[0].toUpperCase() + props.activity.slice(1)
  return (
    <>
      <button
        type="button"
        class={`navigator-chat${props.active ? ' is-active' : ''}`}
        aria-current={props.active ? 'true' : undefined}
        title={threadLabel(props.thread)}
        onMouseEnter={(event) => showCard(event.currentTarget)}
        onMouseLeave={() => setPosition(null)}
        onFocus={(event) => showCard(event.currentTarget)}
        onBlur={() => setPosition(null)}
        onClick={props.onSelect}
      >
        <span class="navigator-chat-title">{threadLabel(props.thread)}</span>
        <span class="navigator-chat-meta">
          <span>{props.thread.lastModel || 'Model not recorded'}</span>
          <Show
            when={activityLabel()}
            fallback={<time>{formatRelativeTime(props.thread.updatedAt)}</time>}
          >
            {(label) => (
              <strong class={`navigator-activity is-${props.activity}`}>{label()}</strong>
            )}
          </Show>
        </span>
      </button>
      <Portal>
        <Show when={position()}>
          {(card) => (
            <aside
              class="thread-hover-card"
              style={{ top: `${card().top}px`, left: `${card().left}px` }}
              aria-hidden="true"
            >
              <div class="thread-hover-card-header">
                <strong>{threadLabel(props.thread)}</strong>
                <span>{formatRelativeTime(props.thread.updatedAt)}</span>
              </div>
              <div class="thread-hover-card-row">
                <Bot size={15} />
                <span>{props.thread.lastModel || 'Model not recorded'}</span>
              </div>
              <div class="thread-hover-card-row">
                <MessagesSquare size={15} />
                <span>{props.thread.messageCount} messages</span>
              </div>
              <div class="thread-hover-card-row">
                <Coins size={15} />
                <span>
                  {props.thread.cost > 0 ? `$${props.thread.cost.toFixed(2)}` : 'No recorded cost'}
                </span>
              </div>
              <div class="thread-hover-card-row">
                <Clock3 size={15} />
                <span>{props.projectName}</span>
              </div>
              <Show when={activityLabel()}>
                <div class="thread-hover-card-row">
                  <span class="navigator-activity is-detail">{activityLabel()}</span>
                  <span>Verified current activity</span>
                </div>
              </Show>
            </aside>
          )}
        </Show>
      </Portal>
    </>
  )
}
