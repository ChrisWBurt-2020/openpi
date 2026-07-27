import type { AgentReviewChange } from '../../src/lib/ipc'
import type { RunState } from '../../src/lib/runs'
import {
  companionColor,
  type CompanionEvidenceRef,
  type ProjectHarnessProfile,
} from '../../src/lib/companion'
import {
  companionProjectViewSchema,
  type CompanionProjectView,
  type CompanionViews,
} from '../../src/lib/companionView'
import type { CompanionStore } from './companionStore'
import {
  actionsFor,
  attentionFor,
  companionPriority,
  operationalState,
  projectName,
  runSource,
  spriteFor,
  type CompanionSource,
} from './companionReduction'

/** Main-owned projector. It converts durable Run/session/review receipts into display snapshots. */
export class CompanionProjector {
  private readonly sources = new Map<string, Map<string, CompanionSource>>()
  private readonly views = new Map<string, CompanionProjectView>()
  private readonly runVersions = new Map<string, number>()
  private readonly listeners = new Set<(views: CompanionViews) => void>()

  constructor(private readonly store: CompanionStore) {}

  subscribe(listener: (views: CompanionViews) => void): () => void {
    this.listeners.add(listener)
    listener(this.list())
    return () => this.listeners.delete(listener)
  }

  list(): CompanionViews {
    return Object.fromEntries(this.views.entries())
  }

  byPath(projectPath: string): CompanionProjectView | null {
    const profile = this.store.findProfileByPath(projectPath)
    return profile ? (this.views.get(profile.projectId) ?? null) : null
  }

  ensure(projectPath: string, displayName: string): CompanionProjectView {
    const profile = this.store.ensureProfile(projectPath, displayName)
    const current = this.views.get(profile.projectId)
    if (current) return current
    return this.recompute(profile)
  }

  rehydrate(runs: RunState[]): void {
    for (const profile of this.store.listProfiles()) this.recompute(profile)
    for (const run of runs) this.syncRun(run)
  }

  syncRun(run: RunState): void {
    const profile = this.store.ensureProfile(run.workspacePath, projectName(run.workspacePath))
    const previous = this.runVersions.get(run.id)
    if (previous !== undefined && previous > run.stateVersion) return
    this.runVersions.set(run.id, run.stateVersion)
    const sources = this.sourceMap(profile.projectId)
    const next = runSource(run, (evidence) => this.recordEvidence(profile, evidence))
    if (next) sources.set(next.key, next)
    else sources.delete(`run:${run.id}`)
    this.recompute(profile)
  }

  syncReview(projectPath: string, changes: AgentReviewChange[]): void {
    const profile = this.store.ensureProfile(projectPath, projectName(projectPath))
    const sources = this.sourceMap(profile.projectId)
    for (const key of [...sources.keys()]) if (key.startsWith('review:')) sources.delete(key)
    for (const change of changes) {
      const at = new Date(change.createdAt).toISOString()
      const evidence = this.recordEvidence(profile, {
        kind: 'review',
        id: change.id,
        label: `Review ${change.path}`,
        at,
        toolCallId: change.toolCallId,
        uri: `evidence://review/${encodeURIComponent(change.id)}/diff`,
        available: true,
      })
      sources.set(`review:${change.id}`, {
        key: `review:${change.id}`,
        kind: 'review',
        evidence,
        openLoop: `Review ${change.path}`,
        version: Date.parse(at),
      })
    }
    this.recompute(profile)
  }

  setSessionActivity(projectPath: string, threadId: string, active: boolean, error?: string): void {
    const profile = this.store.ensureProfile(projectPath, projectName(projectPath))
    const sources = this.sourceMap(profile.projectId)
    const key = `session:${threadId}`
    if (!active && !error) sources.delete(key)
    else {
      const at = new Date().toISOString()
      const evidence = this.recordEvidence(profile, {
        kind: error ? 'error' : 'session',
        id: threadId,
        threadId,
        label: error ?? 'Agent working',
        at,
        uri: `evidence://${error ? 'error' : 'session'}/${encodeURIComponent(threadId)}/state/${Date.now()}`,
        available: true,
      })
      sources.set(key, {
        key,
        kind: error ? 'error' : 'active',
        phase: 'executing',
        evidence,
        openLoop: error ?? null,
        version: Date.now(),
      })
    }
    this.recompute(profile)
  }

