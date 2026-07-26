import { describe, expect, it } from 'vitest'
import { unwrapSidecarIncoming } from '../electron/pi/messageEnvelope'

describe('sidecar message envelope', () => {
  it('keeps direct successful workspace results intact', () => {
    const result = {
      type: 'workspace_result',
      requestId: 'workspace-1',
      ok: true,
      data: { exitCode: 0, output: 'connected' },
    }
    expect(unwrapSidecarIncoming(result)).toEqual(result)
  })

  it('unwraps a utility-process message event', () => {
    const payload = { type: 'workspace_result', requestId: 'workspace-2', ok: false, error: 'nope' }
    expect(unwrapSidecarIncoming({ type: 'message', data: payload })).toEqual(payload)
  })
})
