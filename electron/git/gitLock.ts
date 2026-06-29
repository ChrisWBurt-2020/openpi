import path from 'node:path'

/**
 * Per-cwd mutex for serializing git CLI operations. Git's index is not safe
 * to mutate from concurrent processes, so any operation that touches the
 * index (stage/unstage/revert/apply) must run sequentially per repo.
 *
 * Operations on different cwds run concurrently. Operations on the same cwd
 * queue up. The lock is reference-counted via a chain: each call attaches
 * to the previous chain and removes itself when it settles.
 *
 * `run()` enforces a soft timeout so a hung git process cannot hold the lock
 * forever; the timeout rejects the caller and removes the chain entry so the
 * next caller can proceed.
 */
export class GitLock {
  private chains = new Map<string, Promise<unknown>>()
  private readonly defaultTimeoutMs: number

  constructor(options: { defaultTimeoutMs?: number } = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000
  }

  /**
   * Run `fn` under the per-cwd lock. Concurrent calls with the same cwd
   * serialize; different cwds run in parallel.
   */
  run<T>(cwd: string, fn: () => Promise<T>, options: { timeoutMs?: number } = {}): Promise<T> {
    const key = this.normalize(cwd)
    const prev = this.chains.get(key) ?? Promise.resolve()
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs

    // Build the chain: wait for the previous task, then run this one.
    // Note: the .then(() => ...) creates an intermediate Promise that
    // assimilates withTimeout()'s rejection. Node's unhandledRejection
    // detector tracks each Promise separately, so this can produce
    // `Unhandled Rejection` warnings on a timeout/failure path even though
    // the caller does receive the rejection via `work`. We accept those
    // warnings as a trade-off for the simpler chain construction; the
    // alternative (an async/await runChained) lost the serialization
    // ordering because the `set + await prev` race.
    const work = prev.then(() => this.withTimeout(fn, timeoutMs, key))

    // Track the chain so subsequent callers wait on us. Use `.finally` to
    // remove our entry once we've settled, preventing the map from growing
    // unboundedly as workspaces open and close. The `.finally` swallows
    // rejections from `work` so the chains map never holds a rejecting
    // promise (which would make the next caller's `await` throw).
    const tracked = work.finally(() => {
      if (this.chains.get(key) === tracked) {
        this.chains.delete(key)
      }
    })
    this.chains.set(key, tracked)

    // Surface errors to the caller, but never leak them into the chain.
    return work
  }

  private withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, key: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const settle = (action: () => void) => {
        if (settled) return
        settled = true
        action()
      }
      const timer = setTimeout(() => {
        settle(() => reject(new Error(`git operation timed out after ${timeoutMs}ms (cwd=${key})`)))
      }, timeoutMs)

      // The .then(...) call below returns a new Promise. We don't keep a
      // reference to it (settle handles resolve/reject on the outer Promise).
      // Attach a no-op .catch so Node never flags it as unhandled, e.g. when
      // `fn()` rejects AFTER the outer has already settled via the timeout
      // branch and the onRejected tries to re-reject an already-rejected
      // Promise.
      fn()
        .then(
          (v) =>
            settle(() => {
              clearTimeout(timer)
              resolve(v)
            }),
          (err) =>
            settle(() => {
              clearTimeout(timer)
              reject(err instanceof Error ? err : new Error(String(err)))
            })
        )
        .catch(() => {
          /* swallowed - the outer Promise was already settled by `settle` */
        })
    })
  }

  private normalize(cwd: string): string {
    if (!cwd) return cwd
    try {
      return path.resolve(cwd)
    } catch {
      return cwd
    }
  }

  /**
   * Test/diagnostics helper: returns true if there are pending operations
   * on the given cwd (after normalization).
   */
  hasPending(cwd: string): boolean {
    return this.chains.has(this.normalize(cwd))
  }

  /**
   * Wait for all pending operations to settle. Useful in tests or graceful
   * shutdown paths.
   */
  async drain(): Promise<void> {
    while (this.chains.size > 0) {
      const pending = Array.from(this.chains.values())
      await Promise.allSettled(pending)
    }
  }
}

/**
 * Process-wide singleton. Most call sites want the same lock.
 */
export const gitLock = new GitLock()

/**
 * Convenience wrapper around the singleton.
 */
export function withGitLock<T>(
  cwd: string,
  fn: () => Promise<T>,
  options?: { timeoutMs?: number }
): Promise<T> {
  return gitLock.run(cwd, fn, options)
}
