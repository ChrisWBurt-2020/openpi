import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import type { InsightMode } from '../../src/lib/insights'
import { IPC, type OutputLine, type SessionReady } from '../../src/lib/ipc'
import { removeWorktree } from '../git/worktree'
import type { SidecarCommand, SidecarMessage } from '../pi/sidecar'
import { PiSidecarHost } from '../pi/sidecarHost'
import { SidecarPool } from '../pi/sidecarPool'
import type { PiWorkerHost } from '../pi/workerHost'
import type { RemoteConnectionManager } from '../remote/connectionManager'
import { RemotePiRpcHost } from '../remote/piHost'
import type { RemoteWorkspaceDescriptor, WorkspaceRequest } from '../remote/workspaceProtocol'
import { emitSessionError } from '../services/notificationHost'
import type { SessionIndexStore } from './sessionIndex'
import { threadCwdRegistry } from './threadCwd'
// ─── Types ─────────────────────────────────────────────────────────────────────

export type SessionState = {
  threadId: string
  cwd: string
  sessionFile: string | null
  sessionId: string | null
}

export type StartSessionOptions = {
  sessionFile?: string
  /** Entry ID to fork from. When set, opens the session positioned at this entry. */
  forkEntryId?: string
  /** Git worktree path (when session is in worktree mode). */
  worktreePath?: string
  /** Original repository root (when worktreePath is set, root is the repo, not worktree). */
  rootCwd?: string
}

// ─── Module state ──────────────────────────────────────────────────────────────

let _state: SessionState | null = null
let _deferredWorkspace: string | null = null
let _deferredThreadId: string | null = null
let _refreshInFlight: Promise<void> | null = null
const MAX_LIVE_THREADS = 3
let _activeThreadId: string | null = null
let _insightMode: InsightMode = 'mentor'
const _threadBySessionFile = new Map<string, string>()
const _stateByThread = new Map<string, SessionState>()
const _readyByThread = new Map<string, SessionReady>()
type WorkerPlan =
  | { kind: 'persistent-runner'; connectionId: string; workspacePath: string }
  | { kind: 'ssh-workspace'; descriptor: RemoteWorkspaceDescriptor }

const _workerPlans = new Map<string, WorkerPlan>()
let _remoteConnections: RemoteConnectionManager | null = null
const _sidecarPool = new SidecarPool<PiWorkerHost>({
  maxLive: MAX_LIVE_THREADS,
  spawn: (threadId) => {
    const plan = _workerPlans.get(threadId)
    if (plan?.kind === 'persistent-runner' && _remoteConnections) {
      const host = new RemotePiRpcHost({
        runnerId: threadId,
        connectionId: plan.connectionId,
        workspacePath: plan.workspacePath,
        manager: _remoteConnections,
        onMessage: (msg) => {
          if (msg.type === 'session_event') {
            const event = msg.event as { type?: string }
            if (event.type === 'agent_start') _sidecarPool.setBusy(threadId, true)
            if (event.type === 'agent_end' || event.type === 'agent_settled')
              _sidecarPool.setBusy(threadId, false)
          }
          _onSidecarMessage?.(threadId, msg)
        },
        onCrash: () => {
          _sidecarPool.setBusy(threadId, false)
          _onSidecarMessage?.(threadId, {
            type: 'session_error',
            message: 'Remote Pi connection closed.',
            code: 'remote_pi_disconnected',
          })
          _sidecarPool.release(threadId)
        },
      })
      host.start()
      return host
    }
    const host = new PiSidecarHost({
      onMessage: (msg) => {
        if (msg.type === 'session_event') {
          const event = msg.event as { type?: string }
          if (event.type === 'agent_start') _sidecarPool.setBusy(threadId, true)
          if (event.type === 'agent_end') _sidecarPool.setBusy(threadId, false)
        }
        // Every live worker keeps streaming, including workers in the
        // background. The thread id is attached here, at the point where it
        // cannot be confused with whichever thread happens to be foreground.
        _onSidecarMessage?.(threadId, msg)
      },
      onCrash: () => {
        _sidecarPool.setBusy(threadId, false)
        _onSidecarMessage?.(threadId, {
          type: 'session_error',
          message: 'Pi sidecar crashed repeatedly.',
          code: 'pi_sidecar_crashed',
        })
        _sidecarPool.release(threadId)
      },
      onWorkspaceRequest: async (request: WorkspaceRequest) => {
        const current = _workerPlans.get(threadId)
        if (current?.kind !== 'ssh-workspace' || !_remoteConnections) {
          throw new Error('SSH workspace transport is unavailable')
        }
        return _remoteConnections.workspaceOperation(
          current.descriptor.connectionId,
          current.descriptor.root,
          current.descriptor.virtualCwd,
          request
        )
      },
    })
    host.start()
    return host
  },
  dispose: (host) => {
    void host.stop()
  },
})

