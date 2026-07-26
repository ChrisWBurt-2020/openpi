/**
 * sidecarPool.ts — one Pi worker per live thread (ADR-006).
 *
 * The sidecar used to be a singleton, so opening a thread disposed the last
 * one. Concurrency means several workers alive at once, addressed by thread id.
 *
 * The policy lives here rather than in the Electron wiring, and the worker type
 * is a generic, so the rules below are testable without spawning a process.
 *
 * The rule that matters: **a running thread is never evicted to make room.**
 * When every worker is busy the pool refuses to spawn and says so. Killing
 * someone's in-flight work to satisfy a click is the precise failure this
 * product exists to prevent.
 */

export interface PoolOptions<W> {
  /** Create a worker for a thread. Called only when one isn't already live. */
  spawn: (threadId: string) => W
  /** Tear a worker down. Must tolerate being called on an already-dead worker. */
  dispose: (worker: W, threadId: string) => void
  /** Live worker cap. Memory is the binding constraint: each loads the Pi SDK. */
  maxLive: number
  /** Injectable clock, for LRU ordering in tests. */
  now?: () => number
}

export type AcquireResult<W> =
  | { ok: true; worker: W; spawned: boolean; evicted: string[] }
  | { ok: false; reason: 'at-capacity'; busyThreadIds: string[]; message: string }

interface Entry<W> {
  worker: W
  /** Streaming or otherwise mid-run. Protected from eviction. */
  busy: boolean
  lastTouchedAt: number
}

export class SidecarPool<W> {
  private readonly entries = new Map<string, Entry<W>>()
  private readonly now: () => number
  private foregroundThreadId: string | null = null

  constructor(private readonly options: PoolOptions<W>) {
    this.now = options.now ?? Date.now
  }

  get(threadId: string): W | undefined {
    const entry = this.entries.get(threadId)
    if (!entry) return undefined
    entry.lastTouchedAt = this.now()
    return entry.worker
  }

  has(threadId: string): boolean {
    return this.entries.has(threadId)
  }

  size(): number {
    return this.entries.size
  }

  liveThreadIds(): string[] {
    return [...this.entries.keys()]
  }

  busyThreadIds(): string[] {
    return [...this.entries.entries()].filter(([, e]) => e.busy).map(([id]) => id)
  }

  /**
   * Mark a thread as running. Busy threads are never evicted, so this must be
   * cleared when the run settles or the pool will fill with zombies.
   */
  setBusy(threadId: string, busy: boolean): void {
    const entry = this.entries.get(threadId)
    if (!entry) return
    entry.busy = busy
    entry.lastTouchedAt = this.now()
  }

  /** The thread the user is looking at. Never evicted, busy or not. */
  setForeground(threadId: string | null): void {
    this.foregroundThreadId = threadId
    if (threadId) {
      const entry = this.entries.get(threadId)
      if (entry) entry.lastTouchedAt = this.now()
    }
  }

  /** Evictable = live, not busy, not foreground. Oldest touch first. */
  private evictionCandidates(): string[] {
    return [...this.entries.entries()]
      .filter(([id, e]) => !e.busy && id !== this.foregroundThreadId)
      .sort((a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt)
      .map(([id]) => id)
  }

  /**
   * Get the worker for a thread, spawning one if needed.
   *
   * At capacity we evict idle workers, oldest first. If nothing is evictable —
   * every other thread is mid-run — we refuse. The caller is expected to
   * surface that to the user, not paper over it: the honest answer is "three
   * threads are still working, finish or stop one", not a silently killed run.
   */
  acquire(threadId: string): AcquireResult<W> {
    const existing = this.entries.get(threadId)
    if (existing) {
      existing.lastTouchedAt = this.now()
      return { ok: true, worker: existing.worker, spawned: false, evicted: [] }
    }

    const evicted: string[] = []
    while (this.entries.size >= this.options.maxLive) {
      const candidate = this.evictionCandidates()[0]
      if (!candidate) {
        const busy = this.busyThreadIds()
        return {
          ok: false,
          reason: 'at-capacity',
          busyThreadIds: busy,
          message:
            `Can't open another thread: ${this.entries.size} are already running ` +
            `and none can be suspended without discarding work in progress. ` +
            `Wait for one to finish, or stop it first.`,
        }
      }
      this.release(candidate)
      evicted.push(candidate)
    }

    const worker = this.options.spawn(threadId)
    this.entries.set(threadId, { worker, busy: false, lastTouchedAt: this.now() })
    return { ok: true, worker, spawned: true, evicted }
  }

  /**
   * Suspend a thread's worker. The conversation is not lost — it lives in its
   * JSONL and rehydrates on reopen (ADR-006 rule 4); only the process goes.
   */
  release(threadId: string): boolean {
    const entry = this.entries.get(threadId)
    if (!entry) return false
    this.entries.delete(threadId)
    if (this.foregroundThreadId === threadId) this.foregroundThreadId = null
    try {
      this.options.dispose(entry.worker, threadId)
    } catch {
      // A worker that already died is still released; never let a failed
      // teardown leave a phantom entry occupying a slot.
    }
    return true
  }

  /** Shutdown. Releases everything, busy included — the app is going away. */
  releaseAll(): void {
    for (const threadId of [...this.entries.keys()]) this.release(threadId)
  }

  forEach(callback: (worker: W, threadId: string) => void): void {
    for (const [threadId, entry] of this.entries) callback(entry.worker, threadId)
  }
}
