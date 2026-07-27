import type { RunState } from '../../src/lib/runs'
import type {
  CompanionEvidenceRef,
  CompanionOperationalState,
  ProjectHarnessProfile,
} from '../../src/lib/companion'

export type SourceKind = Exclude<CompanionOperationalState['kind'], 'idle'>

export interface CompanionSource {
  key: string
  kind: SourceKind
  phase?: 'planning' | 'executing' | 'verifying' | 'finalizing'
  reason?:
    | 'user_input'
    | 'approval'
    | 'paused'
    | 'checkout_busy'
    | 'rate_limited'
    | 'stalled'
    | 'budget_exhausted'
    | 'other'
  unknownReason?: 'transport' | 'supervisor' | 'stale'
  evidence: CompanionEvidenceRef
  openLoop: string | null
  version: number
}

export const companionPriority: Record<SourceKind, number> = {
  active: 1,
  review: 2,
  blocked: 3,
  unknown: 4,
  error: 5,
}

export function runSource(
  run: RunState,
  record: (evidence: CompanionEvidenceRef) => CompanionEvidenceRef
): CompanionSource | null {
  const at = run.updatedAt
  const evidence = (kind: CompanionEvidenceRef['kind'], label: string): CompanionEvidenceRef =>
    record({
      kind,
      id: run.id,
      runId: run.id,
      threadId: run.threadId ?? undefined,
      sessionPath: run.sessionPath ?? undefined,
      label,
      at,
      uri: `evidence://run/${run.id}/state/${run.stateVersion}`,
      available: true,
    })
  const key = `run:${run.id}`
  if (
    run.lifecycle === 'terminal' &&
    run.terminalReason === 'completed' &&
    run.reviewState !== 'ready'
  )
    return null
  if (run.lifecycle === 'terminal' && run.terminalReason === 'cancelled') return null
  if (run.lifecycle === 'terminal' && run.terminalReason === 'failed') {
    return {
      key,
      kind: 'error',
      evidence: evidence('error', 'Run failed'),
      openLoop: run.outcome?.summary ?? 'Inspect the failed Run',
      version: run.stateVersion,
    }
  }
  if (
    run.lifecycle === 'reconnecting' ||
    run.waitingReason === 'connection_lost' ||
    run.waitingReason === 'runner_unconfirmed'
  ) {
    return unknownSource(
      key,
      evidence('transport', 'Runner connection is unconfirmed'),
      run.stateVersion
    )
  }
  if (run.lifecycle === 'terminal' && run.terminalReason === 'blocked')
    return blockedSource(key, 'other', evidence('run', 'Run blocked'), run, run.stateVersion)
  if (run.reviewState === 'ready')
    return {
      key,
      kind: 'review',
      evidence: evidence('run', 'Run ready for review'),
      openLoop: 'Review the latest changes',
      version: run.stateVersion,
    }
  if (run.lifecycle === 'paused')
    return blockedSource(key, 'paused', evidence('run', 'Run paused'), run, run.stateVersion)
  if (run.lifecycle === 'waiting') return waitingSource(key, run, evidence, run.stateVersion)
  const phase = run.phase ?? (Object.keys(run.activeTools).length ? 'executing' : 'planning')
  return {
    key,
    kind: 'active',
    phase,
    evidence: evidence('run', `Run ${phase}`),
    openLoop: run.lastCheckpoint?.nextStep ?? null,
    version: run.stateVersion,
  }
}

export function operationalState(source: CompanionSource | undefined): CompanionOperationalState {
  const since = source?.evidence.at ?? new Date().toISOString()
  if (!source) return { kind: 'idle', since }
  if (source.kind === 'active')
    return {
      kind: 'active',
      phase: source.phase ?? 'executing',
      since,
      evidence: [source.evidence],
    }
  if (source.kind === 'blocked')
    return { kind: 'blocked', reason: source.reason ?? 'other', since, evidence: [source.evidence] }
  if (source.kind === 'unknown')
    return {
      kind: 'unknown',
      reason: source.unknownReason ?? 'stale',
      since,
      evidence: [source.evidence],
    }
  return { kind: source.kind, since, evidence: [source.evidence] }
}

export function attentionFor(
  state: CompanionOperationalState,
  evidence: CompanionEvidenceRef[],
  sourceRevision: number,
  acknowledged: number | null
) {
  if (state.kind === 'idle' || state.kind === 'active' || evidence.length === 0) return null
  const level = state.kind === 'review' ? 'informational' : 'action_required'
  const label = state.kind === 'blocked' ? `Blocked: ${state.reason.replace('_', ' ')}` : state.kind
  return {
    id: `${state.kind}:${evidence[0]?.uri ?? sourceRevision}`,
    level,
    label,
    sourceRevision,
    acknowledged: acknowledged === sourceRevision,
    evidence,
  }
}

export function actionsFor(state: CompanionOperationalState, evidenceUri: string | undefined) {
  if (state.kind === 'blocked' && state.reason === 'user_input')
    return [{ id: 'answer' as const, label: 'Answer', evidenceUri }]
  if (state.kind === 'review') return [{ id: 'review' as const, label: 'Review', evidenceUri }]
  if (state.kind === 'unknown' || state.kind === 'error')
    return [{ id: 'inspect_error' as const, label: 'Inspect', evidenceUri }]
  if (state.kind === 'blocked') return [{ id: 'resume' as const, label: 'Resolve', evidenceUri }]
  return [{ id: 'open_project' as const, label: 'Open Project', evidenceUri }]
}

export function spriteFor(
  profile: ProjectHarnessProfile,
  state: CompanionOperationalState,
  color: { accent: string; glow: string }
) {
  const clipId =
    state.kind === 'active'
      ? `active-${state.phase}`
      : state.kind === 'blocked'
        ? `blocked-${state.reason}`
        : state.kind
  return {
    packId: profile.appearance.petPackId,
    clipId,
    palette: { accent: color.accent, signal: color.accent, alert: color.glow },
    accessory: profile.appearance.accessory,
  }
}

export function projectName(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || projectPath
}

function waitingSource(
  key: string,
  run: RunState,
  evidence: (kind: CompanionEvidenceRef['kind'], label: string) => CompanionEvidenceRef,
  version: number
): CompanionSource {
  const reason = run.waitingReason
  if (reason === 'connection_lost' || reason === 'runner_unconfirmed')
    return unknownSource(key, evidence('transport', 'Runner connection is unconfirmed'), version)
  const mapped =
    reason === 'user_input' ||
    reason === 'approval' ||
    reason === 'checkout_busy' ||
    reason === 'rate_limited' ||
    reason === 'stalled'
      ? reason
      : 'budget_exhausted'
  return blockedSource(
    key,
    mapped,
    evidence('run', `Run waiting: ${mapped.replace('_', ' ')}`),
    run,
    version
  )
}

function blockedSource(
  key: string,
  reason: CompanionSource['reason'],
  evidence: CompanionEvidenceRef,
  run: RunState,
  version: number
): CompanionSource {
  return {
    key,
    kind: 'blocked',
    reason,
    evidence,
    openLoop:
      run.pendingInput?.question ??
      run.pendingApproval?.summary ??
      run.outcome?.summary ??
      `Resolve ${reason?.replace('_', ' ') ?? 'blocker'}`,
    version,
  }
}

function unknownSource(
  key: string,
  evidence: CompanionEvidenceRef,
  version: number
): CompanionSource {
  return {
    key,
    kind: 'unknown',
    unknownReason: 'transport',
    evidence,
    openLoop: 'Inspect transport before resuming',
    version,
  }
}
