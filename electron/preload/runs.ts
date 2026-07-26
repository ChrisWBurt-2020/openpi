import { ipcRenderer } from 'electron'
import { IPC } from '../../src/lib/ipc'
import type { RunState } from '../../src/lib/runs'

export const runsApi = {
  getRun: (runId: string): Promise<RunState | null> =>
    ipcRenderer.invoke(IPC.RUN_GET, { runId, expectedStateVersion: 0 }),
  listRuns: (workspacePath?: string): Promise<RunState[]> =>
    ipcRenderer.invoke(IPC.RUN_LIST, { workspacePath }),
  pauseRun: (
    runId: string,
    mode: 'now' | 'after_tool',
    expectedStateVersion: number
  ): Promise<RunState> => ipcRenderer.invoke(IPC.RUN_PAUSE, { runId, mode, expectedStateVersion }),
  resumeRun: (runId: string, expectedStateVersion: number): Promise<RunState> =>
    ipcRenderer.invoke(IPC.RUN_RESUME, { runId, expectedStateVersion }),
  cancelRun: (runId: string, expectedStateVersion: number): Promise<RunState> =>
    ipcRenderer.invoke(IPC.RUN_CANCEL, { runId, expectedStateVersion }),
  answerRunInput: (
    runId: string,
    answer: string,
    expectedStateVersion: number
  ): Promise<RunState> =>
    ipcRenderer.invoke(IPC.RUN_ANSWER_INPUT, { runId, answer, expectedStateVersion }),
  acceptRunReview: (runId: string, expectedStateVersion: number): Promise<RunState> =>
    ipcRenderer.invoke(IPC.RUN_ACCEPT_REVIEW, { runId, expectedStateVersion }),
  requestRunChanges: (
    runId: string,
    text: string,
    expectedStateVersion: number
  ): Promise<RunState> =>
    ipcRenderer.invoke(IPC.RUN_REQUEST_CHANGES, { runId, text, expectedStateVersion }),
  resolveRunCheckoutConflict: (
    runId: string,
    strategy: 'queue' | 'cancel' | 'worktree',
    expectedStateVersion: number
  ): Promise<RunState> =>
    ipcRenderer.invoke(IPC.RUN_RESOLVE_CHECKOUT_CONFLICT, {
      runId,
      strategy,
      expectedStateVersion,
    }),
} as const