// ─── External references (set by main.ts) ──────────────────────────────────────

let _mainWindow: BrowserWindow | null = null
let _sessionIndex: SessionIndexStore | null = null

export function setSessionHostMainWindow(win: BrowserWindow | null): void {
  _mainWindow = win
}

export function setSessionHostSessionIndex(si: SessionIndexStore | null): void {
  _sessionIndex = si
  const savedMode = si?.getPref('insights.mode')
  if (
    savedMode === 'off' ||
    savedMode === 'critical' ||
    savedMode === 'balanced' ||
    savedMode === 'mentor'
  ) {
    _insightMode = savedMode
  }
}

export function setSessionHostRemoteConnections(manager: RemoteConnectionManager | null): void {
  _remoteConnections = manager
}

function sendToMainWindow(channel: string, ...args: unknown[]): void {
  if (!_mainWindow || _mainWindow.isDestroyed()) return
  _mainWindow.webContents.send(channel, ...args)
}

// ─── Callbacks (bridge to main.ts lazy imports) ────────────────────────────────

let _onOutputLine: ((line: OutputLine) => void) | null = null
let _onRestartGitMonitoring: ((cwd: string) => void) | null = null
let _onStopGitMonitoring: (() => void) | null = null
let _onMaybeCheckPiUpdate: (() => void) | null = null
let _onSidecarMessage: ((threadId: string, msg: SidecarMessage) => void) | null = null

export function setOnOutputLine(fn: (line: OutputLine) => void): void {
  _onOutputLine = fn
}

export function setOnRestartGitMonitoring(fn: (cwd: string) => void): void {
  _onRestartGitMonitoring = fn
}

export function setOnStopGitMonitoring(fn: () => void): void {
  _onStopGitMonitoring = fn
}

export function setOnMaybeCheckPiUpdate(fn: () => void): void {
  _onMaybeCheckPiUpdate = fn
}

export function setOnSidecarMessage(fn: (threadId: string, msg: SidecarMessage) => void): void {
  _onSidecarMessage = fn
}

// ─── Getters for main.ts ───────────────────────────────────────────────────────

export function getSessionState(): SessionState | null {
  return _state
}

export function getDeferredWorkspace(): string | null {
  return _deferredWorkspace
}

export function getPiSidecarHost(): PiWorkerHost | null {
  return _activeThreadId ? (_sidecarPool.get(_activeThreadId) ?? null) : null
}

export function getWorkerDiagnostics(): Record<string, unknown> {
  return {
    activeThreadId: _activeThreadId,
    liveThreadIds: _sidecarPool.liveThreadIds(),
    busyThreadIds: _sidecarPool.busyThreadIds(),
    executionModes: [..._workerPlans.entries()].map(([threadId, plan]) => ({
      threadId,
      mode: plan.kind,
    })),
  }
}

export function sendToThread(threadId: string, command: SidecarCommand): void {
  _sidecarPool.get(threadId)?.send(command)
}

export function getActiveThreadId(): string | null {
  return _activeThreadId
}

export function isForegroundThread(threadId: string): boolean {
  return threadId === _activeThreadId
}

export function resolveThreadCwd(threadId: string): string | null {
  return _stateByThread.get(threadId)?.cwd ?? null
}

