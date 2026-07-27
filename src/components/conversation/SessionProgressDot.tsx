import type { Component } from 'solid-js'
import operationUrl from '../../assets/companion/loading/loading-operation-master.png?url'

/**
 * 5x5 animated SVG dot grid (opencode v2 SessionProgressIndicatorV2 pattern).
 *
 * Uses CSS custom properties (@property registered) for per-dot animation
 * bounds. The keyframe references --progress-hi and --progress-lo which
 * each dot sets inline, so each dot can have its own lo/hi opacity range
 * and a deterministic per-dot delay. This is the same pattern as
 * assistant-ui's DotMatrix and opencode-desktop's progress indicator.
 *
 * Modes:
 *  - 'running'    - accent color, used for foreground/active tools.
 *  - 'background' - warn color, used for background handoff tasks.
 */
export const SessionProgressDot: Component<{ status?: 'running' | 'background' }> = (props) => {
  const status = () => props.status ?? 'running'

  return (
    <img
      class="session-progress-heron"
      data-status={status()}
      src={operationUrl}
      alt=""
      aria-hidden="true"
    />
  )
}
