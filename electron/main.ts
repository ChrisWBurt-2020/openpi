import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, dialog, ipcMain, Menu, Tray } from 'electron'
import type { GitStatusResult, OutputLine } from '../src/lib/ipc'
import { IPC } from '../src/lib/ipc'
import { registerMainIpcHandlers } from './ipc/register'
import { createSidecarMessageHandler } from './pi/messages'
import type { SidecarCommand, SidecarMessage } from './pi/sidecar'
import { checkPiUpdate } from './pi/updater'
import { RemoteConnectionManager } from './remote/connectionManager'
import { RunManager } from './runs/manager'
import { RunStore } from './runs/store'
import { getAgentReviewSummary } from './services/agentReview'
import { startArtifactWatcher } from './services/artifactWatcher'
import { CompanionProjector } from './services/companionProjector'
import { CompanionStore } from './services/companionStore'
import { CompanionWindows } from './services/companionWindows'
import { recordDiagnosticError } from './services/diagnostics'
import {
  handleLocalFileProtocol,
  handlePetProtocol,
  registerLocalFileScheme,
} from './services/localFileProtocol'
import { PetPackStore } from './services/petPacks'
import {
  ensureFffInitialized,
  getCustomizationsHost,
  getFffHost,
  getGitHost,
  getPtyHost,
  hasFffHost,
  hasGitHost,
  hasPtyHost,
} from './services/mainHosts'
import {
  emitSessionError,
  playSoundEffect,
  setMainWindow,
  setSessionIndex,
  showSystemNotification,
} from './services/notificationHost'
import { dockIconPath, enrichPathFromLoginShell } from './services/shellEnv'
import { startStatusWatchers } from './services/statusWatchers'
import { checkForAppUpdate, initAutoUpdater } from './services/updater'
import { createMainWindow } from './services/windowHost'
import { bindWebContents } from './services/workbenchContext'
import {
  activeWorkspacePath,
  applySessionReady,
  clearSessionState,
  createRequestId,
  getPiSidecarHost,
  getSessionState,
  isForegroundThread,
  normalizeSessionReady,
  refreshSessionIndex,
  resolveActiveCwd,
  resolveThreadCwd,
  sendToThread,
  setOnMaybeCheckPiUpdate,
  setOnOutputLine,
  setOnRestartGitMonitoring,
  setOnSidecarMessage,
  setOnStopGitMonitoring,
  setSessionHostMainWindow,
  setSessionHostRemoteConnections,
  setSessionHostSessionIndex,
  showDeferredWorkspace,
  startSession,
} from './session/sessionHost'
import { SessionIndexStore } from './session/sessionIndex'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const _require = createRequire(import.meta.url)

// ── Login-shell PATH enrichment ──────────────────────────────────────────────
// macOS GUI apps launched from Finder/Dock receive a stripped PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) that omits nvm, Homebrew, etc.
// We run the user's login shell once at startup to harvest the full PATH
// so subprocesses (npm, git, node) can be found regardless of launch method.
enrichPathFromLoginShell()

app.setName('OpenPi')
app.setAppUserModelId('dev.openpi.app')
if (!app.requestSingleInstanceLock()) app.quit()

