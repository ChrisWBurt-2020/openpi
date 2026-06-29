/**
 * Reactive `task` tool progress from pi-task extension events.
 */
import { createSignal } from 'solid-js'
import { TaskTracker, type TrackedTask } from '../lib/extensionTrackers'

export type { TrackedTask }

export interface TaskNotification {
  id: string
  description: string
  status: 'completed' | 'failed'
  result?: string
}

export function useExtensionTrackers() {
  const tracker = new TaskTracker()
  const notified = new Set<string>()

  const [tasks, setTasks] = createSignal<TrackedTask[]>([])
  const [taskNotification, setTaskNotification] = createSignal<TaskNotification | null>(null)

  const refresh = () => setTasks(tracker.snapshot())

  const dispatchEvent = (event: Record<string, unknown>, eventType: string): boolean => {
    let changed = false

    if (eventType === 'tool_execution_start') {
      const e = event as { toolCallId?: string; toolName?: string; args?: Record<string, unknown> }
      changed = tracker.onToolStart(e.toolCallId ?? '', e.toolName ?? '', e.args ?? {}) || changed
    }

    if (eventType === 'tool_execution_end') {
      const e = event as {
        toolCallId?: string
        toolName?: string
        result?: unknown
        isError?: boolean
        details?: Record<string, unknown>
      }
      const result = typeof e.result === 'string' ? e.result : JSON.stringify(e.result ?? '')
      const details =
        e.details && typeof e.details === 'object'
          ? (e.details as Record<string, unknown>)
          : undefined
      changed =
        tracker.onToolEnd(
          e.toolCallId ?? '',
          e.toolName ?? '',
          result,
          Boolean(e.isError),
          details
        ) || changed

      if (changed && !e.isError) {
        const snap = tracker.snapshot()
        const ended = snap.find((t) => t.tempId === (e.toolCallId ?? ''))
        if (
          ended &&
          !ended.background &&
          (ended.status === 'completed' || ended.status === 'failed') &&
          !notified.has(ended.tempId)
        ) {
          notified.add(ended.tempId)
          setTaskNotification({
            id: ended.taskId ?? ended.tempId,
            description: ended.description,
            status: ended.status === 'failed' ? 'failed' : 'completed',
            result: ended.result,
          })
          setTimeout(() => setTaskNotification(null), 8000)
        }
      }
    }

    if (changed) refresh()
    return changed
  }

  const clearFinished = () => {
    tracker.clearFinished()
    refresh()
  }

  const clearAll = () => {
    tracker.clear()
    notified.clear()
    setTaskNotification(null)
    setTasks([])
  }

  return {
    tasks,
    taskNotification,
    dismissTaskNotification: () => setTaskNotification(null),
    dispatchEvent,
    clearFinished,
    clearAll,
  }
}
