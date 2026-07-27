import {
  type CompanionEvidenceRef,
  type CompanionSignal,
  type CompanionState,
  type CompanionStateByProject,
  companionColor,
  type ProjectCompanionProfile,
} from '../../src/lib/companion'
import type { AgentReviewChange } from '../../src/lib/ipc'
import type { RunState } from '../../src/lib/runs'
import { CompanionStore } from './companionStore'

type SourceKind = Exclude<CompanionState['kind'], 'idle'>
interface Source {
  kind: SourceKind
  evidence: CompanionEvidenceRef
  since: string
}

const priority: Record<SourceKind, number> = { active: 1, review: 2, blocked: 3, error: 4 }

export class CompanionHost {
  private readonly sources = new Map<string, Map<string, Source>>()
  private readonly profiles = new Map<string, ProjectCompanionProfile>()
  private readonly listeners = new Set<(profiles: CompanionStateByProject) => void>()
  private readonly pins = new Set<string>()

  constructor(private readonly store?: CompanionStore) {}

  subscribe(listener: (profiles: CompanionStateByProject) => void): () => void {
    this.listeners.add(listener)
    listener(this.list())
    return () => this.listeners.delete(listener)
  }

  list(): CompanionStateByProject {
    return Object.fromEntries(this.profiles.entries())
  }

  ensure(projectPath: string, displayName: string): void {
    if (this.profiles.has(projectPath)) return
    const now = new Date().toISOString()
    const durable = this.store?.ensureProfile(projectPath, displayName)
    const color = durable?.appearance.accentOverride ?? companionColor(projectPath)
    this.profiles.set(projectPath, {
      projectPath,
      displayName: durable?.displayName ?? displayName,
      color,
      state: { kind: 'idle', since: now },
      updatedAt: now,
      pinned: durable?.appearance.pinned ?? this.pins.has(projectPath),
    })
    if (durable?.appearance.pinned) this.pins.add(projectPath)
    this.publish()
  }

  setPinned(projectPath: string, pinned: boolean): void {
    if (pinned) this.pins.add(projectPath)
    else this.pins.delete(projectPath)
    const profile = this.profiles.get(projectPath)
    const durable = this.store?.findProfileByPath(projectPath)
    if (durable)
      this.store?.updateProfile({
        projectId: durable.projectId,
        expectedRevision: durable.revision,
        patch: { appearance: { ...durable.appearance, pinned } },
      })
    if (profile)
      this.profiles.set(projectPath, { ...profile, pinned, updatedAt: new Date().toISOString() })
    this.publish()
  }

  apply(signal: CompanionSignal): void {
    const sources = this.sources.get(signal.projectPath) ?? new Map<string, Source>()
    this.sources.set(signal.projectPath, sources)
    switch (signal.type) {
      case 'activity_started':
        sources.set(
          `activity:${signal.evidence.threadId ?? signal.evidence.id}`,
          source('active', this.persistEvidence(signal.projectPath, signal.evidence))
        )
        break
      case 'activity_stopped':
        sources.delete(`activity:${signal.threadId}`)
        break
      case 'review_pending':
        sources.set(`review:${signal.evidence.id}`, source('review', this.persistEvidence(signal.projectPath, signal.evidence)))
        break
      case 'review_cleared':
        sources.delete(`review:${signal.id}`)
        break
      case 'blocked':
        sources.set(`blocked:${signal.evidence.id}`, source('blocked', this.persistEvidence(signal.projectPath, signal.evidence)))
        break
      case 'unblocked':
        sources.delete(`blocked:${signal.id}`)
        break
      case 'error':
        sources.set(`error:${signal.evidence.id}`, source('error', this.persistEvidence(signal.projectPath, signal.evidence)))
        break
      case 'recovered':
        sources.delete(`error:${signal.id}`)
        break
      default: {
        const exhaustive: never = signal
        void exhaustive
        break
      }
    }
    this.recompute(signal.projectPath)
  }

