import type { RunState } from '../../src/lib/runs'
import type { RunControlEvent } from '../pi/runExtension'
import type { SidecarCommand } from '../pi/sidecar'
import { checkoutIdentity } from './identity'
import { progressFingerprint, reviseContract, transition } from './reducer'
import { type CreateRunInput, createRunState, timestamp } from './state'
import type { RunStore } from './store'

export class CheckoutBusyError extends Error {
  constructor() {
    super(
      'Another chat has an active Run in this checkout. Switch to that chat, wait for it to finish, or select Ask.'
    )
    this.name = 'CheckoutBusyError'
  }
}

export class RunManager {
  constructor(
    private readonly store: RunStore,
    private readonly send: (threadId: string, command: SidecarCommand) => void,
    private readonly publish: (state: RunState) => void
  ) {}

  start(input: CreateRunInput): RunState {
    const checkoutId = checkoutIdentity(input.workspacePath)
    const existing = this.store.getByThread(input.threadId)
    if (existing && existing.lifecycle !== 'terminal') return existing
    if (this.store.hasCheckoutOwner(checkoutId)) throw new CheckoutBusyError()
    const state = createRunState(input)
    this.save(state, checkoutId, 'started')
    return state
  }

  get(sessionPath: string): RunState | null {
    return this.store.getBySession(sessionPath)
  }

  list(workspacePath?: string): RunState[] {
    return this.store.list(workspacePath)
  }

  pause(runId: string, mode: 'now' | 'after_tool', expectedStateVersion: number): RunState {
    const state = this.requireState(runId, expectedStateVersion)
    if (state.lifecycle === 'terminal') throw new Error('This Run is already terminal.')
    const afterCurrentTool = mode === 'after_tool' && Object.keys(state.activeTools).length > 0
    const pausing = transition(state, {
      lifecycle: 'pausing',
      waitingReason: null,
      pauseAfterCurrentTool: afterCurrentTool,
    })
    this.save(pausing, checkoutIdentity(pausing.workspacePath), 'pause_requested')
    if (!afterCurrentTool && pausing.threadId) this.send(pausing.threadId, { type: 'abort' })
    return pausing
  }

  pauseThread(threadId: string): boolean {
    const state = this.store.getByThread(threadId)
    if (!state || state.lifecycle === 'terminal' || state.lifecycle === 'paused') return false
    const pausing = transition(state, { lifecycle: 'pausing', waitingReason: null })
    this.save(pausing, checkoutIdentity(pausing.workspacePath), 'pause_requested')
    this.send(threadId, { type: 'abort' })
    return true
  }

  cancel(runId: string, expectedStateVersion: number): RunState {
    const state = this.requireState(runId, expectedStateVersion)
    if (state.lifecycle === 'terminal') return state
    if (state.threadId) this.send(state.threadId, { type: 'abort' })
    const terminal = transition(state, {
      lifecycle: 'terminal',
      terminalReason: 'cancelled',
      phase: null,
      waitingReason: null,
      activeTools: {},
    })
    this.save(terminal, checkoutIdentity(terminal.workspacePath), 'cancelled')
    return terminal
  }

  resume(runId: string, expectedStateVersion: number): RunState {
    const state = this.requireState(runId, expectedStateVersion)
    if (state.lifecycle === 'terminal')
      throw new Error('Start a new Run to continue a terminal task.')
    const threadId = state.threadId
    if (!threadId) throw new Error('This Run has no active Pi thread to resume.')
    const resumed = reviseContract(state, 'resume', '[OpenPi Run recovery — not user-authored]')
    const ready = transition(resumed, {
      lifecycle: 'continuation_queued' as const,
      phase: 'planning' as const,
      waitingReason: null,
      pendingInput: null,
      continuationCountThisCycle: 0,
    })
    this.save(ready, checkoutIdentity(ready.workspacePath), 'resumed')
    this.send(threadId, {
      type: 'prompt',
      intent: 'run',
      runContext: {
        id: ready.id,
        epoch: ready.runEpoch,
        contractVersion: ready.contractVersion,
      },
      text: '[OpenPi Run recovery — not user-authored]\nReinspect the current workspace before changing anything. Continue outstanding work only; do not repeat completed external side effects. Finish, block, or request input.',
    })
    return ready
  }

