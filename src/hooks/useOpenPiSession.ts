/**
 * useOpenPiSession — SolidJS reactive session hook.
 *
 * Migration from React:
 *   useState      → createSignal (accessed via getters so callers use session.ready, not session.ready())
 *   useEffect     → onMount + createEffect(on(...)) + onCleanup
 *   useCallback   → plain functions (no deps array needed — SolidJS components execute once)
 *   useMemo       → createMemo
 *   useRef        → let variable (assigned via ref= callback)
 *   startTransition → removed (batch() used where needed)
 *
 * Getter pattern: each signal is exposed as a JS getter so consumers can write
 * `session.ready` (same as before) while still getting fine-grained reactivity
 * tracking when accessed from JSX or createEffect.
 */
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import type {
  BashExecutionResult,
  ModelInfo,
  SessionEvent,
  SessionListItem,
  WorkspaceSummaryInfo,
} from '../lib/ipc'
import type { ComposerIntent } from '../lib/runs'
import { buildSessionPromptPayload, buildSessionPromptText } from '../lib/sessionPrompt'
import { isSubSessionPath } from '../lib/subSessionNavigation'
import {
  findTaskIdForToolCall,
  resolveTaskStatusFromHistory,
  type TaskHistoryEntry,
} from '../lib/taskHistory'
import { isValidPiTaskId } from '../lib/taskToolHelpers'
import {
  applyThreadSessionEvent,
  applyThreadSessionReady,
  type ThreadQueueMode,
  type ThreadSessionSnapshot,
} from '../lib/threadSessionState'
import type { ToolCard } from '../types/session'
import { useExtensionTrackers } from './useExtensionTrackers'

function taskHistorySignature(entries: TaskHistoryEntry[]): string {
  return entries
    .map((entry) => `${entry.id}:${entry.status ?? ''}:${entry.startedAt ?? ''}`)
    .join('|')
}

/** A snapshot of the session we navigated away from, used to power "Back to parent". */
interface ParentStackEntry {
  path: string
  name: string | null
  cwd: string
}

export { isSubSessionPath }

import { useRemoteSessionSync } from './useRemoteSessionSync'
import { useSessionIndex } from './useSessionIndex'
import { useSubagentFileTracker } from './useSubagentFileTracker'

const HISTORY_PAGE_LIMIT = 200

export type QueueMode = ThreadQueueMode

export { buildSessionPromptText }