  acknowledge(projectId: string): void {
    const view = this.views.get(projectId)
    if (!view?.attention) return
    const result = this.store.updateProfile({
      projectId,
      expectedRevision: view.profile.revision,
      patch: { acknowledgedAttentionRevision: view.attention.sourceRevision },
    })
    if (result.status === 'updated') this.recompute(result.profile)
  }

  setPinned(projectPath: string, pinned: boolean): void {
    const view = this.byPath(projectPath)
    if (!view) return
    this.updateProfile(view.projectId, view.profile.revision, {
      appearance: { ...view.profile.appearance, pinned },
    })
  }

  setPlacement(
    projectPath: string,
    placement: ProjectHarnessProfile['appearance']['placement']
  ): void {
    const view = this.byPath(projectPath)
    if (!view) return
    this.updateProfile(view.projectId, view.profile.revision, {
      appearance: { ...view.profile.appearance, placement },
    })
  }

  updateProfile(
    projectId: string,
    expectedRevision: number,
    patch: Parameters<CompanionStore['updateProfile']>[0]['patch']
  ): ProjectHarnessProfile | null {
    const result = this.store.updateProfile({ projectId, expectedRevision, patch })
    if (result.status !== 'updated') return null
    this.recompute(result.profile)
    return result.profile
  }

  private recompute(profile: ProjectHarnessProfile): CompanionProjectView {
    const values = [...(this.sources.get(profile.projectId)?.values() ?? [])]
    const top = values.sort(
      (left, right) =>
        companionPriority[right.kind] - companionPriority[left.kind] || right.version - left.version
    )[0]
    const state = operationalState(top)
    const evidence = top
      ? values
          .filter((item) => item.kind === top.kind)
          .slice(0, 8)
          .map((item) => item.evidence)
      : []
    const sourceRevision = top?.version ?? 0
    const attention = attentionFor(
      state,
      evidence,
      sourceRevision,
      profile.acknowledgedAttentionRevision
    )
    const previous = this.views.get(profile.projectId)
    const view = companionProjectViewSchema.parse({
      projectId: profile.projectId,
      projectPath: profile.projectPath,
      revision: (previous?.revision ?? 0) + 1,
      profile,
      state,
      attention,
      activity: {
        openLoop: top?.openLoop ?? null,
        actions: actionsFor(state, evidence[0]?.uri),
        evidenceCount: evidence.length,
      },
      sprite: spriteFor(
        profile,
        state,
        profile.appearance.accentOverride ?? companionColor(profile.projectPath)
      ),
      evidence,
      updatedAt: new Date().toISOString(),
    })
    this.views.set(profile.projectId, view)
    this.publish()
    return view
  }

  private sourceMap(projectId: string): Map<string, CompanionSource> {
    const existing = this.sources.get(projectId)
    if (existing) return existing
    const created = new Map<string, CompanionSource>()
    this.sources.set(projectId, created)
    return created
  }

  private recordEvidence(
    profile: ProjectHarnessProfile,
    evidence: CompanionEvidenceRef
  ): CompanionEvidenceRef {
    const uri =
      evidence.uri ?? `evidence://${evidence.kind}/${encodeURIComponent(evidence.id)}/state/0`
    const sourceType =
      evidence.kind === 'error' ? 'error' : evidence.kind === 'run' ? 'run' : evidence.kind
    this.store.registerEvidence({
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

  private publish(): void {
    const views = this.list()
    for (const listener of this.listeners) listener(views)
  }
}
