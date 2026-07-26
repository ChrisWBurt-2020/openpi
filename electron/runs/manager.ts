import { randomUUID } from 'node:crypto'
import type { RunState } from '../../src/lib/runs'
import type { RunControlEvent } from '../pi/runExtension'
import type { SidecarCommand } from '../pi/sidecar'
import { checkoutIdentity } from './identity'
import type { RunStore } from './store'

const MAX_CONTINUATIONS = 3

export class CheckoutBusyError extends Error {
  constructor() {
    super(
      'Another chat has an active Run in this checkout. Switch to that chat, wait for it to finish, or select Ask.'
    )
    this.name = 'CheckoutBusyError'
  }
}

function now(): string {
  return new Date().toISOString()
}

export class RunManager {
  constructor(
    private readonly store: RunStore,
    private readonly send: (threadId: string, command: SidecarCommand) => void,
    private readonly publish: (state: RunState) => void
  ) {}

  start(input: { threadId: string; sessionPath: string | null; workspacePath: string }): RunState {
    const checkoutId = checkoutIdentity(input.workspacePath)
    const existing = this.store.getByThread(input.threadId)
    if (existing && existing.lifecycle !== 'terminal') return existing
    if (this.store.hasCheckoutOwner(checkoutId)) throw new CheckoutBusyError()
    const timestamp = now()
    const state: RunState = {
      id: randomUUID(),
      sessionPath: input.sessionPath,
      threadId: input.threadId,
      workspacePath: input.workspacePath,
      lifecycle: 'starting',
      phase: 'planning',
      waitingReason: null,
      terminalReason: null,
      reviewState: 'not_applicable',
      runEpoch: 1,
      stateVersion: 0,
      lastEventSequence: 0,
      contractVersion: 1,
      lastContinuationId: null,
      continuationCountThisCycle: 0,
      continuationCountTotal: 0,
      maxContinuationsThisCycle: MAX_CONTINUATIONS,
      activeTools: {},
      updatedAt: timestamp,
      lastMeaningfulProgressAt: timestamp,
      outcome: null,
      pendingInput: null,
    }
    this.save(state, checkoutId, 'started')
    return state
  }

  get(sessionPath: string): RunState | null {
    return this.store.getBySession(sessionPath)
  }

  list(workspacePath?: string): RunState[] {
    return this.store.list(workspacePath)
  }

  pause(runId: string, expectedStateVersion: number): RunState {
    const state = this.requireState(runId, expectedStateVersion)
    if (state.lifecycle === 'terminal') throw new Error('This Run is already terminal.')
    const pausing = { ...state, lifecycle: 'pausing' as const, waitingReason: null }
    this.save(pausing, checkoutIdentity(pausing.workspacePath), 'pause_requested')
    if (pausing.threadId) this.send(pausing.threadId, { type: 'abort' })
    return { ...pausing, stateVersion: pausing.stateVersion + 1 }
  }

  pauseThread(threadId: string): boolean {
    const state = this.store.getByThread(threadId)
    if (!state || state.lifecycle === 'terminal' || state.lifecycle === 'paused') return false
    const pausing = { ...state, lifecycle: 'pausing' as const, waitingReason: null }
    this.save(pausing, checkoutIdentity(pausing.workspacePath), 'pause_requested')
    this.send(threadId, { type: 'abort' })
    return true
  }

  cancel(runId: string, expectedStateVersion: number): RunState {
    const state = this.requireState(runId, expectedStateVersion)
    if (state.lifecycle === 'terminal') return state
    if (state.threadId) this.send(state.threadId, { type: 'abort' })
    const terminal = {
      ...state,
      lifecycle: 'terminal' as const,
      terminalReason: 'cancelled' as const,
      phase: null,
      waitingReason: null,
      activeTools: {},
    }
    this.save(terminal, checkoutIdentity(terminal.workspacePath), 'cancelled')
    return { ...terminal, stateVersion: terminal.stateVersion + 1 }
  }