  syncReview(projectPath: string, changes: AgentReviewChange[]): void {
    const sources = this.sources.get(projectPath) ?? new Map<string, Source>()
    this.sources.set(projectPath, sources)
    for (const key of [...sources.keys()]) if (key.startsWith('review:')) sources.delete(key)
    for (const change of changes) {
      const at = new Date(change.createdAt).toISOString()
      sources.set(
        `review:${change.id}`,
        source('review', this.persistEvidence(projectPath, {
          kind: 'review',
          id: change.id,
          label: `Review ${change.path}`,
          at,
          toolCallId: change.toolCallId,
        }))
      )
    }
    this.recompute(projectPath)
  }

  syncRun(run: RunState): void {
    const projectPath = run.workspacePath
    const sources = this.sources.get(projectPath) ?? new Map<string, Source>()
    this.sources.set(projectPath, sources)
    for (const key of [...sources.keys()]) if (key.endsWith(`:${run.id}`)) sources.delete(key)
    const at = run.updatedAt
    const ref = (kind: CompanionEvidenceRef['kind'], label: string): CompanionEvidenceRef => this.persistEvidence(projectPath, ({
      kind,
      id: run.id,
      runId: run.id,
      label,
      at,
      threadId: run.threadId ?? undefined,
      sessionPath: run.sessionPath ?? undefined,
    }))
    if (run.lifecycle === 'terminal' && run.terminalReason === 'failed')
      sources.set(`error:${run.id}`, source('error', ref('error', 'Run failed')))
    else if (run.lifecycle === 'terminal' && run.terminalReason === 'blocked')
      sources.set(`blocked:${run.id}`, source('blocked', ref('run', 'Run blocked')))
    else if (run.reviewState === 'ready')
      sources.set(`review:${run.id}`, source('review', ref('run', 'Run ready for review')))
    else if (
      run.lifecycle === 'waiting' &&
      [
        'user_input',
        'approval',
        'checkout_busy',
        'stalled',
        'continuation_budget_exhausted',
      ].includes(run.waitingReason ?? '')
    )
      sources.set(
        `blocked:${run.id}`,
        source('blocked', ref('run', `Run waiting: ${run.waitingReason}`))
      )
    else if (run.lifecycle !== 'terminal')
      sources.set(`activity:${run.threadId ?? run.id}`, source('active', ref('run', 'Run active')))
    this.recompute(projectPath)
  }

  private recompute(projectPath: string): void {
    const profile = this.profiles.get(projectPath)
    if (!profile) return
    const values = [...(this.sources.get(projectPath)?.values() ?? [])]
    const top = values.sort((a, b) => priority[b.kind] - priority[a.kind])[0]
    const state: CompanionState = top
      ? {
          kind: top.kind,
          since: top.since,
          evidence: values
            .filter((item) => item.kind === top.kind)
            .slice(0, 8)
            .map((item) => item.evidence),
        }
      : { kind: 'idle', since: new Date().toISOString() }
    this.profiles.set(projectPath, {
      ...profile,
      state,
      pinned: this.pins.has(projectPath),
      updatedAt: new Date().toISOString(),
    })
    this.publish()
  }

  private publish(): void {
    const profiles = this.list()
    for (const listener of this.listeners) listener(profiles)
  }

  private persistEvidence(projectPath: string, evidence: CompanionEvidenceRef): CompanionEvidenceRef {
    const profile = this.store?.ensureProfile(projectPath, pathName(projectPath))
    if (!profile) return evidence
    const sourceType = evidence.kind === 'error' ? 'error' : evidence.kind === 'run' ? 'run' : evidence.kind
    const uri = evidence.uri ?? `evidence://${sourceType}/${encodeURIComponent(evidence.id)}`
    this.store?.registerEvidence({
      uri,
      projectId: profile.projectId,
      sourceType,
      sourceVersion: evidence.at,
      label: evidence.label,
      createdAt: evidence.at,
      available: true,
    })
    return { ...evidence, uri, available: true }
  }
}

function pathName(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1) || projectPath
}

function source(kind: SourceKind, evidence: CompanionEvidenceRef): Source {
  return { kind, evidence, since: evidence.at }
}
