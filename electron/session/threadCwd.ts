/**
 * ThreadCwdRegistry — modular per-thread working directory tracking.
 *
 * Each session/thread has its own cwd (project root, optional worktree path).
 * This registry is the single source of truth so that IPC handlers, Git ops,
 * PTY creation, and the sidecar all resolve to the correct directory.
 *
 * Phase 0: single active thread.
 * Future (Phase 2+): multiple threads for worktree mode & automations.
 */

export interface ThreadCwd {
  /** The project root directory (always the canonical repository root). */
  readonly root: string
  /**
   * Optional Git worktree path.
   * When set, tool execution (write, bash, git, terminal) targets this directory
   * instead of `root`. The agent still sees `root` as the "project".
   */
  worktreePath?: string | null
}

export class ThreadCwdRegistry {
  private _cwds = new Map<string, ThreadCwd>()
  private _activeId: string | null = null

  // ── Resolution ──────────────────────────────────────────

  /**
   * Resolve the effective working directory for a thread.
   * Returns the worktree path if set, otherwise the project root.
   * Defaults to the active thread when `threadId` is omitted.
   * @throws when the thread is unknown or no active thread exists.
   */
  resolve(threadId?: string): string {
    const id = this._resolveId(threadId)
    const entry = this._cwds.get(id)
    if (!entry) {
      throw new Error(`ThreadCwdRegistry: no entry for thread "${id}"`)
    }
    return entry.worktreePath ?? entry.root
  }

  /**
   * Safe variant — returns `null` instead of throwing.
   * Use in IPC handlers where a missing session is a valid "no project" state.
   */
  resolveSafe(threadId?: string): string | null {
    try {
      return this.resolve(threadId)
    } catch {
      return null
    }
  }

  /** Resolve the project root (ignoring worktree override). */
  resolveRoot(threadId?: string): string {
    const id = this._resolveId(threadId)
    const entry = this._cwds.get(id)
    if (!entry) {
      throw new Error(`ThreadCwdRegistry: no entry for thread "${id}"`)
    }
    return entry.root
  }

  // ── Mutation ────────────────────────────────────────────

  /** Register or overwrite a thread's cwd entry. */
  register(threadId: string, cwd: ThreadCwd): void {
    this._cwds.set(threadId, cwd)
  }

  /** Remove a thread's cwd entry. Clears active if it matches. */
  unregister(threadId: string): void {
    this._cwds.delete(threadId)
    if (this._activeId === threadId) {
      this._activeId = null
    }
  }

  /** Update specific fields of an existing entry (or create if missing with at least `root`). */
  update(threadId: string, partial: Partial<ThreadCwd> & { root?: string }): void {
    const existing = this._cwds.get(threadId)
    if (existing) {
      this._cwds.set(threadId, { ...existing, ...partial })
    } else {
      if (!partial.root) {
        throw new Error('ThreadCwdRegistry.update: `root` is required for a new entry')
      }
      this._cwds.set(threadId, partial as ThreadCwd)
    }
  }

  // ── Active thread management ───────────────────────────

  /** Set which thread is currently active (foreground). */
  setActive(threadId: string): void {
    this._activeId = threadId
  }

  /** Get the active thread id, or `null` if none. */
  getActive(): string | null {
    return this._activeId
  }

  /** Unset the active thread (no foreground session). */
  clearActive(): void {
    this._activeId = null
  }

  // ── Inspection ─────────────────────────────────────────

  has(threadId: string): boolean {
    return this._cwds.has(threadId)
  }

  get(threadId: string): ThreadCwd | undefined {
    return this._cwds.get(threadId)
  }

  /** Number of registered threads (for diagnostics). */
  get size(): number {
    return this._cwds.size
  }

  // ── Internal ────────────────────────────────────────────

  private _resolveId(threadId?: string): string {
    const id = threadId ?? this._activeId
    if (!id) {
      throw new Error('ThreadCwdRegistry: no threadId provided and no active thread')
    }
    return id
  }
}

/** Singleton used by the Electron main process. */
export const threadCwdRegistry = new ThreadCwdRegistry()
