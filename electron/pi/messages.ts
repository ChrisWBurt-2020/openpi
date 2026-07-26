import path from 'node:path'
import { type BrowserWindow, shell } from 'electron'
import type { OutputLine, SessionReady } from '../../src/lib/ipc'
import { IPC } from '../../src/lib/ipc'
import type * as GitHost from '../git/gitHost'
import { captureAgentReviewEvent, setAgentReviewWindow } from '../services/agentReview'
import type {
  showSystemNotification as notifySystem,
  playSoundEffect as playSound,
} from '../services/notificationHost'
import { SessionEpochGate } from './sessionEpoch'
import type { SidecarMessage } from './sidecar'
import { isStaleExtensionCtxEvent } from './staleCtx'

interface SidecarMessageDeps {
  getMainWindow: () => BrowserWindow | null
  normalizeSessionReady: (payload: SessionReady) => SessionReady
  applySessionReady: (ready: SessionReady, cwd: string, threadId?: string) => void
  refreshSessionIndex: () => Promise<void>
  resolveActiveCwd: () => string | null
  resolveThreadCwd?: (threadId: string) => string | null
  isForegroundThread?: (threadId: string) => boolean
  showSystemNotification: typeof notifySystem
  playSoundEffect: typeof playSound
  getGitHost: () => Promise<typeof GitHost>
  emitSessionError: (message: string, code?: string) => void
  emitOutputLine: (line: OutputLine) => void
  /** Injectable for tests; defaults to a fresh gate per handler. */
  epochGate?: SessionEpochGate
}

interface SessionEventShape {
  type?: string
  success?: boolean
  finalError?: string
  errorMessage?: string
  message?: string
}

export function createSidecarMessageHandler(deps: SidecarMessageDeps) {
  const epochsByThread = new Map<string, SessionEpochGate>()

  function epochsFor(threadId: string): SessionEpochGate {
    if (threadId === 'legacy' && deps.epochGate) return deps.epochGate
    const current = epochsByThread.get(threadId)
    if (current) return current
    const created = new SessionEpochGate()
    epochsByThread.set(threadId, created)
    return created
  }

  return function handleSidecarMessage(
    threadIdOrMessage: string | SidecarMessage,
    maybeMessage?: SidecarMessage
  ): void {
    // The one-argument form remains as a test/backward-compatibility seam.
    // Production always supplies the pool identity as the first argument.
    const threadId = typeof threadIdOrMessage === 'string' ? threadIdOrMessage : 'legacy'
    const msg = typeof threadIdOrMessage === 'string' ? maybeMessage : threadIdOrMessage
    if (!msg) return
    const epochs = epochsFor(threadId)
    const isForeground = deps.isForegroundThread?.(threadId) ?? true

    switch (msg.type) {
      case 'ready':
        // The sidecar restarted, so its epoch counter starts over.
        epochs.reset()
        return
      case 'stopped':
        return

      case 'session_ready': {
        if (!epochs.observeReady(msg.epoch)) return
        const ready = deps.normalizeSessionReady(msg.payload)
        deps.applySessionReady(ready, ready.cwd, threadId)
        return
      }

      case 'session_event': {
        // Drop anything emitted by a thread the user has already left, so the
        // incoming thread doesn't inherit the outgoing one's tail.
        if (!epochs.accepts(msg.epoch)) return
        if (isStaleExtensionCtxEvent(msg.event)) return

        const event = msg.event as SessionEventShape
        const window = deps.getMainWindow()
        window?.webContents.send(IPC.SESSION_EVENT, { threadId, event: msg.event })

        // Background streams reach the renderer, but foreground-only services
        // must remain owned by the thread the user is currently viewing.
        if (!isForeground) return

        setAgentReviewWindow(window)
        if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
          const cwd = deps.resolveThreadCwd?.(threadId) ?? deps.resolveActiveCwd()
          captureAgentReviewEvent(cwd, msg.event as Record<string, unknown>)
        }

        if (event.type === 'agent_end') {
          setTimeout(() => {
            void deps.refreshSessionIndex()
          }, 0)
          const cwd = deps.resolveThreadCwd?.(threadId) ?? deps.resolveActiveCwd()
          deps.showSystemNotification(
            'notifyAgentStatus',
            'Agent complete',
            `OpenPi finished working${cwd ? ` in ${path.basename(cwd)}` : ''}.`
          )
          deps.playSoundEffect('soundAgentStatus')
          if (cwd) {
            void deps.getGitHost().then(async (git) => {
              try {
                const status = await git.getGitStatus(cwd)
                const files = status?.files ?? []
                if (files.length > 0) {
                  deps.getMainWindow()?.webContents.send(IPC.AGENT_CHANGED_FILES, {
                    count: files.length,
                    files,
                  })
                }
              } catch {
                // non-fatal — git may not be available in all workspaces
              }
            })
          }
        }

        if (event.type === 'extension_error') {
          deps.showSystemNotification(
            'notifyErrors',
            'OpenPi error',
            String(event.message ?? 'extension error')
          )
          deps.playSoundEffect('soundErrors')
        }

        if (event.type === 'auto_retry_end' && event.success === false) {
          deps.showSystemNotification(
            'notifyAgentStatus',
            'Agent needs attention',
            event.finalError ?? 'Auto-retry failed.'
          )
          deps.playSoundEffect('soundAgentStatus')
        }

        if (event.type === 'compaction_end' && event.errorMessage) {
          deps.showSystemNotification('notifyErrors', 'OpenPi error', event.errorMessage)
          deps.playSoundEffect('soundErrors')
        }

        return
      }

      case 'session_error':
        deps.getMainWindow()?.webContents.send(IPC.SESSION_ERROR, {
          threadId,
          error: { message: msg.message, ...(msg.code ? { code: msg.code } : {}) },
        })
        if (isForeground) {
          deps.showSystemNotification('notifyErrors', 'OpenPi error', msg.message)
          deps.playSoundEffect('soundErrors')
        }
        return

      case 'session_index_updated':
        if (isForeground) void deps.refreshSessionIndex()
        return

      case 'provider_login_event': {
        if (!isForeground) return
        const event = msg.event as { type?: string; url?: string }
        if (event.type === 'auth' && typeof event.url === 'string') {
          void shell.openExternal(event.url)
        }
        deps.getMainWindow()?.webContents.send(IPC.PROVIDER_LOGIN_EVENT, msg.event)
        return
      }

      case 'output_append':
        deps.emitOutputLine(msg.line as OutputLine)
        return

      case 'extension_ui_request':
        if (isForeground) {
          deps.getMainWindow()?.webContents.send(IPC.EXTENSION_UI_REQUEST, msg.request)
        }
        return

      case 'error':
        deps.getMainWindow()?.webContents.send(IPC.SESSION_ERROR, {
          threadId,
          error: { message: msg.message },
        })
        if (isForeground) {
          deps.showSystemNotification('notifyErrors', 'OpenPi error', msg.message)
          deps.playSoundEffect('soundErrors')
        }
        return

      default:
        return
    }
  }
}
