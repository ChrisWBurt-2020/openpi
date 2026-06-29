import { describe, expect, it } from 'vitest'
import { TaskTracker } from '../src/lib/extensionTrackers'

describe('TaskTracker (pi-task)', () => {
  it('tracks task tool start and foreground completion', () => {
    const tracker = new TaskTracker()
    expect(tracker.onToolStart('tc1', 'task', { agent_type: 'scout', description: 'Docs' })).toBe(
      true
    )
    expect(tracker.snapshot()).toHaveLength(1)
    expect(tracker.onToolEnd('tc1', 'task', 'Summary here', false, { phase: 'done' })).toBe(true)
    const snap = tracker.snapshot()[0]
    expect(snap.status).toBe('completed')
    expect(snap.result).toContain('Summary')
  })

  it('keeps background task running when tool ends with background receipt', () => {
    const tracker = new TaskTracker()
    tracker.onToolStart('tc2', 'task', {
      agent_type: 'worker',
      description: 'BG',
      background: true,
    })
    tracker.onToolEnd('tc2', 'task', 'Task abc started', false, {
      task_id: 'abc',
      background: true,
    })
    expect(tracker.snapshot()[0].status).toBe('running')
    expect(tracker.snapshot()[0].taskId).toBe('abc')
  })

  it('ignores non-task tools', () => {
    const tracker = new TaskTracker()
    expect(tracker.onToolStart('x', 'bash', {})).toBe(false)
  })

  it('clearFinished drops completed foreground tasks', () => {
    const tracker = new TaskTracker()
    tracker.onToolStart('tc3', 'task', {
      agent_type: 'worker',
      description: 'FG',
      background: false,
    })
    tracker.onToolEnd('tc3', 'task', 'done', false, { phase: 'done' })
    tracker.clearFinished()
    expect(tracker.snapshot()).toHaveLength(0)
  })

  it('forwards tool details for background receipt', () => {
    const tracker = new TaskTracker()
    tracker.onToolStart('tc4', 'task', {
      agent_type: 'scout',
      description: 'BG',
      background: true,
    })
    expect(
      tracker.onToolEnd('tc4', 'task', 'started', false, {
        task_id: 'tid-1',
        background: true,
      })
    ).toBe(true)
    expect(tracker.snapshot()[0]).toMatchObject({ status: 'running', taskId: 'tid-1' })
  })
})
