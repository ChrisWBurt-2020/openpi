import { Show } from 'solid-js'
import type { CompanionProjectView } from '../../lib/companionView'
import { HeronSprite } from './HeronSprite'

export function HeronBadge(props: { view: CompanionProjectView | undefined }) {
  return (
    <Show when={props.view}>
      {(view) => (
        <span
          class="heron-badge"
          style={{ color: view().sprite.palette.accent, '--heron-glow': view().sprite.palette.alert }}
          title={`Heron: ${view().state.kind}`}
        >
          <HeronSprite view={view()} rail />
        </span>
      )}
    </Show>
  )
}
