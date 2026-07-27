import { type Component, Show } from 'solid-js'
import historyUrl from '../../assets/companion/loading/loading-history-master.png?url'
import operationUrl from '../../assets/companion/loading/loading-operation-master.png?url'
import sessionUrl from '../../assets/companion/loading/loading-session-master.png?url'

export type HeronLoaderPhase = 'session' | 'history' | 'operation'

interface HeronLoaderProps {
  phase: HeronLoaderPhase
  label?: string
  compact?: boolean
}

const sources: Record<HeronLoaderPhase, string> = {
  session: sessionUrl,
  history: historyUrl,
  operation: operationUrl,
}

export const HeronLoader: Component<HeronLoaderProps> = (props) => (
  <div
    classList={{ 'heron-loader': true, 'heron-loader--compact': props.compact }}
    data-phase={props.phase}
  >
    <img src={sources[props.phase]} alt="" aria-hidden="true" />
    <Show when={props.label}>{(label) => <span>{label()}</span>}</Show>
  </div>
)