  answerInput(runId: string, answer: string, expectedStateVersion: number): RunState {
    const state = this.requireState(runId, expectedStateVersion)
    if (state.lifecycle !== 'waiting' || state.waitingReason !== 'user_input') {
      throw new Error('This Run is not waiting for user input.')
    }
    const revised = reviseContract(state, 'user_input', answer)
    const ready = transition(revised, {
      lifecycle: 'continuation_queued',
      waitingReason: null,
      pendingInput: null,
      continuationCountThisCycle: 0,
    })
    this.save(ready, checkoutIdentity(ready.workspacePath), 'input_answered')
    this.sendRunPrompt(ready, answer)
    return ready
  }

  requestChanges(runId: string, text: string, expectedStateVersion: number): RunState {
    const state = this.requireState(runId, expectedStateVersion)
    if (state.reviewState !== 'ready') throw new Error('This Run is not ready for review changes.')
    const revised = reviseContract(state, 'request_changes', text)
    const ready = transition(revised, {
      lifecycle: 'continuation_queued',
      terminalReason: null,
      reviewState: 'changes_requested',
      waitingReason: null,
      continuationCountThisCycle: 0,
    })
    this.save(ready, checkoutIdentity(ready.workspacePath), 'changes_requested')
    this.sendRunPrompt(ready, text)
    return ready
  }

  acceptReview(runId: string, expectedStateVersion: number): RunState {
    const state = this.requireState(runId, expectedStateVersion)
    if (state.reviewState !== 'ready') throw new Error('This Run is not ready for acceptance.')
    const accepted = transition(state, { reviewState: 'accepted' })
    this.save(accepted, checkoutIdentity(accepted.workspacePath), 'review_accepted')
    return accepted
  }

