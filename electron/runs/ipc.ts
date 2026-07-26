import type { IpcMain } from 'electron'
import { IPC } from '../../src/lib/ipc'
import {
  runAnswerInputSchema,
  runIdSchema,
  runListSchema,
  runPauseSchema,
  runRequestChangesSchema,
} from '../../src/lib/runs'
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
    const request = runPauseSchema.parse(raw)
    return requireManager(deps.getRunManager).pause(
      request.runId,
      request.mode,
      request.expectedStateVersion
    )
  })
  deps.ipcMain.handle(IPC.RUN_RESUME, (_event, raw: unknown) => {
    const request = runIdSchema.parse(raw)
    return requireManager(deps.getRunManager).resume(request.runId, request.expectedStateVersion)
  })
  deps.ipcMain.handle(IPC.RUN_CANCEL, (_event, raw: unknown) => {
    const request = runIdSchema.parse(raw)
    return requireManager(deps.getRunManager).cancel(request.runId, request.expectedStateVersion)
  })
  deps.ipcMain.handle(IPC.RUN_ANSWER_INPUT, (_event, raw: unknown) => {
    const request = runAnswerInputSchema.parse(raw)
    return requireManager(deps.getRunManager).answerInput(
      request.runId,
      request.answer,
      request.expectedStateVersion
    )
  })
  deps.ipcMain.handle(IPC.RUN_ACCEPT_REVIEW, (_event, raw: unknown) => {
    const request = runIdSchema.parse(raw)
    return requireManager(deps.getRunManager).acceptReview(
      request.runId,
      request.expectedStateVersion
    )
  })
  deps.ipcMain.handle(IPC.RUN_REQUEST_CHANGES, (_event, raw: unknown) => {
    const request = runRequestChangesSchema.parse(raw)
    return requireManager(deps.getRunManager).requestChanges(
      request.runId,
      request.text,
      request.expectedStateVersion
    )
  })
}
