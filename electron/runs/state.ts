import { randomUUID } from 'node:crypto'
import type { ProjectExecutionMode, RunState } from '../../src/lib/runs'
import { runStateSchema } from '../../src/lib/runs'
import { checkoutIdentity } from './identity'

const MAX_CONTINUATIONS = 3

export interface CreateRunInput {
  threadId: string
  sessionPath: string | null
  workspacePath: string
  text?: string
  contextRefs?: string[]
  executionMode?: ProjectExecutionMode
  modelId?: string
  providerId?: string
  thinkingLevel?: string | null
}

export function timestamp(): string {
  return new Date().toISOString()
}

function remoteConnectionId(workspacePath: string): string | null {
  if (!workspacePath.startsWith('ssh://')) return null
  try {
    const value = new URL(workspacePath).hostname
    return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? value : null
  } catch {
    return null
  }
}

function executionModeFor(
  workspacePath: string,
  executionMode?: ProjectExecutionMode
): ProjectExecutionMode {
  if (executionMode) return executionMode
  return workspacePath.startsWith('ssh://') ? 'ssh-workspace' : 'local'
}

export function createRunState(input: CreateRunInput): RunState {
  const createdAt = timestamp()
  const checkoutId = checkoutIdentity(input.workspacePath)
  const executionMode = executionModeFor(input.workspacePath, input.executionMode)
  return {
    id: randomUUID(),
    projectId: null,
    threadId: input.threadId,
    openPiThreadId: input.threadId,
    piSessionId: null,
    sessionPath: input.sessionPath,
    sessionLeafId: null,
    executionMode,
    workspacePath: input.workspacePath,
    workspace: {
      hostId: input.workspacePath.startsWith('ssh://') ? 'ssh' : 'local',
      connectionId: remoteConnectionId(input.workspacePath),
      workspacePath: input.workspacePath,
      checkoutId,
      worktreePath: null,
      branch: null,
      headSha: null,
      dirtyAtStart: false,
    },
    contract: {
      version: 1,
      originalInput: {
        text: input.text ?? '[Run started without a recoverable original prompt.]',
        attachmentRefs: [],
        contextRefs: input.contextRefs ?? [],
        mentionRefs: [],
      },
      acceptanceCriteria: [],
      constraints: [],
      modelId: input.modelId ?? 'unknown',
      providerId: input.providerId ?? 'unknown',
      thinkingLevel: input.thinkingLevel ?? null,
      permissionProfileId: 'openpi-default',
      sandboxProfileId: null,
      createdAt,
      revisions: [
        { version: 1, source: 'initial', text: input.text ?? '[Run started]', createdAt },
      ],
    },
    runEpoch: 1,
    stateVersion: 1,
    lastEventSequence: 1,
    lifecycle: 'starting',
    phase: 'planning',
    waitingReason: null,
    terminalReason: null,
    reviewState: 'not_applicable',
    activeTurnId: null,
    hasPendingPiQueue: false,
    pauseAfterCurrentTool: false,
    activeTools: {},
    contractVersion: 1,
    lastContinuationId: null,
    continuationCountThisCycle: 0,
    continuationCountTotal: 0,
    maxContinuationsThisCycle: MAX_CONTINUATIONS,
    lastProgressFingerprint: null,
    repeatedNoProgressCount: 0,
    startedAt: createdAt,
    updatedAt: createdAt,
    lastEventAt: createdAt,
    lastMeaningfulProgressAt: createdAt,
    outcome: null,
    lastCheckpoint: null,
    observedEvidence: { changedFiles: [], diffHash: null, commands: [], checks: [] },
    pendingInput: null,
    pendingApproval: null,
    supervisor: null,
    recoveryNotice: null,
  }
}

/** Existing experimental records have no complete contract; retain them only as paused recovery state. */
export function migrateRunState(value: unknown): RunState | null {
  const current = runStateSchema.safeParse(value)
  if (current.success) return current.data
  if (!value || typeof value !== 'object') return null
  const legacy = value as Record<string, unknown>
  if (legacy.contract && typeof legacy.contract === 'object') {
    const upgraded = runStateSchema.safeParse({
      ...legacy,
      hasPendingPiQueue: legacy.hasPendingPiQueue === true,
      pauseAfterCurrentTool: legacy.pauseAfterCurrentTool === true,
      lastProgressFingerprint:
        typeof legacy.lastProgressFingerprint === 'string' ? legacy.lastProgressFingerprint : null,
      repeatedNoProgressCount:
        typeof legacy.repeatedNoProgressCount === 'number' ? legacy.repeatedNoProgressCount : 0,
    })
    if (upgraded.success) return upgraded.data
  }
  const threadId = typeof legacy.threadId === 'string' ? legacy.threadId : null
  const workspacePath = typeof legacy.workspacePath === 'string' ? legacy.workspacePath : null
  const id = typeof legacy.id === 'string' ? legacy.id : null
  if (!threadId || !workspacePath || !id) return null
  const state = createRunState({
    threadId,
    sessionPath: typeof legacy.sessionPath === 'string' ? legacy.sessionPath : null,
    workspacePath,
    text: '[Recovered experimental Run: inspect the current workspace before continuing.]',
  })
  return {
    ...state,
    id,
    lifecycle: 'paused',
    phase: null,
    recoveryNotice: 'This experimental Run was migrated safely and requires an explicit Resume.',
  }
}