  resume(runId: string, expectedStateVersion: number): RunState {
    const state = this.requireState(runId, expectedStateVersion)
    if (state.lifecycle === 'terminal')
      throw new Error('Start a new Run to continue a terminal task.')
    const threadId = state.threadId
    if (!threadId) throw new Error('This Run has no active Pi thread to resume.')
    const resumed = {
      ...state,
      lifecycle: 'continuation_queued' as const,
      phase: 'planning' as const,
      waitingReason: null,
      pendingInput: null,
      continuationCountThisCycle: 0,
      contractVersion: state.contractVersion + 1,
    }
    this.save(resumed, checkoutIdentity(resumed.workspacePath), 'resumed')
    this.send(threadId, {
      type: 'prompt',
      intent: 'run',
      runContext: {
        id: resumed.id,
        epoch: resumed.runEpoch,
        contractVersion: resumed.contractVersion,
      },
      text: '[OpenPi Run recovery — not user-authored]\nReinspect the current workspace before changing anything. Continue outstanding work only; do not repeat completed external side effects. Finish, block, or request input.',
    })
    return { ...resumed, stateVersion: resumed.stateVersion + 1 }
  }

  onEvent(threadId: string, event: Record<string, unknown>): void {
    const state = this.store.getByThread(threadId)
    if (!state || state.lifecycle === 'terminal') return
    const type = typeof event.type === 'string' ? event.type : ''
    const updated = { ...state, updatedAt: now() }
    if (type === 'agent_start') updated.lifecycle = 'active'
    if (type === 'tool_execution_start') {
      const id = typeof event.toolCallId === 'string' ? event.toolCallId : randomUUID()
      const toolName = typeof event.toolName === 'string' ? event.toolName : 'tool'
      updated.activeTools = {
        ...updated.activeTools,
        [id]: { toolCallId: id, toolName, startedAt: now(), lastUpdateAt: now() },
      }
      updated.lastMeaningfulProgressAt = now()
    }
    if (type === 'tool_execution_end') {
      const id = typeof event.toolCallId === 'string' ? event.toolCallId : ''
      const { [id]: _removed, ...remaining } = updated.activeTools
      updated.activeTools = remaining
      updated.lastMeaningfulProgressAt = now()
      if (isWorkspaceTransportFailure(event)) {
        updated.lifecycle = 'waiting'
        updated.waitingReason = 'connection_lost'
        this.save(updated, checkoutIdentity(updated.workspacePath), 'workspace_transport_failed')
        return
      }
    }
    if (type === 'message_end' && isProviderFailure(event)) {
      this.save(
        {
          ...updated,
          lifecycle: 'terminal',
          phase: null,
          terminalReason: 'failed',
          waitingReason: null,
          activeTools: {},
        },
        checkoutIdentity(updated.workspacePath),
        'provider_failure'
      )
      return
    }
    if (type === 'agent_settled') this.settle(updated)
    else this.save(updated, checkoutIdentity(updated.workspacePath), type || 'event')
  }

  onControl(threadId: string, control: RunControlEvent): void {
    const state = this.store.getByThread(threadId)
    if (
      !state ||
      state.id !== control.context.id ||
      state.contractVersion !== control.context.contractVersion
    )
      return
    if (control.type === 'checkpoint') {
      const updated = {
        ...state,
        phase: control.payload.phase,
        lastMeaningfulProgressAt: now(),
        updatedAt: now(),
      }
      this.save(updated, checkoutIdentity(updated.workspacePath), 'checkpoint')
      return
    }
    if (control.type === 'input') {
      const updated = {
        ...state,
        lifecycle: 'waiting' as const,
        waitingReason: 'user_input' as const,
        pendingInput: control.payload,
        updatedAt: now(),
      }
      this.save(updated, checkoutIdentity(updated.workspacePath), 'input_requested')
      return
    }
    const updated = {
      ...state,
      outcome: control.payload,
      phase: 'finalizing' as const,
      updatedAt: now(),
    }
    this.save(updated, checkoutIdentity(updated.workspacePath), 'outcome_reported')
  }