async function confirmHighRiskMutation(options: {
  title: string
  message: string
  detail: string
}): Promise<boolean> {
  if (!mainWindow) return false
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: options.title,
    message: options.message,
    detail: options.detail,
    buttons: ['Cancel', 'Approve'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return result.response === 1
}

// ─── Session state ─────────────────────────────────────────────────────────────
// Module state is owned by sessionHost.ts; main.ts reads it via getters.
// The lazy-import promises below are local since they bridge to Electron-main
// module resolution, not session lifecycle.

let mainWindow: BrowserWindow | null = null
let sessionIndex: SessionIndexStore | null = null
let remoteConnections: RemoteConnectionManager | null = null
let runManager: RunManager | null = null
let companionProjector: CompanionProjector | null = null
let companionStore: CompanionStore | null = null
let petPacks: PetPackStore | null = null
let companionWindows: CompanionWindows | null = null
let tray: Tray | null = null
let quitting = false

// ── Output ring buffer ─────────────────────────────────────────────────
// Lines emitted before the Output pane opens are held here so they are
// replayed when the renderer calls GET_OUTPUT_BUFFER on mount.
const OUTPUT_BUFFER_MAX = 500
const outputBuffer: OutputLine[] = []

function emitOutputLine(line: OutputLine): void {
  outputBuffer.push(line)
  if (outputBuffer.length > OUTPUT_BUFFER_MAX) outputBuffer.shift()
  mainWindow?.webContents.send(IPC.OUTPUT_APPEND, line)
}

// Capture main-process crashes and forward them to the Output pane,
// then exit so Electron doesn't run in a corrupted state.
process.on('uncaughtException', (err: Error) => {
  recordDiagnosticError('main', 'uncaught_exception', err)
  const text = `[crash] ${err.message}${err.stack ? `\n${err.stack}` : ''}`
  process.stderr.write(`[main] uncaughtException: ${err.stack ?? err.message}\n`)
  emitOutputLine({ level: 'error', text, ts: Date.now() })
  // Give the IPC channel one tick to flush before hard-exit.
  setImmediate(() => app.exit(1))
})
process.on('unhandledRejection', (reason: unknown) => {
  recordDiagnosticError('main', 'unhandled_rejection', reason)
  const text =
    reason instanceof Error
      ? `[rejection] ${reason.message}${reason.stack ? `\n${reason.stack}` : ''}`
      : `[rejection] ${String(reason)}`
  process.stderr.write(`[main] unhandledRejection: ${text}\n`)
  emitOutputLine({ level: 'warn', text, ts: Date.now() })
  // Unhandled rejections are non-fatal — log and continue.
})

async function restartGitMonitoring(cwd: string): Promise<void> {
  if (cwd.startsWith('ssh://')) return
  const git = await getGitHost()
  git.startGitPoll(cwd, (status: GitStatusResult) => {
    mainWindow?.webContents.send(IPC.GIT_STATUS_CHANGED, status)
  })
  git.startFileTreeWatch(cwd, () => {
    mainWindow?.webContents.send(IPC.FILE_TREE_CHANGED)
  })
}

async function maybeCheckPiUpdateOnStartup(): Promise<void> {
  if (sessionIndex?.getPref('updates.check_on_startup') === 'false') return

  const result = await checkPiUpdate()
  if (result.updateAvailable) {
    const line: OutputLine = {
      level: 'info',
      text: `[updates] Pi ${result.latestVersion} is available; current bundled SDK is ${result.currentVersion}.`,
      ts: Date.now(),
    }
    emitOutputLine(line)
  }
}

// ─── Session host ──────────────────────────────────────────────────────────────

const handleSidecarMessage = createSidecarMessageHandler({
  getMainWindow: () => mainWindow,
  normalizeSessionReady,
  applySessionReady: (ready, cwd, threadId) => {
    applySessionReady(ready, cwd, threadId)
    companionProjector?.ensure(cwd, path.basename(cwd) || cwd)
    companionWindows?.setActive(cwd)
  },
  refreshSessionIndex,
  resolveActiveCwd,
  resolveThreadCwd,
  isForegroundThread,
  showSystemNotification,
  playSoundEffect,
  getGitHost,
  emitSessionError,
  emitOutputLine,
  onRunEvent: (threadId, event) => {
    runManager?.onEvent(threadId, event)
    const projectPath = resolveThreadCwd(threadId)
    if (!projectPath) return
    companionProjector?.ensure(projectPath, path.basename(projectPath) || projectPath)
    const at = new Date().toISOString()
    if (event.type === 'agent_start')
      companionProjector?.setSessionActivity(projectPath, threadId, true)
    if (event.type === 'agent_end' || event.type === 'agent_settled')
      companionProjector?.setSessionActivity(projectPath, threadId, false)
    if (
      event.type === 'extension_error' ||
      (event.type === 'auto_retry_end' && event.success === false)
    )
      companionProjector?.setSessionActivity(
        projectPath,
        threadId,
        true,
        String(event.message ?? event.finalError ?? 'Agent error').slice(0, 240)
      )
  },
  onRunControl: (threadId, event) => runManager?.onControl(threadId, event),
  onRunWorkerLost: (threadId, reason) => runManager?.onWorkerLost(threadId, reason),
  onSessionErrorObserved: (threadId, message, code) => {
    const projectPath = resolveThreadCwd(threadId)
    if (!projectPath) return
    companionProjector?.setSessionActivity(projectPath, threadId, true, message.slice(0, 240))
  },
  onReviewChanged: (cwd) => companionProjector?.syncReview(cwd, getAgentReviewSummary(cwd).changes),
})

// ─── IPC handlers ──────────────────────────────────────────────────────────────

function registerHandlers(): void {
  registerMainIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
    outputBuffer,
    getSessionIndex: () => sessionIndex,
    getRemoteConnections: () => remoteConnections,
    getCustomizationsHost,
    getFffHost,
    ensureFffInitialized,
    getGitHost,
    restartGitMonitoring,
    hasPtyHost,
    getPtyHost,
    confirmHighRiskMutation,
    emitOutputLine,
    createRequestId,
    requestSidecar: <T extends SidecarMessage>(message: SidecarCommand & { requestId: string }) =>
      getPiSidecarHost()?.request<T>(message) ??
      Promise.reject(new Error('Pi sidecar not running')),
    sendSidecar: (message: SidecarCommand) => {
      getPiSidecarHost()?.send(message)
    },
    getRunManager: () => runManager,
    getCompanionProjector: () => companionProjector,
    showSiege: () => companionWindows?.showSiege(),
    getCompanionWindows: () => companionWindows,
    activateCompanionProject: (projectPath) => companionWindows?.activateProject(projectPath),
    openCompanionEvidence: (projectPath, evidenceUri) =>
      companionWindows?.openEvidence(projectPath, evidenceUri),
    getPetPacks: () => petPacks,
  })
}

