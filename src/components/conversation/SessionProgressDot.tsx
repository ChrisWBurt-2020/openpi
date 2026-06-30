import { For, type Component } from 'solid-js'

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
const GRID = 5
const DOT_R = 1
const STEP = 3.6
const ORIGIN = 1.8
const SIZE = 18
const CYCLE_S = 4.5
const STEP_S = 0.18

export const SessionProgressDot: Component<{ status?: 'running' | 'background' }> = (
  props
) => {
  const status = () => props.status ?? 'running'
  const color = () =>
    status() === 'background' ? 'var(--task-warn, #b8860b)' : 'var(--ink)'

  return (
    <svg
      class="progress-dots"
      data-status={status()}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      style={{
        width: '18px',
        height: '18px',
        'flex-shrink': '0',
        'align-self': 'center',
        color: color(),
      }}
      aria-hidden="true"
    >
      <For each={Array.from({ length: GRID * GRID }, (_, i) => i)}>
        {(index) => {
          const row = Math.floor(index / GRID)
          const col = index % GRID
          const cx = ORIGIN + col * STEP
          const cy = ORIGIN + row * STEP
          const delay = -(index * STEP_S)
          return (
            <circle
              cx={cx}
              cy={cy}
              r={DOT_R}
              data-index={index}
              style={{
                fill: 'currentColor',
                animation: `session-progress-pulse ${CYCLE_S}s ease-in-out ${delay}s infinite`,
                '--progress-hi': '1',
                '--progress-lo': '0.15',
                'transition-property': '--progress-hi, --progress-lo, opacity',
                'transition-duration': '0.3s',
              }}
            />
          )
        }}
      </For>
    </svg>
  )
}
