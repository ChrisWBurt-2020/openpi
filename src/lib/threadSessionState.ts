import type { Message } from '../types/session'
import type { ModelInfo, SessionEvent, SessionReady, SessionStats } from './ipc'
import { applySessionEvent } from './sessionEvents'

export type ThreadQueueMode = 'prompt' | 'steer' | 'followup'

export interface ThreadRunMetrics {
  elapsedMs: number
  output: number
  tps: number
}

export interface ThreadSessionSnapshot {
  threadId: string
  ready: SessionReady
  messages: Message[]
  isStreaming: boolean
  isShellRunning: boolean
  error: string | null
  queueMode: ThreadQueueMode
  steeringQueue: string[]
  followUpQueue: string[]
  sessionName: string | null
  currentModel: ModelInfo | null
  thinkingLevel: string
  contextPercent: number | null
  sessionStats: SessionStats | null
  hasMoreHistoryBefore: boolean
  historyBeforeEntryId: string | null
  isLoadingOlderHistory: boolean
  currentTurnStartMs: number | null
  runStartedAtMs: number | null
  runMetrics: ThreadRunMetrics | null
  awaitingPromptStart: boolean
}

export interface ApplyReadyResult {
  snapshot: ThreadSessionSnapshot
  created: boolean
}

export function applyThreadSessionReady(
  previous: ThreadSessionSnapshot | undefined,
  threadId: string,
  ready: SessionReady
): ApplyReadyResult {
  if (!previous) {
    return {
      created: true,
      snapshot: {
        threadId,
        ready,
        messages: [],
        isStreaming: false,
        isShellRunning: false,
        error: null,
        queueMode: 'prompt',
        steeringQueue: [],
        followUpQueue: [],
        sessionName: ready.sessionName,
        currentModel: ready.model,
        thinkingLevel: ready.thinkingLevel ?? 'medium',
        contextPercent: null,
        sessionStats: null,
        hasMoreHistoryBefore: false,
        historyBeforeEntryId: null,
        isLoadingOlderHistory: false,
        currentTurnStartMs: null,
        runStartedAtMs: null,
        runMetrics: null,
        awaitingPromptStart: false,
      },
    }
  }

  const currentModel = ready.model ?? previous.currentModel
  const thinkingLevel = ready.thinkingLevel ?? previous.thinkingLevel
  return {
    created: false,
    snapshot: {
      ...previous,
      ready: {
        ...ready,
        model: currentModel,
        thinkingLevel,
        sessionName: ready.sessionName ?? previous.sessionName,
      },
      error: null,
      sessionName: ready.sessionName ?? previous.sessionName,
      currentModel,
      thinkingLevel,
    },
  }
}

export function applyThreadSessionEvent(
  previous: ThreadSessionSnapshot,
  event: SessionEvent,
  nowMs = Date.now()
): ThreadSessionSnapshot {
  let next = previous

  switch (event.type) {
    case 'agent_start': {
      next = {
        ...next,
        isStreaming: true,
        queueMode: next.awaitingPromptStart ? 'steer' : next.queueMode,
        awaitingPromptStart: false,
        runStartedAtMs: nowMs,
        runMetrics: null,
      }
      break
    }
    case 'turn_start': {
      const timestamp = event.timestamp
      next = {
        ...next,
        currentTurnStartMs: typeof timestamp === 'number' ? timestamp : nowMs,
      }
      break
    }
    case 'agent_end':
      next = {
        ...next,
        isStreaming: false,
        queueMode: 'prompt',
        currentTurnStartMs: null,
        runMetrics: finishRunMetrics(next.runStartedAtMs, event.messages, nowMs),
        runStartedAtMs: null,
      }
      break
    case 'queue_update': {
      const steering = Array.isArray(event.steering)
        ? event.steering.filter((item): item is string => typeof item === 'string')
        : []
      const followUp = Array.isArray(event.followUp)
        ? event.followUp.filter((item): item is string => typeof item === 'string')
        : []
      next = { ...next, steeringQueue: steering, followUpQueue: followUp }
      break
    }
    case 'session_info_changed':
      {
        const sessionName = typeof event.name === 'string' ? event.name : null
        next = {
          ...next,
          ready: { ...next.ready, sessionName },
          sessionName,
        }
      }
      break
    case 'thinking_level_change':
      if (typeof event.thinkingLevel === 'string') {
        next = {
          ...next,
          ready: { ...next.ready, thinkingLevel: event.thinkingLevel },
          thinkingLevel: event.thinkingLevel,
        }
      }
      break
    default:
      break
  }

  const messages = applySessionEvent(
    next.messages,
    event,
    next.currentModel?.name ?? null,
    event.type === 'message_end' ? previous.currentTurnStartMs : next.currentTurnStartMs
  )
  return messages === next.messages ? next : { ...next, messages }
}

function finishRunMetrics(
  startedAtMs: number | null,
  messages: unknown,
  nowMs: number
): ThreadRunMetrics | null {
  if (startedAtMs === null || !Array.isArray(messages)) return null

  let output = 0
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const record = message as Record<string, unknown>
    if (record.role !== 'assistant') continue
    const usage = record.usage
    if (!usage || typeof usage !== 'object') continue
    const value = (usage as Record<string, unknown>).output
    if (typeof value === 'number' && Number.isFinite(value)) output += value
  }

  const elapsedMs = nowMs - startedAtMs
  if (elapsedMs <= 0 || output <= 0) return null
  return { elapsedMs, output, tps: output / (elapsedMs / 1000) }
}