export function setInsightMode(mode: InsightMode): void {
  _insightMode = mode
  _sidecarPool.forEach((worker) => {
    worker.send({ type: 'set_insight_mode', mode })
  })
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

// ─── Pi sidecar lifecycle ──────────────────────────────────────────────────────

export function requirePiSidecar(): PiWorkerHost {
  return ensurePiSidecarStarted()
}

export function ensurePiSidecarStarted(): PiWorkerHost {
  const threadId = _activeThreadId ?? 'bootstrap'
  const result = _sidecarPool.acquire(threadId)
  if (!result.ok) throw new Error(result.message)
  _activeThreadId = threadId
  _sidecarPool.setForeground(threadId)
  return result.worker
}

// ─── State mutation helpers (called from main.ts handleSidecarMessage) ─────────

export function applySessionValues(ready: SessionReady): void {
  const threadId = _activeThreadId ?? ready.sessionId ?? randomUUID()
  _state = {
    threadId,
    cwd: ready.cwd,
    sessionFile: ready.sessionFile,
    sessionId: ready.sessionId,
  }
  _deferredWorkspace = null
  _deferredThreadId = null
  _stateByThread.set(_state.threadId, _state)
  _readyByThread.set(threadId, ready)
  if (ready.sessionId) {
    threadCwdRegistry.register(ready.sessionId, { root: ready.cwd })
    threadCwdRegistry.setActive(ready.sessionId)
  }
  sendToMainWindow(IPC.SESSION_READY, { threadId, ready })
}

export function clearSessionState(): void {
  const sessionIds = new Set(
    [..._stateByThread.values()]
      .map((state) => state.sessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId))
  )
  if (_state?.sessionId) sessionIds.add(_state.sessionId)

  for (const sessionId of sessionIds) {
    const cwd = threadCwdRegistry.get(sessionId)
    if (cwd?.worktreePath) {
      // Fire-and-forget worktree cleanup.
      removeWorktree(cwd.root, cwd.worktreePath).catch(() => {
        /* cleanup best-effort */
      })
    }
    threadCwdRegistry.unregister(sessionId)
  }
  _state = null
  _stateByThread.clear()
  _readyByThread.clear()
  _threadBySessionFile.clear()
  _activeThreadId = null
  _sidecarPool.releaseAll()
  _deferredWorkspace = null
  _deferredThreadId = null
}

export function applySessionReady(
  ready: SessionReady,
  cwd: string,
  sourceThreadId = _activeThreadId ?? ready.sessionId ?? randomUUID()
): void {
  const nextState: SessionState = {
    threadId: sourceThreadId,
    cwd: ready.cwd,
    sessionFile: ready.sessionFile,
    sessionId: ready.sessionId,
  }
  _stateByThread.set(sourceThreadId, nextState)
  _readyByThread.set(sourceThreadId, ready)
  if (ready.sessionFile) _threadBySessionFile.set(ready.sessionFile, sourceThreadId)
  if (ready.sessionId) {
    threadCwdRegistry.register(ready.sessionId, { root: ready.cwd })
  }
  sendToMainWindow(IPC.SESSION_READY, { threadId: sourceThreadId, ready })

  // A background worker becoming ready must update its own read model, but it
  // must not replace the active workspace or restart foreground Git monitors.
  if (sourceThreadId !== _activeThreadId) return
  _state = nextState
  _deferredWorkspace = null
  _deferredThreadId = null
  if (ready.sessionId) threadCwdRegistry.setActive(ready.sessionId)
  _onRestartGitMonitoring?.(cwd)
}

export function resolveActiveCwd(): string {
  return _state?.cwd ?? _deferredWorkspace ?? ''
}

// ─── Session lifecycle ─────────────────────────────────────────────────────────

export function normalizeSessionReady(payload: SessionReady): SessionReady {
  return {
    ...payload,
    sessionName: payload.sessionFile
      ? (_sessionIndex?.getSessionTitle(payload.sessionFile) ?? payload.sessionName ?? null)
      : (payload.sessionName ?? null),
  }
}

