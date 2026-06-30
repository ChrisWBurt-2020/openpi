/**
 * Tracks `@heyhuynhgiabuu/pi-task` `task` tool calls from AgentSessionEvent stream.
 * Durable task state lives in `.pi/task-session-history.json` and sub-session JSONL.
 */
import { isValidPiTaskId } from './taskToolHelpers'

export type TaskRunStatus = 'running' | 'completed' | 'failed' | 'queued'

export interface TrackedTask {
  tempId: string
  taskId?: string
  conversationId?: string
  description: string
  agentType: string
  status: TaskRunStatus
  startedAt: number
  completedAt?: number
  background: boolean
  result?: string
  error?: string
}

export class TaskTracker {
  private tasks: TrackedTask[] = []

  snapshot(): TrackedTask[] {
    return [...this.tasks]
  }

  onToolStart(toolCallId: string, toolName: string, args: Record<string, unknown>): boolean {
    if (toolName !== 'task') return false
    const description = String(args.description ?? 'Task')
    const agentType = String(args.agent_type ?? 'worker')
    const background = args.background !== false
    const rawTaskId = typeof args.task_id === 'string' ? args.task_id : undefined
    const taskId = isValidPiTaskId(rawTaskId) ? rawTaskId : undefined
    const conversationId =
      typeof args.conversation_id === 'string' ? args.conversation_id : undefined
    this.tasks.push({
      tempId: toolCallId,
      taskId,
      conversationId,
      description,
      agentType,
      status: 'running',
      startedAt: Date.now(),
      background,
    })
    return true
  }

  onToolEnd(
    toolCallId: string,
    toolName: string,
    result: string,
    isError: boolean,
    details?: Record<string, unknown>
  ): boolean {
    if (toolName !== 'task') return false
    const idx = this.tasks.findIndex((t) => t.tempId === toolCallId)
    if (idx === -1) return false
    const task = this.tasks[idx]
    const rawDetailTaskId = typeof details?.task_id === 'string' ? details.task_id : undefined
    const detailTaskId = isValidPiTaskId(rawDetailTaskId) ? rawDetailTaskId : undefined
    const phase = typeof details?.phase === 'string' ? details.phase : undefined
    const background = details?.background === true || task.background
    if (!isError && background && !phase) {
      this.tasks[idx] = {
        ...task,
        taskId: detailTaskId ?? task.taskId,
        status: 'running',
      }
      return true
    }
    this.tasks[idx] = {
      ...task,
      taskId: detailTaskId ?? task.taskId,
      status: isError || phase === 'failed' ? 'failed' : 'completed',
      result: isError ? undefined : result.slice(0, 4000),
      error: isError ? result : undefined,
      completedAt: Date.now(),
    }
    return true
  }

  clearFinished() {
    this.tasks = this.tasks.filter((t) => t.status === 'running' || t.status === 'queued')
  }

  clear() {
    this.tasks = []
  }
}
