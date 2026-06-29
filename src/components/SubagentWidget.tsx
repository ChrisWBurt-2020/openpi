import { Check, Circle, Loader2, X } from 'lucide-solid'
import { For, Show } from 'solid-js'
import type { TrackedTask } from '../lib/extensionTrackers'

interface SubagentWidgetProps {
  tasks: TrackedTask[]
}

function statusIcon(status: TrackedTask['status']) {
  switch (status) {
    case 'running':
    case 'queued':
      return <Loader2 size={12} class="subagent-spin" />
    case 'completed':
      return <Check size={12} />
    case 'failed':
      return <X size={12} />
    default: {
      const _exhaustive: never = status
      return <Circle size={12} />
    }
  }
}

export function SubagentWidget(props: SubagentWidgetProps) {
  const active = () => props.tasks.filter((t) => t.status === 'running' || t.status === 'queued')

  return (
    <Show when={active().length > 0}>
      <div class="subagent-widget">
        <div class="subagent-widget-header">
          <span class="subagent-widget-title">Tasks (pi-task)</span>
          <span class="subagent-widget-count">{active().length}</span>
        </div>
        <div class="subagent-list">
          <For each={active()}>
            {(task) => (
              <div class={`subagent-item subagent-item--${task.status}`}>
                <span class="subagent-item-icon">{statusIcon(task.status)}</span>
                <span class="subagent-item-type">{task.agentType}</span>
                <span class="subagent-item-desc">{task.description}</span>
                <Show when={task.taskId}>
                  <span class="subagent-item-id">{task.taskId}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
