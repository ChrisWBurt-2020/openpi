import { describe, expect, it } from 'vitest'
import type { SessionReady } from '../src/lib/ipc'
import {
  applyThreadSessionEvent,
  applyThreadSessionReady,
  type ThreadSessionSnapshot,
} from '../src/lib/threadSessionState'

const model = {
  id: 'model-1',
  name: 'Model One',
  provider: 'test',
  reasoning: true,
  contextWindow: 100_000,
}

function ready(sessionFile: string, sessionName: string): SessionReady {
  return {
    cwd: '/workspace',
    sessionFile,
    sessionId: sessionFile,
    sessionName,
    model,
    thinkingLevel: 'medium',
  }
}

function snapshot(threadId: string): ThreadSessionSnapshot {
  return applyThreadSessionReady(undefined, threadId, ready(`/${threadId}.jsonl`, threadId))
    .snapshot
}

describe('thread session state', () => {
  it('keeps concurrent transcripts isolated', () => {
    const threadA = applyThreadSessionEvent(snapshot('a'), {
      type: 'message_start',
      message: { role: 'assistant', timestamp: 1 },
    })
    const threadB = applyThreadSessionEvent(snapshot('b'), {
      type: 'message_start',
      message: { role: 'assistant', timestamp: 2 },
    })

    const updatedA = applyThreadSessionEvent(threadA, {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'alpha' },
    })
    const updatedB = applyThreadSessionEvent(threadB, {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'beta' },
    })

    expect(updatedA.messages[0]?.text).toBe('alpha')
    expect(updatedB.messages[0]?.text).toBe('beta')
  })

  it('retains live state when a thread is selected again', () => {
    const running = applyThreadSessionEvent(snapshot('a'), { type: 'agent_start' }, 100)
    const queued = applyThreadSessionEvent(running, {
      type: 'queue_update',
      steering: ['change direction'],
      followUp: ['run tests'],
    })

    const reopened = applyThreadSessionReady(queued, 'a', {
      ...ready('/a.jsonl', 'Renamed'),
      model: null,
      thinkingLevel: null,
    })

    expect(reopened.created).toBe(false)
    expect(reopened.snapshot.isStreaming).toBe(true)
    expect(reopened.snapshot.steeringQueue).toEqual(['change direction'])
    expect(reopened.snapshot.followUpQueue).toEqual(['run tests'])
    expect(reopened.snapshot.currentModel).toEqual(model)
    expect(reopened.snapshot.thinkingLevel).toBe('medium')
    expect(reopened.snapshot.sessionName).toBe('Renamed')
  })

  it('tracks turn timing and run metrics independently', () => {
    const startedA = applyThreadSessionEvent(snapshot('a'), { type: 'agent_start' }, 1_000)
    const startedB = applyThreadSessionEvent(snapshot('b'), { type: 'agent_start' }, 2_000)
    const turnA = applyThreadSessionEvent(startedA, { type: 'turn_start', timestamp: 1_100 }, 1_100)
    const turnB = applyThreadSessionEvent(startedB, { type: 'turn_start', timestamp: 2_200 }, 2_200)

    const endedA = applyThreadSessionEvent(
      turnA,
      {
        type: 'agent_end',
        messages: [{ role: 'assistant', usage: { output: 20 } }],
      },
      3_000
    )

    expect(endedA.runMetrics).toEqual({ elapsedMs: 2_000, output: 20, tps: 10 })
    expect(endedA.currentTurnStartMs).toBeNull()
    expect(turnB.currentTurnStartMs).toBe(2_200)
    expect(turnB.isStreaming).toBe(true)
  })

  it('changes prompt mode only for the thread awaiting its own start', () => {
    const waiting = { ...snapshot('a'), awaitingPromptStart: true }
    const idle = snapshot('b')

    const startedA = applyThreadSessionEvent(waiting, { type: 'agent_start' }, 100)
    const startedB = applyThreadSessionEvent(idle, { type: 'agent_start' }, 100)

    expect(startedA.queueMode).toBe('steer')
    expect(startedB.queueMode).toBe('prompt')
  })
})
