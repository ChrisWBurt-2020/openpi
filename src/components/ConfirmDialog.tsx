import { Show } from 'solid-js'

type Props = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog(props: Props) {
  return (
    <Show when={props.open}>
      <div
        class="extension-ui-overlay ask-overlay"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onCancel()
        }}
      >
        <div class="ask-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
          <div class="ask-modal-header">
            <span id="confirm-dialog-title" class="ask-modal-title">
              {props.title}
            </span>
          </div>
          <p class="ask-modal-body">{props.message}</p>
          <div class="ask-modal-footer">
            <button type="button" class="ask-btn ask-btn-ghost" onClick={props.onCancel}>
              {props.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              class="ask-btn confirm-dialog-danger"
              onClick={props.onConfirm}
            >
              {props.confirmLabel ?? 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
