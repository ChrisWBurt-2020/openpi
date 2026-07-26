import { ipcRenderer } from 'electron'
import type { ExtensionUiRequest, ExtensionUiResponse } from '../../src/lib/extensionUiTypes'
import type {
  ArtifactUpdate,
  RemoteSessionUpdate,
  SessionError,
  SessionEvent,
  SessionReady,
  ThreadSessionError,
  ThreadSessionEvent,
  ThreadSessionReady,
} from '../../src/lib/ipc'
import {
  IPC,
  sessionErrorSchema,
  sessionEventSchema,
  sessionReadySchema,
  threadSessionErrorSchema,
  threadSessionEventSchema,
  threadSessionReadySchema,
} from '../../src/lib/ipc'
import { type RunState, runStateSchema } from '../../src/lib/runs'

interface RemoteSessionStatusPayload {
  app: string
  status: string
  pid: number
  workspace?: string
  sessionFile?: string | null
}

export const eventsApi = {
  sendPrompt: (text: string): Promise<void> => ipcRenderer.invoke(IPC.SEND_PROMPT, { text }),

  onSessionReady: (cb: (payload: ThreadSessionReady) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: ThreadSessionReady | SessionReady) => {
      const scoped = threadSessionReadySchema.safeParse(payload)
      cb(
        scoped.success
          ? scoped.data
          : { threadId: 'legacy', ready: sessionReadySchema.parse(payload) }
      )
    }
    ipcRenderer.on(IPC.SESSION_READY, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_READY, handler)
  },

  onSessionEvent: (cb: (payload: ThreadSessionEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: ThreadSessionEvent | SessionEvent) => {
      const scoped = threadSessionEventSchema.safeParse(payload)
      if (scoped.success) {
        cb(scoped.data)
        return
      }
      const legacy = sessionEventSchema.safeParse(payload)
      if (legacy.success) cb({ threadId: 'legacy', event: legacy.data })
    }
    ipcRenderer.on(IPC.SESSION_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_EVENT, handler)
  },

  onSessionError: (cb: (payload: ThreadSessionError) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: ThreadSessionError | SessionError) => {
      const scoped = threadSessionErrorSchema.safeParse(payload)
      cb(
        scoped.success ? scoped.data : { threadId: null, error: sessionErrorSchema.parse(payload) }
      )
    }
    ipcRenderer.on(IPC.SESSION_ERROR, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_ERROR, handler)
  },

  onSessionIndexUpdated: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on(IPC.SESSION_INDEX_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_INDEX_UPDATED, handler)
  },

  onRunChanged: (cb: (state: RunState) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = runStateSchema.safeParse(payload)
      if (parsed.success) cb(parsed.data)
    }
    ipcRenderer.on(IPC.RUN_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.RUN_CHANGED, handler)
  },

  onRemoteSessionStatus: (cb: (payload: RemoteSessionStatusPayload) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: RemoteSessionStatusPayload) =>
      cb(payload)
    ipcRenderer.on(IPC.REMOTE_SESSION_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC.REMOTE_SESSION_STATUS, handler)
  },

  onRemoteSessionUpdate: (cb: (payload: RemoteSessionUpdate) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: RemoteSessionUpdate) => cb(payload)
    ipcRenderer.on(IPC.REMOTE_SESSION_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.REMOTE_SESSION_UPDATE, handler)
  },

  onArtifactUpdate: (cb: (payload: ArtifactUpdate) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: ArtifactUpdate) => cb(payload)
    ipcRenderer.on(IPC.ARTIFACT_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.ARTIFACT_UPDATE, handler)
  },

  onFileFindShortcut: (fn: () => void) => {
    const handler = () => fn()
    ipcRenderer.on(IPC.FILE_FIND_SHORTCUT, handler)
    return () => ipcRenderer.removeListener(IPC.FILE_FIND_SHORTCUT, handler)
  },

  onExtensionUiRequest: (cb: (request: ExtensionUiRequest) => void) => {
    const handler = (_: Electron.IpcRendererEvent, request: ExtensionUiRequest) => cb(request)
    ipcRenderer.on(IPC.EXTENSION_UI_REQUEST, handler)
    return () => ipcRenderer.removeListener(IPC.EXTENSION_UI_REQUEST, handler)
  },

  resolveExtensionUi: (response: ExtensionUiResponse): Promise<void> =>
    ipcRenderer.invoke(IPC.RESOLVE_EXTENSION_UI, response),
} as const
