import type { BrowserWindow, IpcMain } from 'electron'
import {
  connectionDraftSchema,
  connectionIdSchema,
  connectionProviderKeySchema,
  connectionTestResultSchema,
  connectionUpdateSchema,
  IPC,
  installRemoteRuntimeSchema,
  remoteDirectoryRequestSchema,
  remoteDirectorySchema,
  remoteProjectRequestSchema,
  remoteRuntimeCheckSchema,
  removeRemoteProjectSchema,
  setRemoteProjectModeSchema,
} from '../../src/lib/ipc'
import type { RemoteConnectionManager } from '../remote/connectionManager'
import type { SessionIndexStore } from '../session/sessionIndex'

interface RemoteIpcDeps {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  getSessionIndex: () => SessionIndexStore | null
  getRemoteConnections: () => RemoteConnectionManager | null
}

function requireConnections(deps: RemoteIpcDeps): RemoteConnectionManager {
  const manager = deps.getRemoteConnections()
  if (!manager) throw new Error('Remote connections are not ready')
  return manager
}

export function registerRemoteIpc(deps: RemoteIpcDeps): void {
  deps.ipcMain.handle(IPC.LIST_CONNECTIONS, () => requireConnections(deps).list())

  deps.ipcMain.handle(IPC.CREATE_CONNECTION, (_event, raw: unknown) => {
    const draft = connectionDraftSchema.parse(raw)
    return requireConnections(deps).create(draft)
  })

  deps.ipcMain.handle(IPC.UPDATE_CONNECTION, (_event, raw: unknown) => {
    const request = connectionUpdateSchema.parse(raw)
    const { id, ...draft } = request
    return requireConnections(deps).update(id, draft)
  })

  deps.ipcMain.handle(IPC.REMOVE_CONNECTION, async (_event, raw: unknown) => {
    const id = connectionIdSchema.parse(raw)
    await requireConnections(deps).remove(id)
  })

  deps.ipcMain.handle(IPC.TEST_CONNECTION, async (_event, raw: unknown) => {
    const id = connectionIdSchema.parse(raw)
    return connectionTestResultSchema.parse(await requireConnections(deps).test(id))
  })

  deps.ipcMain.handle(IPC.CONNECT_CONNECTION, async (_event, raw: unknown) => {
    const id = connectionIdSchema.parse(raw)
    await requireConnections(deps).connect(id)
  })

  deps.ipcMain.handle(IPC.DISCONNECT_CONNECTION, async (_event, raw: unknown) => {
    const id = connectionIdSchema.parse(raw)
    await requireConnections(deps).disconnect(id)
  })

  deps.ipcMain.handle(IPC.CHECK_REMOTE_RUNTIME, async (_event, raw: unknown) => {
    const id = connectionIdSchema.parse(raw)
    return remoteRuntimeCheckSchema.parse(await requireConnections(deps).checkRuntime(id))
  })

  deps.ipcMain.handle(IPC.INSTALL_REMOTE_RUNTIME, async (_event, raw: unknown) => {
    const request = installRemoteRuntimeSchema.parse(raw)
    await requireConnections(deps).installRuntime(request.connectionId)
  })

  deps.ipcMain.handle(IPC.LIST_REMOTE_DIRECTORIES, async (_event, raw: unknown) => {
    const request = remoteDirectoryRequestSchema.parse(raw)
    return (await requireConnections(deps).listDirectories(request.connectionId, request.path)).map(
      (entry) => remoteDirectorySchema.parse(entry)
    )
  })

  deps.ipcMain.handle(IPC.ADD_REMOTE_PROJECT, async (_event, raw: unknown) => {
    const request = remoteProjectRequestSchema.parse(raw)
    const manager = requireConnections(deps)
    const profile = manager.list().find((item) => item.id === request.connectionId)
    if (!profile) throw new Error('Remote connection was not found')
    const path = await manager.resolveProjectPath(request.connectionId, request.path)
    const store = deps.getSessionIndex()
    if (!store) throw new Error('Session index is not ready')
    const workspacePath = store.addRemoteWorkspace(
      request.connectionId,
      path,
      request.executionMode
    )
    deps.getMainWindow()?.webContents.send(IPC.SESSION_INDEX_UPDATED)
    return workspacePath
  })

  deps.ipcMain.handle(IPC.SET_REMOTE_PROJECT_MODE, (_event, raw: unknown) => {
    const request = setRemoteProjectModeSchema.parse(raw)
    const store = deps.getSessionIndex()
    if (!store?.getRemoteWorkspace(request.workspacePath))
      throw new Error('Remote project was not found')
    store.setRemoteWorkspaceMode(request.workspacePath, request.executionMode)
    deps.getMainWindow()?.webContents.send(IPC.SESSION_INDEX_UPDATED)
  })

  deps.ipcMain.handle(IPC.REMOVE_REMOTE_PROJECT, (_event, raw: unknown) => {
    const { workspacePath } = removeRemoteProjectSchema.parse(raw)
    const store = deps.getSessionIndex()
    if (!store?.getRemoteWorkspace(workspacePath)) throw new Error('Remote project was not found')
    store.removeRemoteWorkspace(workspacePath)
    deps.getMainWindow()?.webContents.send(IPC.SESSION_INDEX_UPDATED)
  })

  deps.ipcMain.handle(IPC.SET_CONNECTION_PROVIDER_KEY, (_event, raw: unknown) => {
    const request = connectionProviderKeySchema.parse(raw)
    return requireConnections(deps).setProviderKey(
      request.connectionId,
      request.providerId,
      request.apiKey
    )
  })

  deps.ipcMain.handle(IPC.REMOVE_CONNECTION_PROVIDER_KEY, (_event, raw: unknown) => {
    const request = connectionProviderKeySchema
      .pick({ connectionId: true, providerId: true })
      .parse(raw)
    requireConnections(deps).removeProviderKey(request.connectionId, request.providerId)
  })

  requireConnections(deps).onState((state) => {
    deps.getMainWindow()?.webContents.send(IPC.CONNECTION_STATUS_CHANGED, state)
  })
}