  onEvent(threadId: string, event: Record<string, unknown>): void {
    const state = this.store.getByThread(threadId)
    if (!state || state.lifecycle === 'terminal') return
    const type = typeof event.type === 'string' ? event.type : ''
    let updated = transition(state, {})
    if (type === 'agent_start') {
      updated = {
        ...updated,
        lifecycle: 'active',
        activeTurnId: updated.activeTurnId ?? `turn-${updated.lastEventSequence}`,
      }
    }
    if (type === 'queue_update') updated.hasPendingPiQueue = hasPendingQueue(event)
    if (type === 'tool_execution_start') {
      const id =
        typeof event.toolCallId === 'string'
          ? event.toolCallId
          : `tool-${updated.lastEventSequence}`
      const toolName = typeof event.toolName === 'string' ? event.toolName : 'tool'
      updated.activeTools = {
        ...updated.activeTools,
        [id]: { toolCallId: id, toolName, startedAt: timestamp(), lastUpdateAt: timestamp() },
      }
      updated.lastMeaningfulProgressAt = timestamp()
    }
    if (type === 'tool_execution_end') {
      const id = typeof event.toolCallId === 'string' ? event.toolCallId : ''
      const { [id]: _removed, ...remaining } = updated.activeTools
      updated.activeTools = remaining
      updated.lastMeaningfulProgressAt = timestamp()
      if (
        updated.lifecycle === 'pausing' &&
        updated.pauseAfterCurrentTool &&
        !Object.keys(remaining).length
      ) {
        updated.pauseAfterCurrentTool = false
        this.send(threadId, { type: 'abort' })
      }
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
    if (type === 'agent_settled') this.settle({ ...updated, activeTurnId: null })
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
    if (control.type === 'continuation_ack') {
      this.store.acknowledgeDispatch(control.continuationId)
      this.save(
        transition(state, { recoveryNotice: null }),
        checkoutIdentity(state.workspacePath),
        'continuation_dispatched'
      )
      return
    }
    if (control.type === 'checkpoint') {
      const updated = transition(state, {
        phase: control.payload.phase,
        lastMeaningfulProgressAt: timestamp(),
      })
      this.save(updated, checkoutIdentity(updated.workspacePath), 'checkpoint')
      return
    }
    if (control.type === 'input') {
      const updated = transition(state, {
        lifecycle: 'waiting' as const,
        waitingReason: 'user_input' as const,
        pendingInput: control.payload,
      })
      this.save(updated, checkoutIdentity(updated.workspacePath), 'input_requested')
      return
    }
    const updated = transition(state, {
      outcome: control.payload,
      phase: 'finalizing' as const,
    })
    this.save(updated, checkoutIdentity(updated.workspacePath), 'outcome_reported')
  }

  onWorkerLost(threadId: string, reason: string): void {
    const state = this.store.getByThread(threadId)
    if (!state || state.lifecycle === 'terminal') return
    this.save(
      transition(state, {
        lifecycle: 'waiting',
        phase: null,
        waitingReason: 'connection_lost',
        activeTools: {},
      }),
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
    if (state.outcome && Object.keys(state.activeTools).length === 0 && !state.hasPendingPiQueue) {
      const terminal = state.outcome.status === 'completed' ? 'completed' : 'blocked'
      this.save(
        {
          ...state,
          lifecycle: 'terminal',
          terminalReason: terminal,
          reviewState:
            terminal === 'completed' && state.observedEvidence.changedFiles.length > 0
              ? 'ready'
              : 'not_applicable',
          updatedAt: timestamp(),
        },
        checkoutIdentity(state.workspacePath),
        'settled'
      )
      return
    }
    if (
      state.pendingInput ||
      state.pendingApproval ||
      state.hasPendingPiQueue ||
      state.lifecycle === 'paused' ||
      state.lifecycle === 'waiting' ||
      Object.keys(state.activeTools).length > 0
    )
      return
    const fingerprint = progressFingerprint(state)
    const repeatedNoProgressCount =
      fingerprint && fingerprint === state.lastProgressFingerprint
        ? state.repeatedNoProgressCount + 1
        : 0
    if (repeatedNoProgressCount >= 2) {
      this.save(
        {
          ...state,
          lifecycle: 'waiting',
          waitingReason: 'stalled',
          repeatedNoProgressCount,
          lastProgressFingerprint: fingerprint,
        },
        checkoutIdentity(state.workspacePath),
        'no_progress'
      )
      return
    }
    if (state.continuationCountThisCycle >= state.maxContinuationsThisCycle) {
      this.save(
        {
          ...state,
          lifecycle: 'waiting',
          waitingReason: 'continuation_budget_exhausted',
          updatedAt: timestamp(),
        },
        checkoutIdentity(state.workspacePath),
        'budget_exhausted'
      )
      return
    }
    const attempt = state.continuationCountThisCycle + 1
    const continuationId = `${state.id}:${state.runEpoch}:${state.contractVersion}:${attempt}`
    if (!this.store.scheduleDispatch(continuationId, state.id)) return
    const queued = transition(state, {
      ...state,
      lifecycle: 'continuation_queued',
      continuationCountThisCycle: attempt,
      continuationCountTotal: state.continuationCountTotal + 1,
      lastContinuationId: continuationId,
      lastProgressFingerprint: fingerprint,
      repeatedNoProgressCount,
    })
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

  private sendRunPrompt(state: RunState, text: string): void {
    if (!state.threadId) throw new Error('This Run has no active Pi thread.')
    this.send(state.threadId, {
      type: 'prompt',
      intent: 'run',
      runContext: {
        id: state.id,
        epoch: state.runEpoch,
        contractVersion: state.contractVersion,
      },
      text,
    })
  }

  private save(state: RunState, checkoutId: string, event: string): void {
    this.store.save(state, checkoutId, event)
    this.publish(state)
  }

  private requireState(runId: string, expectedStateVersion: number): RunState {
    const state = this.store.list().find((item) => item.id === runId)
    if (!state) throw new Error('Run not found.')
    if (state.stateVersion !== expectedStateVersion)
      throw new Error('This Run changed in another window. Refresh and try again.')
    return state
  }
}

function hasPendingQueue(event: Record<string, unknown>): boolean {
  const steering = Array.isArray(event.steering) ? event.steering : []
  const followUps = Array.isArray(event.followUp) ? event.followUp : []
  return steering.length > 0 || followUps.length > 0
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