  onWorkerLost(threadId: string, reason: string): void {
    const state = this.store.getByThread(threadId)
    if (!state || state.lifecycle === 'terminal') return
    this.save(
      {
        ...state,
        lifecycle: 'waiting',
        phase: null,
        waitingReason: 'connection_lost',
        activeTools: {},
        updatedAt: now(),
      },
      checkoutIdentity(state.workspacePath),
      reason
    )
  }

  private settle(state: RunState): void {
    if (state.lifecycle === 'pausing') {
      this.save(
        { ...state, lifecycle: 'paused', phase: null, activeTools: {}, waitingReason: null },
        checkoutIdentity(state.workspacePath),
        'paused'
      )
      return
    }
    if (state.outcome) {
      const changed = Object.keys(state.activeTools).length > 0
      if (!changed) {
        const terminal = state.outcome.status === 'completed' ? 'completed' : 'blocked'
        this.save(
          {
            ...state,
            lifecycle: 'terminal',
            terminalReason: terminal,
            reviewState: terminal === 'completed' ? 'ready' : 'not_applicable',
            updatedAt: now(),
          },
          checkoutIdentity(state.workspacePath),
          'settled'
        )
        return
      }
    }
    if (state.pendingInput || state.lifecycle === 'paused' || state.lifecycle === 'waiting') return
    if (state.continuationCountThisCycle >= state.maxContinuationsThisCycle) {
      this.save(
        {
          ...state,
          lifecycle: 'waiting',
          waitingReason: 'continuation_budget_exhausted',
          updatedAt: now(),
        },
        checkoutIdentity(state.workspacePath),
        'budget_exhausted'
      )
      return
    }
    const attempt = state.continuationCountThisCycle + 1
    const continuationId = `${state.id}:${state.runEpoch}:${state.contractVersion}:${attempt}`
    if (!this.store.scheduleDispatch(continuationId, state.id)) return
    const queued = {
      ...state,
      lifecycle: 'continuation_queued' as const,
      continuationCountThisCycle: attempt,
      continuationCountTotal: state.continuationCountTotal + 1,
      lastContinuationId: continuationId,
      updatedAt: now(),
    }
    this.save(queued, checkoutIdentity(queued.workspacePath), 'continuation_scheduled')
    this.send(state.threadId ?? '', {
      type: 'prompt',
      intent: 'run',
      runContext: {
        id: state.id,
        epoch: state.runEpoch,
        contractVersion: state.contractVersion,
        continuationId,
      },
      text: '/openpi-run-continue',
    })
  }

  private save(state: RunState, checkoutId: string, event: string): void {
    const next = {
      ...state,
      stateVersion: state.stateVersion + 1,
      lastEventSequence: state.lastEventSequence + 1,
      updatedAt: now(),
    }
    this.store.save(next, checkoutId, event)
    this.publish(next)
  }

  private requireState(runId: string, expectedStateVersion: number): RunState {
    const state = this.store.list().find((item) => item.id === runId)
    if (!state) throw new Error('Run not found.')
    if (state.stateVersion !== expectedStateVersion)
      throw new Error('This Run changed in another window. Refresh and try again.')
    return state
  }
}

function isWorkspaceTransportFailure(event: Record<string, unknown>): boolean {
  if (event.isError !== true) return false
  const result = event.result
  const text = JSON.stringify(result ?? '').toLowerCase()
  return (
    text.includes('ssh workspace') ||
    text.includes('remote workspace') ||
    text.includes('remote pi connection closed') ||
    text.includes('remote command timed out')
  )
}

function isProviderFailure(event: Record<string, unknown>): boolean {
  const message = event.message
  return (
    Boolean(message) &&
    typeof message === 'object' &&
    (message as { stopReason?: unknown }).stopReason === 'error'
  )
}
