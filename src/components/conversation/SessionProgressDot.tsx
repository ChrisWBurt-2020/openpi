import type { Component } from 'solid-js'

/**
 * 5×5 animated SVG dot grid (opencode v2 `SessionProgressIndicatorV2` pattern).
 *
 * Used as the universal "still running" indicator across every tool row
 * (replaces the older single `·` `tool-streaming-dot`). Each cell fades
 * in a cascading sequence so the grid reads as a heartbeat / clock face
 * rather than a generic loading spinner.
 *
 * Modes:
 *  - `running`   — accent color, used for foreground/active tools.
 *  - `background` — warn color, used when the tool is a background handoff
 *                  (e.g. a `task` call that returns immediately while the
 *                  sub-agent continues in `.pi/artifacts/`).
 */
const GRID = 5
const DOT = 2
const GAP = 1
const ORIGIN = 1.5
const SIZE = ORIGIN * 2 + GRID * DOT + (GRID - 1) * GAP

export const SessionProgressDot: Component<{ status?: 'running' | 'background' }> = (
  props
) => {
  const status = () => props.status ?? 'running'
  const cells = Array.from({ length: GRID * GRID }, (_, index) => {
    const x = ORIGIN + (index % GRID) * (DOT + GAP)
    const y = ORIGIN + Math.floor(index / GRID) * (DOT + GAP)
    return { index, x, y }
  })

  return (
    <svg
      class="progress-dots"
      data-status={status()}
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden="true"
    >
      {cells.map((c) => (
        <rect
          x={c.x}
          y={c.y}
          width={DOT}
          height={DOT}
          rx={0.5}
          class="progress-cell"
          data-index={c.index}
        />
      ))}
    </svg>
  )
}
