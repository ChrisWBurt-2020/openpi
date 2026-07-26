import { randomUUID } from 'node:crypto'
import type { IpcMain } from 'electron'
import {
  IPC,
  insightDismissedRequestSchema,
  listInsightStateRequestSchema,
  listSavedInsightsRequestSchema,
  removeSavedInsightRequestSchema,
  saveInsightRequestSchema,
} from '../../src/lib/ipc'
import type { SessionIndexStore } from '../session/sessionIndex'

interface InsightsIpcDeps {
  ipcMain: IpcMain
  getSessionIndex: () => SessionIndexStore | null
}

export function registerInsightsIpc(deps: InsightsIpcDeps): void {
  const requireStore = () => {
    const store = deps.getSessionIndex()
    if (!store) throw new Error('OpenPi session index is not ready')
    return store
  }

  deps.ipcMain.handle(IPC.LIST_SAVED_INSIGHTS, (_event, raw: unknown) => {
    const { workspacePath } = listSavedInsightsRequestSchema.parse(raw)
    return requireStore().listSavedInsights(workspacePath)
  })
  deps.ipcMain.handle(IPC.SAVE_INSIGHT, (_event, raw: unknown) => {
    const payload = saveInsightRequestSchema.parse(raw)
    return requireStore().saveInsight({ ...payload, id: randomUUID() })
  })
  deps.ipcMain.handle(IPC.REMOVE_SAVED_INSIGHT, (_event, raw: unknown) => {
    requireStore().removeSavedInsight(removeSavedInsightRequestSchema.parse(raw).id)
  })
  deps.ipcMain.handle(IPC.LIST_INSIGHT_STATE, (_event, raw: unknown) => {
    return requireStore().getInsightState(listInsightStateRequestSchema.parse(raw).sessionPath)
  })
  deps.ipcMain.handle(IPC.SET_INSIGHT_DISMISSED, (_event, raw: unknown) => {
    const payload = insightDismissedRequestSchema.parse(raw)
    requireStore().setInsightDismissed(payload.sessionPath, payload.toolCallId, payload.dismissed)
  })
}