export function useOpenPiSession() {
  // ── Core session state ────────────────────────────────────────────────────
  const snapshots = new Map<string, ThreadSessionSnapshot>()
  const [activeThreadId, setActiveThreadId] = createSignal<string | null>(null)
  const [snapshotRevision, setSnapshotRevision] = createSignal(0)
  const [transportError, setTransportError] = createSignal<string | null>(null)
  const [composerIntent, setComposerIntent] = createSignal<ComposerIntent>('ask')
  const selectedSnapshot = createMemo(() => {
    snapshotRevision()
    const threadId = activeThreadId()
    return threadId ? (snapshots.get(threadId) ?? null) : null
  })
  const ready = () => selectedSnapshot()?.ready ?? null
  const messages = () => selectedSnapshot()?.messages ?? []
  const isStreaming = () => selectedSnapshot()?.isStreaming ?? false
  const isShellRunning = () => selectedSnapshot()?.isShellRunning ?? false
  const error = () => selectedSnapshot()?.error ?? transportError()
  const queueMode = () => selectedSnapshot()?.queueMode ?? 'prompt'
  const currentModel = () => selectedSnapshot()?.currentModel ?? null
  const thinkingLevel = () => selectedSnapshot()?.thinkingLevel ?? 'medium'
  const steeringQueue = () => selectedSnapshot()?.steeringQueue ?? []
  const followUpQueue = () => selectedSnapshot()?.followUpQueue ?? []
  const sessionName = () => selectedSnapshot()?.sessionName ?? null
  const contextPercent = () => selectedSnapshot()?.contextPercent ?? null
  const sessionStats = () => selectedSnapshot()?.sessionStats ?? null

  const commitSnapshot = (threadId: string, snapshot: ThreadSessionSnapshot) => {
    snapshots.set(threadId, snapshot)
    setSnapshotRevision((revision) => revision + 1)
  }
  const updateThread = (
    threadId: string,
    update: (snapshot: ThreadSessionSnapshot) => ThreadSessionSnapshot
  ) => {
    const previous = snapshots.get(threadId)
    if (!previous) return
    const next = update(previous)
    if (next !== previous) commitSnapshot(threadId, next)
  }
  const updateSelected = (
    update: (snapshot: ThreadSessionSnapshot) => ThreadSessionSnapshot
  ): void => {
    const threadId = activeThreadId()
    if (threadId) updateThread(threadId, update)
  }
  const setError = (
    value: string | null | ((previous: string | null) => string | null)
  ): string | null => {
    let result = error()
    updateSelected((snapshot) => {
      result = typeof value === 'function' ? value(snapshot.error) : value
      return snapshot.error === result ? snapshot : { ...snapshot, error: result }
    })
    if (result === null) setTransportError(null)
    return result
  }
  const setQueueMode = (value: QueueMode | ((previous: QueueMode) => QueueMode)): QueueMode => {
    let result = queueMode()
    updateSelected((snapshot) => {
      result = typeof value === 'function' ? value(snapshot.queueMode) : value
      return result === snapshot.queueMode ? snapshot : { ...snapshot, queueMode: result }
    })
    return result
  }
  const [input, setInput] = createSignal('')
  const [models, setModels] = createSignal<ModelInfo[]>([])
  const [parentStack, setParentStack] = createSignal<Array<ParentStackEntry>>([])
  const [taskHistory, setTaskHistory] = createSignal<TaskHistoryEntry[]>([])
  const isSubSession = createMemo<boolean>(() => {
    const file = ready()?.sessionFile
    return typeof file === 'string' && file.includes('/.pi/artifacts/sessions/')
  })
  // Each snapshot tracks whether its last delivery was a fresh prompt. The
  // reducer uses that marker to activate steer only for that thread's next
  // agent_start, not for intermediate starts or another thread's run.
  const sessionIndex = useSessionIndex(() => ready()?.cwd ?? null)
  const [gitBranch, setGitBranch] = createSignal<string | null>(null)
  const [workspaceSummary, setWorkspaceSummary] = createSignal<WorkspaceSummaryInfo | null>(null)
  const [gitStats, setGitStats] = createSignal<{
    added: number
    removed: number
    untracked: number
    changed: number
  } | null>(null)
  // ── Extension trackers (ask / subagents) ──────────────────────────
  const trackers = useExtensionTrackers()
  const subagentFiles = useSubagentFileTracker()
  const remoteSync = useRemoteSessionSync({
    isStreaming,
    isReady: () => ready() !== null,
    setError,
  })

  // ── Refs — plain variables assigned via SolidJS ref= callback ────────────
  let _bottomEl: HTMLDivElement | undefined
  let textareaEl: HTMLTextAreaElement | undefined
  // ── Derived ───────────────────────────────────────────────────────────────
  // (contextPercent is already a signal — no memo wrapper needed)

  // ── Helpers ───────────────────────────────────────────────────────────────
  const refreshContextUsage = async () => {
    const threadId = activeThreadId()
    if (!threadId) return
    try {
      const stats = await window.openpi.getSessionStats()
      updateThread(threadId, (snapshot) => ({
        ...snapshot,
        contextPercent: stats.contextUsagePercent,
        sessionStats: stats,
      }))
    } catch {
      /* non-fatal */
    }
  }

  const loadInitialMessages = async (threadId: string, sessionFile: string) => {
    try {
      const page = await window.openpi.getSessionMessages(sessionFile, {
        limit: HISTORY_PAGE_LIMIT,
      })
      updateThread(threadId, (snapshot) => {
        if (snapshot.ready.sessionFile !== sessionFile) return snapshot
        const seen = new Set(page.messages.map((message) => message.id))
        const liveMessages = snapshot.messages.filter((message) => !seen.has(message.id))
        return {
          ...snapshot,
          messages: [...page.messages, ...liveMessages],
          hasMoreHistoryBefore: page.hasMoreBefore,
          historyBeforeEntryId: page.nextBeforeEntryId,
        }
      })
    } catch (err) {
      updateThread(threadId, (snapshot) => ({
        ...snapshot,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  const loadOlderSessionMessages = async () => {
    const threadId = activeThreadId()
    const snapshot = selectedSnapshot()
    const sessionFile = snapshot?.ready.sessionFile
    const beforeEntryId = snapshot?.historyBeforeEntryId
    if (!threadId || !sessionFile || !beforeEntryId || snapshot.isLoadingOlderHistory) {
      return
    }

    updateThread(threadId, (current) => ({ ...current, isLoadingOlderHistory: true }))
    try {
      const page = await window.openpi.getSessionMessages(sessionFile, {
        limit: HISTORY_PAGE_LIMIT,
        beforeEntryId,
      })
      updateThread(threadId, (current) => {
        if (current.ready.sessionFile !== sessionFile) return current
        const seen = new Set(current.messages.map((message) => message.id))
        return {
          ...current,
          messages: [
            ...page.messages.filter((message) => !seen.has(message.id)),
            ...current.messages,
          ],
          hasMoreHistoryBefore: page.hasMoreBefore,
          historyBeforeEntryId: page.nextBeforeEntryId,
          isLoadingOlderHistory: false,
        }
      })
    } catch (err) {
      updateThread(threadId, (current) => ({
        ...current,
        error: err instanceof Error ? err.message : String(err),
        isLoadingOlderHistory: false,
      }))
    }
  }

  const handleEvent = (threadId: string, event: SessionEvent) => {
    const isSelected = threadId === activeThreadId()
    updateThread(threadId, (snapshot) => applyThreadSessionEvent(snapshot, event))

    if (event.type === 'agent_start' && isSelected) {
      remoteSync.markLocalActivity()
    }
    if (event.type === 'agent_end') {
      if (isSelected) {
        void refreshContextUsage()
        // Clear finished subagents on session end; keep task tray across agent turns
        trackers.clearFinished()
      }
    }

    // ── Extension tracker dispatch ───────────────────────────────────────────
    if (
      isSelected &&
      (event.type === 'tool_execution_start' || event.type === 'tool_execution_end')
    ) {
      trackers.dispatchEvent(event as Record<string, unknown>, event.type)
    }
  }

  // ── Scroll-to-bottom on message changes ──────────────────────────────────
  // Scroll is owned by ConversationPane which has scroll container + user-intent tracking.
  // bottomEl is still stored via setBottomRef for potential future use.

  // ── Re-fetch models when session becomes ready ────────────────────────────
  createEffect(
    on(ready, (r) => {
      if (!r) return
      if (r.model) {
        window.openpi
          .getModels()
          .then((availableModels) => {
            setModels(availableModels)
            const firstModel = availableModels[0]
            if (!currentModel() && firstModel) {
              updateSelected((snapshot) => ({ ...snapshot, currentModel: firstModel }))
            }
          })
          .catch(() => {})
      }

      // Focus composer when a session opens
      textareaEl?.focus()
    })
  )

  // ── Load task-session-history whenever cwd changes ───────────────────────
  // pi-task writes `.pi/task-session-history.json` at task start; it is the
  // most reliable source for linking a parent `task` tool card to its child
  // sub-session (the tracker's `taskId` is populated from `tool_execution_end`
  // details, which pi-task does not always emit). Keep polling while the cwd is
  // active because `.pi/task-session-history.json` is outside the artifact
  // watcher, so no live event fires when the task id lands.
  createEffect(
    on(ready, (r) => {
      const cwd = r?.cwd
      let disposed = false
      let signature = ''

      const refresh = async () => {
        if (!cwd || disposed) return
        try {
          const entries = (await window.openpi.readTaskSessionHistory({
            cwd,
          })) as TaskHistoryEntry[]
          if (disposed) return
          const nextSignature = taskHistorySignature(entries)
          if (nextSignature !== signature) {
            signature = nextSignature
            setTaskHistory(entries)
          }
        } catch {
          if (!disposed) setTaskHistory([])
        }
      }

      if (!cwd) {
        setTaskHistory([])
        return
      }

      void refresh()
      const timer = window.setInterval(() => {
        void refresh()
      }, 1000)

      onCleanup(() => {
        disposed = true
        window.clearInterval(timer)
      })
    })
  )

  // ── Re-fetch session index when filter options change ─────────────────────
  createEffect(
    on(
      [
        sessionIndex.sessionQuery,
        sessionIndex.sortBy,
        sessionIndex.groupBy,
        sessionIndex.showRecent,
      ] as const,
      () => {
        void sessionIndex.loadSessionIndex()
      },
      { defer: true }
    )
  )

  // ── IPC subscriptions (mounted once, cleaned up on unmount) ──────────────
  onMount(() => {
    const unsubs: Array<() => void> = []

    unsubs.push(window.openpi.onSessionEvent(({ threadId, event }) => handleEvent(threadId, event)))
    unsubs.push(window.openpi.onRemoteSessionStatus(remoteSync.handleRemoteSessionStatus))

    unsubs.push(window.openpi.onRemoteSessionUpdate(remoteSync.handleRemoteSessionUpdate))

    unsubs.push(
      window.openpi.onSessionReady(({ threadId, ready: payload }) => {
        const readyResult = applyThreadSessionReady(snapshots.get(threadId), threadId, payload)
        batch(() => {
          commitSnapshot(threadId, readyResult.snapshot)
          setActiveThreadId(threadId)
          setComposerIntent('ask')
          setTransportError(null)
          sessionIndex.setSelectedWorkspacePath(payload.cwd)
          // Clear extension trackers on new session
          trackers.clearAll()
          setWorkspaceSummary(null)
        })

        const summaryCwd = payload.cwd
        window.openpi
          .getWorkspaceSummary(summaryCwd)
          .then((info) => {
            if (activeThreadId() !== threadId || ready()?.cwd !== summaryCwd) return
            setWorkspaceSummary(info)
            setGitBranch(info.branch)
          })
          .catch(() => {
            if (activeThreadId() !== threadId || ready()?.cwd !== summaryCwd) return
            setWorkspaceSummary(null)
            setGitBranch(null)
          })

        if (readyResult.created && payload.sessionFile) {
          void loadInitialMessages(threadId, payload.sessionFile)
        }

        void sessionIndex.loadSessionIndex(payload.cwd)
        if (readyResult.created || readyResult.snapshot.contextPercent === null) {
          void refreshContextUsage()
        }
      })
    )

    unsubs.push(
      window.openpi.onSessionError(({ threadId, error: err }) => {
        const targetThreadId = threadId
        if (!targetThreadId || !snapshots.has(targetThreadId)) {
          setTransportError(err.message)
          return
        }
        updateThread(targetThreadId, (snapshot) => ({
          ...snapshot,
          error: err.message,
          isStreaming: false,
        }))
      })
    )

    unsubs.push(
      window.openpi.onSessionIndexUpdated(() => {
        void sessionIndex.loadSessionIndex()
      })
    )

    unsubs.push(
      window.openpi.git.onStatusChanged((s) => {
        setGitStats({
          added: s.totalAdded,
          removed: s.totalRemoved,
          untracked: s.files.filter((f) => f.status === '?').length,
          changed: s.files.length,
        })
      })
    )

    // Initial load
    void sessionIndex.loadSessionIndex()

    onCleanup(() => {
      for (const u of unsubs) u()
    })
  })

  // ── Actions ───────────────────────────────────────────────────────────────

  const openWorkspace = async () => {
    setError(null)
    await window.openpi.pickWorkspace()
    await sessionIndex.loadSessionIndex()
  }

  const openExistingSession = async (session: SessionListItem) => {
    setError(null)
    setParentStack([])
    await window.openpi.openSession({ path: session.path })
  }

  /**
   * Navigate to the sub-session that pi-task created for `taskId`.
   *
   * Resolves the JSONL file at `<cwd>/.pi/artifacts/sessions/<taskId>/`,
   * pushes the current session onto the parent stack, and opens the sub-session
   * via the standard `openSession` IPC (which does a full session replace —
   * the same path used by the sidebar, so the pi-task runner is replaced cleanly).
   *
   * Returns `false` when the exact sub-session file cannot be resolved
   * (e.g. the task id has not landed in history yet, or the sub-session
   * was deleted). Do not fall back to the most recent sub-session: fast
   * first-clicks would open stale/old task sessions.
   */
  const openSubSession = async (taskId: string | null): Promise<boolean> => {
    const current = ready()
    const cwd = current?.cwd
    if (!cwd || !taskId) return false
    const path = await window.openpi.resolveSubSessionPath({ cwd, taskId })
    if (!path) return false
    const stack = parentStack()
    const currentPath = current.sessionFile
    if (currentPath && (stack.length === 0 || stack[stack.length - 1]?.path !== currentPath)) {
      setParentStack([...stack, { path: currentPath, name: current.sessionName ?? null, cwd }])
    }
    setError(null)
    await window.openpi.openSession({ path })
    return true
  }

  /**
   * Pop the most recent parent off the stack and open it. No-op when the
   * stack is empty.
   */
  const popToParent = async (): Promise<void> => {
    const stack = parentStack()
    const target = stack[stack.length - 1]
    if (!target) return
    setParentStack(stack.slice(0, -1))
    setError(null)
    await window.openpi.openSession({ path: target.path })
  }

  const createNewSession = async (mode?: 'local' | 'worktree', baseBranch?: string) => {
    setError(null)
    const cwd = sessionIndex.selectedWorkspaceForQuery() ?? ready()?.cwd
    if (!cwd) return
    await window.openpi.newSession(cwd, mode, baseBranch)
  }

  const send = async (contextPrefix?: string) => {
    const rawInput = input()
    const runMatch = rawInput.match(/^\/run\s+([\s\S]+)/i)
    const intent = runMatch ? 'run' : composerIntent()
    const promptPayload = buildSessionPromptPayload(runMatch?.[1] ?? rawInput, contextPrefix)
    const r = ready()
    const threadId = activeThreadId()
    if (!promptPayload.text || !r || !threadId) return

    setInput('')
    if (textareaEl) textareaEl.style.height = 'auto'
    remoteSync.markLocalActivity()
    try {
      if (queueMode() === 'steer')
        await window.openpi.steer(promptPayload.text, promptPayload.contextPrefix)
      else if (queueMode() === 'followup')
        await window.openpi.followUp(promptPayload.text, promptPayload.contextPrefix)
      else {
        updateThread(threadId, (snapshot) => ({ ...snapshot, awaitingPromptStart: true }))
        const result = await window.openpi.prompt(
          promptPayload.text,
          promptPayload.contextPrefix,
          intent
        )
        if (!result.accepted) {
          setComposerIntent('ask')
          throw new Error(result.message)
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      updateThread(threadId, (snapshot) => ({
        ...snapshot,
        error: message,
        awaitingPromptStart: false,
      }))
    }
  }

  const updateShellMessage = (
    threadId: string,
    id: string,
    result: BashExecutionResult | null,
    error?: string
  ) => {
    updateThread(threadId, (snapshot) => ({
      ...snapshot,
      messages: snapshot.messages.map((message) => {
        if (message.id !== id || message.role === 'system' || message.role === 'extension')
          return message
        const card = message.toolCards[0]
        if (!card) return message
        return {
          ...message,
          toolCards: [
            {
              ...card,
              output: error ?? result?.output ?? '',
              isError: !!error || (result?.exitCode ?? 0) !== 0,
              streaming: false,
            },
          ],
        }
      }),
    }))
  }

  const sendShell = async () => {
    const command = input().trim()
    const r = ready()
    const threadId = activeThreadId()
    if (!command || !r || !threadId || isShellRunning()) return

    const id = `bash-${Date.now()}`
    setInput('')
    if (textareaEl) textareaEl.style.height = 'auto'
    updateThread(threadId, (snapshot) => ({
      ...snapshot,
      isShellRunning: true,
      messages: [
        ...snapshot.messages,
        {
          id,
          role: 'assistant',
          text: '',
          toolCards: [
            {
              toolCallId: id,
              toolName: 'bash',
              args: { command },
              output: '',
              isError: false,
              streaming: true,
            },
          ],
        },
      ],
    }))

    try {
      const result = await window.openpi.bash(command)
      updateShellMessage(threadId, id, result)
      if (activeThreadId() === threadId) void refreshContextUsage()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      updateThread(threadId, (snapshot) => ({ ...snapshot, error: message }))
      updateShellMessage(threadId, id, null, message)
    } finally {
      updateThread(threadId, (snapshot) => ({ ...snapshot, isShellRunning: false }))
    }
  }

  const selectModel = async (model: ModelInfo) => {
    updateSelected((snapshot) => ({
      ...snapshot,
      ready: { ...snapshot.ready, model },
      currentModel: model,
    }))
    await window.openpi.setModel({ provider: model.provider, modelId: model.id })
  }

  const refreshModels = () => {
    window.openpi
      .getModels()
      .then((availableModels) => {
        setModels(availableModels)
      })
      .catch(() => {})
  }

  const selectThinkingLevel = async (level: string) => {
    updateSelected((snapshot) => ({
      ...snapshot,
      ready: { ...snapshot.ready, thinkingLevel: level },
      thinkingLevel: level,
    }))
    await window.openpi.setThinking(level)
  }

  const setSessionName = async (name: string) => {
    const threadId = activeThreadId()
    if (!threadId) return
    try {
      await window.openpi.setSessionName(name)
      updateThread(threadId, (snapshot) => ({
        ...snapshot,
        ready: { ...snapshot.ready, sessionName: name },
        sessionName: name,
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      updateThread(threadId, (snapshot) => ({ ...snapshot, error: message }))
    }
  }

  const forkFromMessage = async (messageId: string) => {
    try {
      await window.openpi.forkSession(messageId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const compactSession = async (customInstructions?: string) => {
    try {
      await window.openpi.compactSession(customInstructions ? { customInstructions } : {})
      // Pi SDK emits compaction_start/end events; renderer already shows them.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const reloadSession = async () => {
    try {
      await window.openpi.reloadSession()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const copyLastAssistantText = async (): Promise<string | null> => {
    try {
      return await window.openpi.copyLastAssistantText()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    }
  }

  const getSessionInfo = async (): Promise<unknown | null> => {
    try {
      return await window.openpi.getSessionInfo()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    }
  }

  // ── Return — getter-based object so callers use session.ready (not session.ready()) ──
  return {
    // Signals exposed as getters (transparent to callers, reactive in JSX/createEffect)
    get ready() {
      return ready()
    },
    get messages() {
      return messages()
    },
    get isStreaming() {
      return isStreaming()
    },
    get agentRunMetrics() {
      return selectedSnapshot()?.runMetrics ?? null
    },
    get isShellRunning() {
      return isShellRunning()
    },
    get input() {
      return input()
    },
    get models() {
      return models()
    },
    get error() {
      return error()
    },
    get queueMode() {
      return queueMode()
    },
    get currentModel() {
      return currentModel()
    },
    get workspaces() {
      return sessionIndex.workspaces()
    },
    get sessions() {
      return sessionIndex.sessions()
    },
    get allSessions() {
      return sessionIndex.allSessions()
    },
    get runningSessionPaths() {
      snapshotRevision()
      return new Set(
        [...snapshots.values()].flatMap((snapshot) =>
          snapshot.isStreaming && snapshot.ready.sessionFile ? [snapshot.ready.sessionFile] : []
        )
      )
    },
    get selectedWorkspacePath() {
      return sessionIndex.selectedWorkspacePath()
    },
    get sessionQuery() {
      return sessionIndex.sessionQuery()
    },
    get sortBy() {
      return sessionIndex.sortBy()
    },
    get groupBy() {
      return sessionIndex.groupBy()
    },
    get showRecent() {
      return sessionIndex.showRecent()
    },
    get collapsedGroups() {
      return sessionIndex.collapsedGroups()
    },
    get gitBranch() {
      return gitBranch()
    },
    get workspaceSummary() {
      return workspaceSummary()
    },
    get gitStats() {
      return gitStats()
    },
    get steeringQueue() {
      return steeringQueue()
    },
    get followUpQueue() {
      return followUpQueue()
    },
    get remoteSessionStatus() {
      return remoteSync.remoteSessionStatus()
    },
    get remoteSessionMessages() {
      return remoteSync.remoteSessionMessages()
    },
    get remoteSessionUpdatedAt() {
      return remoteSync.remoteSessionUpdatedAt()
    },

    get localActivityAt() {
      return remoteSync.localActivityAt()
    },
    get sessionName() {
      return sessionName()
    },
    get contextPercent() {
      return contextPercent()
    },
    get sessionStats() {
      return sessionStats()
    },
    get thinkingLevel() {
      return thinkingLevel()
    },
    get composerIntent() {
      return composerIntent()
    },
    get hasMoreHistoryBefore() {
      return selectedSnapshot()?.hasMoreHistoryBefore ?? false
    },
    get isLoadingOlderHistory() {
      return selectedSnapshot()?.isLoadingOlderHistory ?? false
    },

    // ── Extension tracker state ─────────────────────────────────────
    get tasks() {
      return trackers.tasks()
    },
    get taskNotification() {
      return trackers.taskNotification()
    },
    dismissTaskNotification: () => trackers.dismissTaskNotification(),

    /**
     * Resolve the pi-task short id for a `task` tool card.
     *
     * Lookup chain (first hit wins):
     *  1. `TaskTracker.tasks[]` keyed by `card.toolCallId` — the tracker
     *     is populated from the tool's *result* `details.task_id` when
     *     the call ends.
     *  2. `card.details.task_id` (the structured result field) — this is
     *     a defensive backup; pi-task does not always emit it in the
     *     `tool_execution_end` event.
     *  3. `task-session-history.json` — pi-task writes this at task
     *     start with `{id, agentType, description, startedAt}`. We match
     *     by `agentType` + `description` + closest `startedAt`. This
     *     works for both running (history is written on start) and
     *     completed tasks.
     *
     * Returns `null` when no source has a resolvable id. Caller is
     * expected to render a non-interactive status line in that case.
     */
    resolveTaskIdForCard: (card: ToolCard): string | null => {
      // 1. Tracker
      const fromTracker = trackers.tasks().find((t) => t.tempId === card.toolCallId)?.taskId
      if (typeof fromTracker === 'string' && isValidPiTaskId(fromTracker)) {
        return fromTracker
      }
      // 2. card.details.task_id
      const fromDetails =
        card.details && typeof card.details === 'object'
          ? (card.details as Record<string, unknown>).task_id
          : undefined
      if (typeof fromDetails === 'string' && isValidPiTaskId(fromDetails)) {
        return fromDetails
      }
      // 3. History lookup
      const args = (card.args ?? {}) as Record<string, unknown>
      const agentType = typeof args.agent_type === 'string' ? args.agent_type : null
      const description = typeof args.description === 'string' ? args.description : null
      return findTaskIdForToolCall(taskHistory(), agentType, description, card.startedAt)
    },
    resolveTaskStatusForTaskId: (taskId: string | null): 'running' | 'done' | 'error' | null =>
      resolveTaskStatusFromHistory(taskHistory(), taskId),
    get artifacts() {
      return subagentFiles.artifacts()
    },
    get todoFiles() {
      return subagentFiles.todoFiles()
    },
    clearArtifacts: () => subagentFiles.clear(),

    // Ref setters — pass as `ref={session.setBottomRef}` in JSX
    setBottomRef: (el: HTMLDivElement) => {
      _bottomEl = el
    },
    setTextareaRef: (el: HTMLTextAreaElement) => {
      textareaEl = el
    },

    // Setters
    setInput,
    setError,
    setQueueMode,
    setComposerIntent,
    setSessionQuery: sessionIndex.setSessionQuery,
    setSortBy: sessionIndex.setSortBy,
    setGroupBy: sessionIndex.setGroupBy,
    setShowRecent: sessionIndex.setShowRecent,

    // Actions
    openWorkspace,
    openExistingSession,
    openSubSession,
    popToParent,
    createNewSession,
    selectWorkspace: sessionIndex.selectWorkspace,
    loadWorkspacePreview: sessionIndex.loadWorkspacePreview,
    loadOlderSessionMessages,
    send,
    sendShell,
    selectModel,
    refreshModels,
    selectThinkingLevel,
    toggleGroup: sessionIndex.toggleGroup,
    collapseAllGroups: sessionIndex.collapseAllGroups,
    setSessionName,
    forkFromMessage,
    compactSession,
    reloadSession,
    copyLastAssistantText,
    getSessionInfo,
    clearTasks: () => {
      trackers.clearAll()
    },

    // Sub-session navigation
    parentStack,
    isSubSession,
  }
}
