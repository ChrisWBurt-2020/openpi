import { describe, expect, it, vi } from 'vitest'
import { createSidecarMessageHandler } from '../electron/pi/messages'
import { SessionEpochGate } from '../electron/pi/sessionEpoch'

/**
 * Reported: creating a new thread closes the current one and errors.
 *
 * The sidecar runs exactly ONE session, so a new thread disposes the live
 * session and builds another. Session events carry no session identity, so an
 * event still in flight when that happens is applied against whatever session
 * is open when it lands — the new thread inherits the outgoing thread's tail.
 */

describe('SessionEpochGate', () => {
  it('accepts events from the current session', () => {
    const gate = new SessionEpochGate()
    gate.observeReady(3)
    expect(gate.accepts(3)).toBe(true)
  })

  it('MUST drop events from a session the user has switched away from', () => {
    const gate = new SessionEpochGate()
    gate.observeReady(4)
    expect(gate.accepts(3)).toBe(false)
    expect(gate.accepts(1)).toBe(false)
  })

  it('accepts events that arrive ahead of their session_ready', () => {
    // The sidecar bumps the epoch before teardown, so events from the incoming
    // session can legitimately precede its session_ready.
    const gate = new SessionEpochGate()
    gate.observeReady(2)
    expect(gate.accepts(5)).toBe(true)
  })

  it('ignores a superseded session_ready', () => {
    const gate = new SessionEpochGate()
    gate.observeReady(4)
    expect(gate.observeReady(2)).toBe(false)
    expect(gate.current()).toBe(4)
  })

  it('treats an unstamped message as current rather than dropping it', () => {
    // Swallowing real events because an emitter forgot the stamp would be a
    // worse failure than the leak this guards against.
    const gate = new SessionEpochGate()
    gate.observeReady(9)
    expect(gate.accepts(undefined)).toBe(true)
    expect(gate.observeReady(undefined)).toBe(true)
  })

  it('starts over when the sidecar restarts', () => {
    const gate = new SessionEpochGate()
    gate.observeReady(7)
    gate.reset()
    expect(gate.accepts(1)).toBe(true)
  })
})

function makeHandler(epochGate: SessionEpochGate) {
  const sendToRenderer = vi.fn()
  const applySessionReady = vi.fn()
  const handler = createSidecarMessageHandler({
    getMainWindow: () => ({ webContents: { send: sendToRenderer } }) as never,
    normalizeSessionReady: (payload) => payload,
    applySessionReady,
    refreshSessionIndex: async () => {},
    resolveActiveCwd: () => null,
    showSystemNotification: vi.fn(),
    playSoundEffect: vi.fn(),
    getGitHost: async () => await import('../electron/git/gitHost'),
    emitSessionError: vi.fn(),
    emitOutputLine: vi.fn(),
    epochGate,
  })
  return { handler, sendToRenderer, applySessionReady }
}

describe('switching threads', () => {
  it('MUST NOT forward the outgoing thread late events to the new thread', () => {
    const gate = new SessionEpochGate()
    const { handler, sendToRenderer } = makeHandler(gate)

    // Thread A is live.
    handler({ type: 'session_ready', payload: { cwd: 'C:\\a' } as never, epoch: 1 })
    handler({ type: 'session_event', event: { type: 'message_start' }, epoch: 1 })
    expect(sendToRenderer).toHaveBeenCalledTimes(1)

    // User opens thread B; the sidecar bumps the epoch as it tears A down.
    handler({ type: 'session_ready', payload: { cwd: 'C:\\b' } as never, epoch: 2 })

    // A's in-flight event lands late. It must not reach the renderer.
    handler({ type: 'session_event', event: { type: 'agent_end' }, epoch: 1 })
    expect(sendToRenderer).toHaveBeenCalledTimes(1)

    // B's own events still flow.
    handler({ type: 'session_event', event: { type: 'message_start' }, epoch: 2 })
    expect(sendToRenderer).toHaveBeenCalledTimes(2)
  })
})

describe('sidecar restart', () => {
  it('accepts the restarted counter instead of reading it as stale', () => {
    const gate = new SessionEpochGate()
    const { handler, sendToRenderer } = makeHandler(gate)

    handler({ type: 'session_ready', payload: { cwd: 'C:\\a' } as never, epoch: 5 })
    // Crash + respawn: the sidecar's counter starts from zero again.
    handler({ type: 'ready' })
    handler({ type: 'session_event', event: { type: 'message_start' }, epoch: 1 })

    expect(sendToRenderer).toHaveBeenCalledTimes(1)
  })
})
