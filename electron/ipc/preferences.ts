import type { IpcMain } from 'electron'
import { insightModeSchema } from '../../src/lib/insights'
import { getPrefSchema, IPC, setPrefSchema } from '../../src/lib/ipc'
import { setInsightMode } from '../session/sessionHost'

interface PreferencesIpcDeps {
  ipcMain: IpcMain
  getPref: (key: string) => string | null
  setPref: (key: string, value: string) => void
}

export function registerPreferencesIpc(deps: PreferencesIpcDeps): void {
  deps.ipcMain.handle(IPC.GET_PREF, (_event, raw: unknown): string | null => {
    const { key } = getPrefSchema.parse(raw)
    return deps.getPref(key)
  })

  deps.ipcMain.handle(IPC.SET_PREF, (_event, raw: unknown): void => {
    const { key, value } = setPrefSchema.parse(raw)
    deps.setPref(key, value)
    if (key === 'insights.mode') {
      const parsed = insightModeSchema.safeParse(value)
      if (parsed.success) setInsightMode(parsed.data)
    }
  })
}