// ─── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = createMainWindow({
    currentDir,
    getPtyHost,
    getSessionIndex: () => sessionIndex,
    showDeferredWorkspace,
    resumeSession: (cwd: string, sessionFile: string) => startSession(cwd, { sessionFile }),
    refreshSessionIndex,
    onClosed: () => {
      mainWindow = null
    },
  })
  mainWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    mainWindow?.hide()
  })
}

// ─── Local file protocol — safe image serving from renderer ─────────────────────
// Registers localfile:// so the sandboxed renderer can load arbitrary
// local images without CSP / sandbox restrictions. Must run before app is ready.
registerLocalFileScheme()

// ─── App lifecycle ─────────────────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.setIcon(dockIconPath())

  handleLocalFileProtocol(() => getSessionState()?.cwd ?? null)
  handlePetProtocol(() => petPacks)

  sessionIndex = new SessionIndexStore(path.join(app.getPath('userData'), 'openpi.sqlite'))
  companionStore = new CompanionStore(path.join(app.getPath('userData'), 'openpi-companion.sqlite'))
  petPacks = new PetPackStore(path.join(app.getPath('userData'), 'pets'))
  companionProjector = new CompanionProjector(companionStore)
  for (const workspace of sessionIndex.listWorkspaces()) {
    companionProjector.ensure(workspace.path, workspace.displayName)
    companionProjector.syncReview(workspace.path, getAgentReviewSummary(workspace.path).changes)
  }
  remoteConnections = new RemoteConnectionManager(sessionIndex)
  const runStore = new RunStore(path.join(app.getPath('userData'), 'openpi-runs.sqlite'))
  runStore.releaseRestartedRuns()
  runManager = new RunManager(runStore, sendToThread, (state) => {
    mainWindow?.webContents.send(IPC.RUN_CHANGED, state)
    companionProjector?.ensure(
      state.workspacePath,
      path.basename(state.workspacePath) || state.workspacePath
    )
    companionProjector?.syncRun(state)
  })
  setSessionIndex(sessionIndex)
  setSessionHostSessionIndex(sessionIndex)
  setSessionHostRemoteConnections(remoteConnections)

  // Wire sessionHost callbacks
  setOnSidecarMessage(handleSidecarMessage)
  setOnOutputLine(emitOutputLine)
  setOnRestartGitMonitoring((cwd) => void restartGitMonitoring(cwd))
  setOnStopGitMonitoring(() => {
    void getGitHost().then((host) => {
      host.stopFileTreeWatch()
      host.stopGitPoll()
    })
    void getFffHost().then((host) => host.destroyFff())
  })
  setOnMaybeCheckPiUpdate(() => {
    void maybeCheckPiUpdateOnStartup().catch((err) => {
      const line: OutputLine = {
        level: 'warn',
        text: `[updates] ${err instanceof Error ? err.message : String(err)}`,
        ts: Date.now(),
      }
      emitOutputLine(line)
    })
  })

  registerHandlers()
  createWindow()
  void remoteConnections.reconnectSaved()
  companionProjector?.rehydrate(runManager.list())
  if (companionProjector)
    companionWindows = new CompanionWindows({
      currentDir,
      projector: companionProjector,
      getMainWindow: () => mainWindow,
      activateProject: (projectPath) => showDeferredWorkspace(projectPath),
    })
  setMainWindow(mainWindow)
  setSessionHostMainWindow(mainWindow)
  tray = new Tray(dockIconPath())
  tray.setToolTip('OpenPi Heron Siege')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open OpenPi',
        click: () => {
          mainWindow?.show()
          mainWindow?.focus()
        },
      },
      { label: 'Show Herons', click: () => companionWindows?.showAll() },
      { label: 'Hide Herons', click: () => companionWindows?.hideAll() },
      { label: 'Show Siege', click: () => companionWindows?.showSiege() },
      { type: 'separator' },
      {
        label: 'Quit OpenPi',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ])
  )

  // ── Auto-updater ─────────────────────────────────────────────────────────
  initAutoUpdater(mainWindow)

  // ── Workbench context bridge ─────────────────────────────────────────────
  if (mainWindow) bindWebContents(mainWindow.webContents)

  startStatusWatchers({
    getMainWindow: () => mainWindow,
    getSessionIndex: () => sessionIndex,
    getPiSidecarHost,
    checkForAppUpdate,
  })

  const artifactWatcher = startArtifactWatcher({
    getMainWindow: () => mainWindow,
    getWorkspacePath: () => activeWorkspacePath(),
  })

  app.on('before-quit', () => artifactWatcher.stop())
})

app.on('window-all-closed', () => undefined)

app.on('second-instance', () => {
  mainWindow?.show()
  mainWindow?.focus()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('quit', () => {
  quitting = true
  companionWindows?.destroy()
  if (hasGitHost())
    void getGitHost().then((g) => {
      g.stopGitPoll()
      g.stopFileTreeWatch()
    })
  if (hasFffHost()) void getFffHost().then((host) => host.destroyFff())
  if (getPiSidecarHost()) void getPiSidecarHost()!.stop()
  if (remoteConnections) void remoteConnections.disconnectAll()
  clearSessionState()
  if (hasPtyHost()) void getPtyHost().then((p) => p.closeAll())
  sessionIndex?.close()
  companionStore?.close()
})
