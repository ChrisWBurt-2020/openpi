import type { Component } from 'solid-js'
import blockedUrl from '../../assets/companion/status/status-blocked-master.png?url'
import errorUrl from '../../assets/companion/status/status-error-master.png?url'
import reviewUrl from '../../assets/companion/status/status-review-master.png?url'
import successUrl from '../../assets/companion/status/status-success-master.png?url'
import warningUrl from '../../assets/companion/status/status-warning-master.png?url'

export type StatusMarkKind = 'success' | 'review' | 'blocked' | 'warning' | 'error'

interface StatusMarkProps {
  kind: StatusMarkKind
  decorative?: boolean
}

const sources: Record<StatusMarkKind, string> = {
  success: successUrl,
  review: reviewUrl,
  blocked: blockedUrl,
  warning: warningUrl,
  error: errorUrl,
}

export const StatusMark: Component<StatusMarkProps> = (props) => (
  <img
    class="heron-status-mark"
    data-kind={props.kind}
    src={sources[props.kind]}
    alt={props.decorative ? '' : `${props.kind} status`}
    aria-hidden={props.decorative ? 'true' : undefined}
  />
)
