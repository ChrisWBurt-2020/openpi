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
        class="confirm-dialog-backdrop"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onCancel()
        }}
      >
        <div
          class="confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="confirm-dialog-header">
            <span id="confirm-dialog-title" class="confirm-dialog-title">
              {props.title}
            </span>
          </div>
          <p class="confirm-dialog-body">{props.message}</p>
          <div class="confirm-dialog-footer">
            <button
              type="button"
              class="confirm-dialog-btn confirm-dialog-btn-ghost"
              onClick={props.onCancel}
            >
              {props.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              class="confirm-dialog-btn confirm-dialog-btn-danger"
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
