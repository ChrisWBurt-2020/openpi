import { describe, expect, it } from 'vitest'
import { remoteRunControl } from '../electron/remote/runControl'

const context = { id: 'run', epoch: 1, contractVersion: 2 }

describe('remote Run control projection', () => {
  it('accepts a validated outcome emitted in a remote tool result', () => {
    const event = remoteRunControl({
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      result: {
        details: {
          openpiRunControl: {
            type: 'outcome',
            context,
            payload: { status: 'completed', contractVersion: 2, summary: 'Done.' },
          },
        },
      },
    })
    expect(event).toMatchObject({ type: 'outcome', toolCallId: 'tool-1' })
  })

  it('drops malformed remote control details without disturbing the event stream', () => {
    expect(
      remoteRunControl({
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        result: { details: { openpiRunControl: { type: 'outcome', context, payload: {} } } },
      })
    ).toBeNull()
  })
})
