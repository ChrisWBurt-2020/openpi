import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitLock, withGitLock } from '../electron/git/gitLock'

describe('withGitLock', () => {
  vi.setConfig({ testTimeout: 20_000 })

  it('runs tasks and returns their result', async () => {
    const result = await withGitLock('/tmp/test-repo', async () => 42)
    expect(result).toBe(42)
  })

  it('serializes concurrent tasks for the same cwd', async () => {
    const order: string[] = []
    const cwd = '/tmp/test-serial'

    // Fire 3 tasks concurrently
    const p1 = withGitLock(cwd, async () => {
      order.push('start-1')
      await new Promise((r) => setTimeout(r, 50))
      order.push('end-1')
    })
    const p2 = withGitLock(cwd, async () => {
      order.push('start-2')
      await new Promise((r) => setTimeout(r, 10))
      order.push('end-2')
    })
    const p3 = withGitLock(cwd, async () => {
      order.push('start-3')
      order.push('end-3')
    })

    await Promise.all([p1, p2, p3])

    // Tasks must run sequentially — no interleaving
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3'])
  })

  it('allows concurrent tasks for different cwds', async () => {
    const order: string[] = []

    const p1 = withGitLock('/tmp/repo-a', async () => {
      order.push('a-start')
      await new Promise((r) => setTimeout(r, 30))
      order.push('a-end')
    })
    const p2 = withGitLock('/tmp/repo-b', async () => {
      order.push('b-start')
      await new Promise((r) => setTimeout(r, 10))
      order.push('b-end')
    })

    await Promise.all([p1, p2])

    // Different repos can run concurrently — b should finish before a
    expect(order).toEqual(['a-start', 'b-start', 'b-end', 'a-end'])
  })

  it('one task failure does not block subsequent tasks', async () => {
    const cwd = '/tmp/test-fail'

    // First task throws
    await expect(
      withGitLock(cwd, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    // Second task should still run
    const result = await withGitLock(cwd, async () => 'ok')
    expect(result).toBe('ok')
  })
})

describe('GitLock', () => {
  it('removes the cwd entry from the map after settling (no leak)', async () => {
    const lock = new GitLock()
    const cwd = '/tmp/leak-test'

    expect(lock.hasPending(cwd)).toBe(false)
    await lock.run(cwd, async () => 1)
    expect(lock.hasPending(cwd)).toBe(false)

    // Run several sequential tasks on the same cwd — should still be empty
    for (let i = 0; i < 5; i++) {
      await lock.run(cwd, async () => i)
    }
    expect(lock.hasPending(cwd)).toBe(false)
  })

  it('removes the entry even when the task throws', async () => {
    const lock = new GitLock()
    const cwd = '/tmp/leak-throw'

    await expect(
      lock.run(cwd, async () => {
        throw new Error('fail')
      })
    ).rejects.toThrow('fail')

    expect(lock.hasPending(cwd)).toBe(false)

    // Subsequent task should run
    const result = await lock.run(cwd, async () => 'recovered')
    expect(result).toBe('recovered')
  })

  it('keeps the entry while tasks are still running', async () => {
    const lock = new GitLock()
    const cwd = '/tmp/pending'

    let resolveTask: ((v: number) => void) | undefined
    const taskPromise = lock.run(
      cwd,
      () =>
        new Promise<number>((r) => {
          resolveTask = r
        })
    )

    // The task starts on the next microtask, so we have to wait briefly
    // for resolveTask to be assigned before we can resolve it.
    await new Promise((r) => setTimeout(r, 0))
    expect(resolveTask).toBeDefined()
    expect(lock.hasPending(cwd)).toBe(true)
    resolveTask!(99)
    await taskPromise
    expect(lock.hasPending(cwd)).toBe(false)
  })

  it('normalizes cwd so equivalent paths share a lock', async () => {
    const lock = new GitLock()
    const order: string[] = []

    // /foo/bar and /foo/bar/ should map to the same lock key
    const p1 = lock.run('/foo/bar', async () => {
      order.push('a1')
      await new Promise((r) => setTimeout(r, 20))
      order.push('a2')
    })
    const p2 = lock.run('/foo/bar/', async () => {
      order.push('b1')
      order.push('b2')
    })

    await Promise.all([p1, p2])
    // Must be serialized, not interleaved
    expect(order).toEqual(['a1', 'a2', 'b1', 'b2'])
  })

  it('rejects with a timeout error when the task hangs', async () => {
    const lock = new GitLock({ defaultTimeoutMs: 50 })
    const cwd = '/tmp/timeout-test'

    await expect(
      lock.run(
        cwd,
        () =>
          new Promise(() => {
            /* never resolves */
          }),
        { timeoutMs: 50 }
      )
    ).rejects.toThrow(/timed out/)

    // Lock must be released so the next task can run
    expect(lock.hasPending(cwd)).toBe(false)
    const result = await lock.run(cwd, async () => 'recovered')
    expect(result).toBe('recovered')
  })

  it('drain() waits for all pending operations to settle', async () => {
    const lock = new GitLock()
    const settled: string[] = []

    const p1 = lock.run('/tmp/drain-a', async () => {
      await new Promise((r) => setTimeout(r, 20))
      settled.push('a')
    })
    const p2 = lock.run('/tmp/drain-b', async () => {
      await new Promise((r) => setTimeout(r, 5))
      settled.push('b')
    })

    await lock.drain()
    expect(settled.sort()).toEqual(['a', 'b'])
    await Promise.all([p1, p2])
  })
})

describe('withGitLock singleton', () => {
  afterEach(async () => {
    // Ensure singleton map is empty between tests so they don't bleed into each other
    await new Promise((r) => setTimeout(r, 10))
  })

  it('shares state across the singleton — sequential withGitLock calls on the same cwd serialize', async () => {
    // Because withGitLock is a module-level singleton, and tests share the
    // process, we use a unique cwd here to avoid cross-test interference.
    const cwd = `/tmp/singleton-${Date.now()}-${Math.random()}`
    const order: string[] = []

    const p1 = withGitLock(cwd, async () => {
      order.push('s1')
      await new Promise((r) => setTimeout(r, 20))
      order.push('s2')
    })
    const p2 = withGitLock(cwd, async () => {
      order.push('t1')
      order.push('t2')
    })

    await Promise.all([p1, p2])
    expect(order).toEqual(['s1', 's2', 't1', 't2'])
  })
})
