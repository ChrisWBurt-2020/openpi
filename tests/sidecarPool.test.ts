import { describe, expect, it } from 'vitest'
import { SidecarPool } from '../electron/pi/sidecarPool'

/**
 * ADR-006. The sidecar was a singleton, so opening a thread disposed the last
 * one. The pool keeps several alive, addressed by thread id.
 *
 * The MUST throughout: a thread that is mid-run is never torn down to make
 * room for another. Silently discarding work in progress is the failure this
 * whole product exists to prevent.
 */

interface FakeWorker {
  id: string
}

function makePool(maxLive: number) {
  const spawned: string[] = []
  const disposed: string[] = []
  let clock = 0
  const pool = new SidecarPool<FakeWorker>({
    maxLive,
    now: () => ++clock,
    spawn: (threadId) => {
      spawned.push(threadId)
      return { id: threadId }
    },
    dispose: (_worker, threadId) => {
      disposed.push(threadId)
    },
  })
  return { pool, spawned, disposed }
}

describe('running several threads at once', () => {
  it('keeps each thread on its own worker instead of replacing', () => {
    const { pool, spawned, disposed } = makePool(4)

    pool.acquire('a')
    pool.acquire('b')
    pool.acquire('c')

    expect(spawned).toEqual(['a', 'b', 'c'])
    // The old singleton behaviour would have disposed 'a' when 'b' opened.
    expect(disposed).toEqual([])
    expect(pool.size()).toBe(3)
  })

  it('reuses the existing worker when a thread is reopened', () => {
    const { pool, spawned } = makePool(4)

    const first = pool.acquire('a')
    const second = pool.acquire('a')

    expect(spawned).toEqual(['a'])
    expect(first.ok && second.ok && first.worker === second.worker).toBe(true)
    expect(second.ok && second.spawned).toBe(false)
  })
})

describe('at capacity', () => {
  it('suspends the least recently touched idle thread', () => {
    const { pool, disposed } = makePool(2)
    pool.acquire('a')
    pool.acquire('b')
    pool.get('b') // touch b, making a the oldest

    const result = pool.acquire('c')

    expect(result.ok).toBe(true)
    expect(disposed).toEqual(['a'])
    expect(pool.liveThreadIds().sort()).toEqual(['b', 'c'])
  })

  it('MUST NOT suspend a thread that is mid-run', () => {
    const { pool, disposed } = makePool(2)
    pool.acquire('a')
    pool.acquire('b')
    pool.setBusy('a', true) // 'a' is streaming, and is the oldest

    pool.acquire('c')

    // 'b' goes instead, even though 'a' was touched longer ago.
    expect(disposed).toEqual(['b'])
    expect(pool.liveThreadIds().sort()).toEqual(['a', 'c'])
  })

  it('MUST NOT suspend the thread the user is looking at', () => {
    const { pool, disposed } = makePool(2)
    pool.acquire('a')
    pool.acquire('b')
    pool.setForeground('a') // idle, but on screen

    pool.acquire('c')

    expect(disposed).toEqual(['b'])
  })
})

describe('when everything is busy', () => {
  it('MUST refuse rather than kill a running thread', () => {
    const { pool, spawned, disposed } = makePool(2)
    pool.acquire('a')
    pool.acquire('b')
    pool.setBusy('a', true)
    pool.setBusy('b', true)

    const result = pool.acquire('c')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('at-capacity')
    expect(result.busyThreadIds.sort()).toEqual(['a', 'b'])
    // Nothing torn down, nothing half-spawned.
    expect(disposed).toEqual([])
    expect(spawned).toEqual(['a', 'b'])
    expect(pool.size()).toBe(2)
  })

  it('names the running threads so the refusal can be explained', () => {
    const { pool } = makePool(1)
    pool.acquire('a')
    pool.setBusy('a', true)

    const result = pool.acquire('b')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/already running/i)
    expect(result.message).toMatch(/finish or stop|stop it first/i)
  })

  it('accepts the new thread once a run settles', () => {
    const { pool } = makePool(1)
    pool.acquire('a')
    pool.setBusy('a', true)
    expect(pool.acquire('b').ok).toBe(false)

    pool.setBusy('a', false)
    expect(pool.acquire('b').ok).toBe(true)
  })
})

describe('teardown', () => {
  it('frees the slot even when disposing the worker throws', () => {
    let clock = 0
    const pool = new SidecarPool<FakeWorker>({
      maxLive: 1,
      now: () => ++clock,
      spawn: (id) => ({ id }),
      dispose: () => {
        throw new Error('worker already dead')
      },
    })
    pool.acquire('a')

    // A failed teardown must not leave a phantom entry holding a slot.
    expect(pool.release('a')).toBe(true)
    expect(pool.size()).toBe(0)
    expect(pool.acquire('b').ok).toBe(true)
  })

  it('clears foreground when the foreground thread is released', () => {
    const { pool, disposed } = makePool(2)
    pool.acquire('a')
    pool.setForeground('a')
    pool.release('a')

    pool.acquire('b')
    pool.acquire('c')
    // 'a' is gone and no longer protected, so normal LRU applies to b/c.
    expect(disposed).toEqual(['a'])
  })

  it('releases everything on shutdown, running threads included', () => {
    const { pool, disposed } = makePool(4)
    pool.acquire('a')
    pool.acquire('b')
    pool.setBusy('a', true)

    pool.releaseAll()

    expect(disposed.sort()).toEqual(['a', 'b'])
    expect(pool.size()).toBe(0)
  })
})
