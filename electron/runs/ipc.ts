import type { IpcMain } from 'electron'
import { IPC } from '../../src/lib/ipc'
import { runIdSchema, runListSchema } from '../../src/lib/runs'
import type { RunManager } from './manager'

interface RunsIpcDeps {
  ipcMain: IpcMain
  getRunManager: () => RunManager | null
}

function requireManager(getRunManager: () => RunManager | null): RunManager {
  const manager = getRunManager()
  if (!manager) throw new Error('Run orchestration is not ready.')
  return manager
}

export function registerRunsIpc(deps: RunsIpcDeps): void {
  deps.ipcMain.handle(IPC.RUN_LIST, (_event, raw: unknown) => {
    const request = runListSchema.parse(raw)
    return requireManager(deps.getRunManager).list(request?.workspacePath)
  })
  deps.ipcMain.handle(IPC.RUN_GET, (_event, raw: unknown) => {
    const { runId } = runIdSchema.parse(raw)
    return (
      requireManager(deps.getRunManager)
        .list()
        .find((state) => state.id === runId) ?? null
    )
  })
  deps.ipcMain.handle(IPC.RUN_PAUSE, (_event, raw: unknown) => {
    const request = runIdSchema.parse(raw)
    return requireManager(deps.getRunManager).pause(request.runId, request.expectedStateVersion)
  })
  deps.ipcMain.handle(IPC.RUN_RESUME, (_event, raw: unknown) => {
    const request = runIdSchema.parse(raw)
    return requireManager(deps.getRunManager).resume(request.runId, request.expectedStateVersion)
  })
  deps.ipcMain.handle(IPC.RUN_CANCEL, (_event, raw: unknown) => {
    const request = runIdSchema.parse(raw)
    return requireManager(deps.getRunManager).cancel(request.runId, request.expectedStateVersion)
  })
}
