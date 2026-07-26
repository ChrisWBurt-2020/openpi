import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { RunManager } from '../electron/runs/manager'
import type { RunStore } from '../electron/runs/store'
import type { RunState } from '../src/lib/runs'

class MemoryRunStore {
  private readonly states = new Map<string, { state: RunState; checkoutId: string }>()
  private readonly dispatches = new Set<string>()

  save(state: RunState, checkoutId: string): void {
    this.states.set(state.id, { state, checkoutId })
  }

  getByThread(threadId: string): RunState | null {
    return (
      [...this.states.values()].find((entry) => entry.state.threadId === threadId)?.state ?? null
    )
  }

  getBySession(sessionPath: string): RunState | null {
    return (
      [...this.states.values()].find((entry) => entry.state.sessionPath === sessionPath)?.state ??
      null
    )
  }

  list(workspacePath?: string): RunState[] {
    return [...this.states.values()]
      .map((entry) => entry.state)
      .filter((state) => !workspacePath || state.workspacePath === workspacePath)
  }

  hasCheckoutOwner(checkoutId: string): boolean {
    return [...this.states.values()].some(
      (entry) =>
        entry.checkoutId === checkoutId &&
        ['starting', 'active', 'continuation_queued', 'pausing', 'reconnecting'].includes(
          entry.state.lifecycle
        )
    )
  }

  scheduleDispatch(continuationId: string): boolean {
    if (this.dispatches.has(continuationId)) return false
    this.dispatches.add(continuationId)
    return true
  }
}

function createManager() {
  const root = path.join(os.tmpdir(), `openpi-run-manager-${randomUUID()}`)
  const sent: unknown[] = []
  const published: unknown[] = []
  return {
    manager: new RunManager(
      new MemoryRunStore() as unknown as RunStore,
      (_threadId, command) => sent.push(command),
      (state) => published.push(state)
    ),
    root,
    sent,
    published,
  }
}

describe('RunManager failure reconciliation', () => {
  it('does not continue a Run after Pi reports a provider failure', () => {
    const { manager, root } = createManager()
    const run = manager.start({ threadId: 'thread-1', sessionPath: null, workspacePath: root })

    manager.onEvent('thread-1', {
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'usage limit reached' },
    })

    expect(manager.list()).toMatchObject([
      { id: run.id, lifecycle: 'terminal', terminalReason: 'failed' },
    ])
  })

  it('releases checkout ownership when its worker is no longer confirmed', () => {
    const { manager, root } = createManager()
    const first = manager.start({ threadId: 'thread-1', sessionPath: null, workspacePath: root })
    manager.onWorkerLost('thread-1', 'pi_sidecar_crashed')

    const next = manager.start({ threadId: 'thread-2', sessionPath: null, workspacePath: root })

    expect(first.id).not.toBe(next.id)
    expect(manager.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, waitingReason: 'connection_lost' }),
      ])
    )
  })
})
