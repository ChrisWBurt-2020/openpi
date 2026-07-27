import type { Component } from 'solid-js'
import type { CompanionOperationalState } from '../../lib/companion'

interface HeronProps {
  state: CompanionOperationalState
  label?: string
  class?: string
}

export const Heron: Component<HeronProps> = (props) => (
  <svg
    class={`heron heron-${props.state.kind} ${props.class ?? ''}`}
    viewBox="0 0 120 120"
    role="img"
    aria-label={props.label ?? `Heron ${props.state.kind}`}
  >
    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path
        class="heron-body"
        d="M61 18c11 9 17 20 13 31l20 16-26 8-9 29-9-27-25-12 22-12c-2-12 3-22 13-30Z"
        stroke-width="4"
      />
      <path d="M61 18 54 52m7 21 19 20M48 51 27 63m41-14 25-11" stroke-width="2.5" opacity=".7" />
      {props.state.kind === 'idle' && (
        <path d="M28 102h64M55 102l4-20m12 20-4-20" stroke-width="3" />
      )}
      {props.state.kind === 'active' && (
        <path d="M12 67c12-12 22-16 33-15M75 51c13-1 23 4 33 16" stroke-width="2.5" opacity=".72" />
      )}
      {props.state.kind === 'review' && <circle cx="66" cy="25" r="3" fill="currentColor" />}
      {props.state.kind === 'blocked' && <path d="m33 66 28 7 25-7-25 25Z" stroke-width="3" />}
      {props.state.kind === 'error' && (
        <g class="heron-storm">
          <path d="M19 30c8-12 27-11 33 1 10-7 28 1 27 14H19c-9-4-7-12 0-15Z" stroke-width="3" />
          <path d="m35 51-5 12m19-12-5 12m19-12-5 12" stroke-width="2.5" />
        </g>
      )}
      {props.state.kind === 'unknown' && <path d="M26 31c8-8 18-8 26 0m16 0c8-8 18-8 26 0" stroke-width="2.5" opacity=".55" />}
    </g>
  </svg>
)