export async function startSession(cwd: string, options: StartSessionOptions = {}): Promise<void> {
  const deferredWorkspace = _deferredWorkspace
  const deferredThreadId = _deferredThreadId
  _deferredWorkspace = null
  const remoteWorkspace = _sessionIndex?.getRemoteWorkspace(cwd) ?? null
  const workspacePath = remoteWorkspace ? cwd : (_sessionIndex?.upsertWorkspace(cwd) ?? cwd)

  const threadId =
    (options.sessionFile ? _threadBySessionFile.get(options.sessionFile) : undefined) ??
    (deferredWorkspace === workspacePath ? (deferredThreadId ?? undefined) : undefined) ??
    randomUUID()
  if (remoteWorkspace?.executionMode === 'persistent-runner') {
    _workerPlans.set(threadId, {
      kind: 'persistent-runner',
      connectionId: remoteWorkspace.connectionId,
      workspacePath: remoteWorkspace.path,
    })
  } else if (remoteWorkspace) {
    _workerPlans.set(threadId, {
      kind: 'ssh-workspace',
      descriptor: {
        connectionId: remoteWorkspace.connectionId,
        root: remoteWorkspace.path,
        virtualCwd: path.join(os.tmpdir(), 'openpi-ssh-workspaces', threadId),
      },
    })
  } else _workerPlans.delete(threadId)
  const acquired = _sidecarPool.acquire(threadId)
  if (!acquired.ok) throw new Error(acquired.message)
  _activeThreadId = threadId
  acquired.worker.send({ type: 'set_insight_mode', mode: _insightMode })
  _sidecarPool.setForeground(threadId)
  _deferredThreadId = null
  _state = null
  _onStopGitMonitoring?.()

  const retained = _stateByThread.get(threadId)
  if (retained && !acquired.spawned) {
    _state = retained
    const ready =
      _readyByThread.get(threadId) ??
      normalizeSessionReady({
        cwd: retained.cwd,
        sessionFile: retained.sessionFile,
        sessionId: retained.sessionId,
        sessionName: null,
        model: null,
        thinkingLevel: null,
      })
    sendToMainWindow(IPC.SESSION_READY, { threadId, ready })
    if (retained.sessionId) threadCwdRegistry.setActive(retained.sessionId)
    _onRestartGitMonitoring?.(retained.cwd)
    return
  }

  const requestId = createRequestId()
  const workerPlan = _workerPlans.get(threadId)
  const response = await acquired.worker.request<
    Extract<SidecarMessage, { type: 'session_ready' }>
  >({
    type: 'start_session',
    requestId,
    cwd: workspacePath,
    workspaceTrusted: _sessionIndex?.isWorkspaceTrusted(workspacePath) ?? false,
    remoteWorkspace: workerPlan?.kind === 'ssh-workspace' ? workerPlan.descriptor : undefined,
    sessionFile: options.sessionFile,
    forkEntryId: options.forkEntryId,
  })

  const ready = normalizeSessionReady(response.payload as SessionReady)
  const nextState: SessionState = {
    threadId,
    cwd: ready.cwd,
    sessionFile: ready.sessionFile,
    sessionId: ready.sessionId,
  }
  _stateByThread.set(threadId, nextState)
  _readyByThread.set(threadId, ready)
  if (ready.sessionFile) _threadBySessionFile.set(ready.sessionFile, threadId)
  if (ready.sessionId) {
    threadCwdRegistry.register(ready.sessionId, { root: ready.cwd })
  }

  // Worktree mode: correct registry entry to reflect root repo + worktree path.
  if (options.worktreePath && options.rootCwd && ready.sessionId) {
    threadCwdRegistry.update(ready.sessionId, {
      root: options.rootCwd,
      worktreePath: options.worktreePath,
    })
  }

  sendToMainWindow(IPC.SESSION_READY, { threadId, ready })
  if (_activeThreadId !== threadId) return

  _state = nextState
  if (ready.sessionId) threadCwdRegistry.setActive(ready.sessionId)
  _onMaybeCheckPiUpdate?.()
  await refreshSessionIndex()
}

export async function ensureActiveSession(): Promise<SessionState | null> {
  if (_state) return _state
  if (!_deferredWorkspace) return null
  await startSession(_deferredWorkspace)
  return _state
}

export function activeWorkspacePath(): string | null {
  return _state?.cwd ?? _deferredWorkspace ?? null
}

export function showDeferredWorkspace(cwd: string): void {
  const workspacePath = _sessionIndex?.getRemoteWorkspace(cwd)
    ? cwd
    : (_sessionIndex?.upsertWorkspace(cwd) ?? cwd)
  const threadId = randomUUID()
  _deferredWorkspace = workspacePath
  _deferredThreadId = threadId
  _activeThreadId = threadId
  _state = null
  _sidecarPool.setForeground(null)
  const ready: SessionReady = {
    cwd: workspacePath,
    sessionFile: null,
    sessionId: null,
    sessionName: null,
    model: null,
    thinkingLevel: null,
  }
  sendToMainWindow(IPC.SESSION_READY, { threadId, ready })
  void refreshSessionIndex()
  _onMaybeCheckPiUpdate?.()
}

export async function refreshSessionIndex(): Promise<void> {
  if (!_sessionIndex) return
  if (_refreshInFlight) return _refreshInFlight

  _refreshInFlight = (async () => {
    try {
      const workspacePath = activeWorkspacePath()
      if (!workspacePath) {
        sendToMainWindow(IPC.SESSION_INDEX_UPDATED)
        return
      }
      await _sessionIndex?.refreshSessions(_state?.sessionFile ?? null, workspacePath)
      sendToMainWindow(IPC.SESSION_INDEX_UPDATED)
    } catch (err) {
      emitSessionError(
        err instanceof Error ? err.message : String(err),
        'session_index_refresh_failed'
      )
    } finally {
      _refreshInFlight = null
    }
  })()

  return _refreshInFlight
}

// ─── Registration in registerHandlers ──────────────────────────────────────────
// This is called from main.ts and returns an object of handlers rather than
// having main.ts import each one individually.
//
// For now main.ts continues using the individual function exports above.
// If this module grows further, consider switching to a handler-bundle pattern.
