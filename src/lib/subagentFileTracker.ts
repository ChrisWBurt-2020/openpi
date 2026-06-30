/**
 * SubagentFileTracker — pure state container for legacy task artifacts.
 *
 * The current pi-task integration uses `.pi/task-session-history.json`
 * plus sub-session JSONL. This tracker remains for compatibility with
 * older artifact payloads but no longer reads TASKS markdown.
 */
import type { SubagentArtifact } from './ipc/_full'

export class SubagentFileTracker {
  private byId = new Map<string, SubagentArtifact>()

  snapshot(): SubagentArtifact[] {
    return [...this.byId.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Apply a full update payload from the watcher. */
  apply(artifacts: SubagentArtifact[]): boolean {
    const next = new Map<string, SubagentArtifact>()
    for (const a of artifacts) next.set(a.id, a)
    if (sameMap(next, this.byId)) return false
    this.byId = next
    return true
  }

  get(id: string): SubagentArtifact | undefined {
    return this.byId.get(id)
  }

  clear(): void {
    this.byId.clear()
  }
}

function sameMap(a: Map<string, SubagentArtifact>, b: Map<string, SubagentArtifact>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) {
    const other = b.get(k)
    if (!other) return false
    if (other.status !== v.status) return false
    if (other.result !== v.result) return false
    if (other.context !== v.context) return false
    if (other.completedAt !== v.completedAt) return false
  }
  return true
}
