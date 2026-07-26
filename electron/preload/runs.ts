import { ipcRenderer } from 'electron'
import { IPC } from '../../src/lib/ipc'
import type { RunState } from '../../src/lib/runs'

export const runsApi = {
  getRun: (runId: string): Promise<RunState | null> =>
    ipcRenderer.invoke(IPC.RUN_GET, { runId, expectedStateVersion: 0 }),
  listRuns: (workspacePath?: string): Promise<RunState[]> =>
    ipcRenderer.invoke(IPC.RUN_LIST, { workspacePath }),
  pauseRun: (runId: string, expectedStateVersion: number): Promise<RunState> =>
    ipcRenderer.invoke(IPC.RUN_PAUSE, { runId, expectedStateVersion }),
  resumeRun: (runId: string, expectedStateVersion: number): Promise<RunState> =>
    ipcRenderer.invoke(IPC.RUN_RESUME, { runId, expectedStateVersion }),
  cancelRun: (runId: string, expectedStateVersion: number): Promise<RunState> =>
    ipcRenderer.invoke(IPC.RUN_CANCEL, { runId, expectedStateVersion }),
} as const
