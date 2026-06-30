import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it } from 'vitest'

import { AssistantMessageGroup } from '../src/components/conversation/Messages'
import { DEFAULT_DISPLAY_PREFERENCES } from '../src/lib/displayPreferences'
import type { SessionHistoryMessage } from '../src/lib/ipc'

const baseMessage: SessionHistoryMessage = {
  id: 'msg-1',
  role: 'assistant',
  text: '',
  streaming: false,
  toolCards: [
    {
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'src/index.ts' },
      output: 'ok',
      isError: false,
      streaming: false,
    },
    {
      toolCallId: 'tool-2',
      toolName: 'bash',
      args: { command: 'npm test' },
      output: 'running',
      isError: false,
      streaming: true,
    },
  ],
}

afterEach(() => cleanup())

describe('AssistantMessageGroup', () => {
  it('shimmers the running tool card while agent streaming is active', () => {
    const { container } = render(() => (
      <AssistantMessageGroup
        messages={[baseMessage]}
        agentStreaming={true}
        displayPreferences={DEFAULT_DISPLAY_PREFERENCES}
      />
    ))

    expect(container.querySelectorAll('.tool-shimmer-scope')).toHaveLength(2)
    expect(container.querySelectorAll('.tool-shimmer-scope.is-tool-shimmering')).toHaveLength(1)
  })

  it('shimmers the latest visible tool while tool streaming state is between events', () => {
    const betweenEvents: SessionHistoryMessage = {
      ...baseMessage,
      toolCards: baseMessage.toolCards.map((c) => ({ ...c, streaming: false })),
    }
    const { container } = render(() => (
      <AssistantMessageGroup
        messages={[betweenEvents]}
        agentStreaming={true}
        displayPreferences={DEFAULT_DISPLAY_PREFERENCES}
      />
    ))

    expect(container.querySelectorAll('.tool-shimmer-scope')).toHaveLength(2)
    expect(container.querySelectorAll('.tool-shimmer-scope.is-tool-shimmering')).toHaveLength(1)
  })

  it('does not shimmer any tool card when none are running', () => {
    const stopped: SessionHistoryMessage = {
      ...baseMessage,
      toolCards: baseMessage.toolCards.map((c) => ({ ...c, streaming: false })),
    }
    const { container } = render(() => (
      <AssistantMessageGroup
        messages={[stopped]}
        agentStreaming={false}
        displayPreferences={DEFAULT_DISPLAY_PREFERENCES}
      />
    ))

    expect(container.querySelectorAll('.tool-shimmer-scope')).toHaveLength(2)
    expect(container.querySelectorAll('.tool-shimmer-scope.is-tool-shimmering')).toHaveLength(0)
  })
})
