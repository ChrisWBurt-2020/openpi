import { ipcRenderer } from 'electron'
import type {
  ConnectionDraft,
  ConnectionProfile,
  ConnectionState,
  ConnectionTestResult,
  ProjectExecutionMode,
  RemoteDirectory,
  RemoteRuntimeCheck,
} from '../../src/lib/ipc'
import { IPC } from '../../src/lib/ipc'

export const remoteApi = {
  connections: {
    list: (): Promise<ConnectionProfile[]> => ipcRenderer.invoke(IPC.LIST_CONNECTIONS),
    create: (draft: ConnectionDraft): Promise<ConnectionProfile> =>
      ipcRenderer.invoke(IPC.CREATE_CONNECTION, draft),
    update: (id: string, draft: ConnectionDraft): Promise<ConnectionProfile> =>
      ipcRenderer.invoke(IPC.UPDATE_CONNECTION, { id, ...draft }),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.REMOVE_CONNECTION, id),
    test: (id: string): Promise<ConnectionTestResult> =>
      ipcRenderer.invoke(IPC.TEST_CONNECTION, id),
    connect: (id: string): Promise<void> => ipcRenderer.invoke(IPC.CONNECT_CONNECTION, id),
    disconnect: (id: string): Promise<void> => ipcRenderer.invoke(IPC.DISCONNECT_CONNECTION, id),
    setProviderKey: (connectionId: string, providerId: string, apiKey: string): Promise<void> =>
      ipcRenderer.invoke(IPC.SET_CONNECTION_PROVIDER_KEY, { connectionId, providerId, apiKey }),
    removeProviderKey: (connectionId: string, providerId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.REMOVE_CONNECTION_PROVIDER_KEY, { connectionId, providerId }),
    onStatus: (callback: (state: ConnectionState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: ConnectionState) =>
        callback(state)
      ipcRenderer.on(IPC.CONNECTION_STATUS_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC.CONNECTION_STATUS_CHANGED, listener)
    },
  },
  remote: {
    checkRuntime: (connectionId: string): Promise<RemoteRuntimeCheck> =>
      ipcRenderer.invoke(IPC.CHECK_REMOTE_RUNTIME, connectionId),
    installRuntime: (connectionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.INSTALL_REMOTE_RUNTIME, {
        connectionId,
        installPi: true,
        installHelper: true,
      }),
    listDirectories: (connectionId: string, path?: string): Promise<RemoteDirectory[]> =>
      ipcRenderer.invoke(IPC.LIST_REMOTE_DIRECTORIES, { connectionId, path }),
    addProject: (
      connectionId: string,
      path: string,
      executionMode: Extract<
        ProjectExecutionMode,
        'ssh-workspace' | 'persistent-runner'
      > = 'ssh-workspace'
    ): Promise<string> =>
      ipcRenderer.invoke(IPC.ADD_REMOTE_PROJECT, { connectionId, path, executionMode }),
    setProjectMode: (
      workspacePath: string,
      executionMode: Extract<ProjectExecutionMode, 'ssh-workspace' | 'persistent-runner'>
    ): Promise<void> =>
      ipcRenderer.invoke(IPC.SET_REMOTE_PROJECT_MODE, { workspacePath, executionMode }),
    removeProject: (workspacePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.REMOVE_REMOTE_PROJECT, { workspacePath }),
  },
} as const
