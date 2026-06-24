/**
 * DiffScopeSwitcher — Select which diff scope to show: unstaged, staged, or branch diff.
 *
 * Phase 3: Adds scope switching to the Git review pane.
 */

import { createSignal, For, Show } from 'solid-js'

export type DiffScope = 'unstaged' | 'staged' | 'branch'

interface DiffScopeSwitcherProps {
  value: DiffScope
  onChange: (scope: DiffScope) => void
  /** Whether a base branch was auto-detected. Only show branch scope if true. */
  hasBaseBranch?: boolean
  /** Disable while loading. */
  disabled?: boolean
}

const SCOPE_OPTIONS: { value: DiffScope; label: string; title: string }[] = [
  { value: 'unstaged', label: 'Unstaged', title: 'Working tree changes (git diff)' },
  { value: 'staged', label: 'Staged', title: 'Index changes (git diff --staged)' },
  { value: 'branch', label: 'Branch', title: 'Branch changes vs base' },
]

export function DiffScopeSwitcher(props: DiffScopeSwitcherProps) {
  const [open, setOpen] = createSignal(false)

  const currentOption = () => SCOPE_OPTIONS.find((o) => o.value === props.value) ?? SCOPE_OPTIONS[0]

  return (
    <div class="diff-scope-switcher">
      <button
        type="button"
        class="diff-scope-trigger"
        onClick={() => setOpen(!open())}
        disabled={props.disabled}
        aria-expanded={open()}
        aria-haspopup="listbox"
        title={currentOption().title}
      >
        <span class="diff-scope-label">{currentOption().label}</span>
        <span class="diff-scope-arrow">{open() ? '▲' : '▼'}</span>
      </button>

      <Show when={open()}>
        {/* Backdrop to dismiss */}
        <div class="diff-scope-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
        <div class="diff-scope-dropdown" role="listbox" aria-label="Diff scope">
          <For each={SCOPE_OPTIONS}>
            {(opt) => {
              const isDisabled = () => opt.value === 'branch' && !props.hasBaseBranch
              return (
                <button
                  type="button"
                  class={`diff-scope-option${props.value === opt.value ? ' is-active' : ''}${isDisabled() ? ' is-disabled' : ''}`}
                  role="option"
                  aria-selected={props.value === opt.value}
                  disabled={isDisabled()}
                  onClick={() => {
                    if (!isDisabled()) {
                      props.onChange(opt.value)
                      setOpen(false)
                    }
                  }}
                  title={
                    isDisabled()
                      ? 'No base branch detected — set tracking upstream first'
                      : opt.title
                  }
                >
                  <span class="diff-scope-option-label">{opt.label}</span>
                  <span class="diff-scope-option-desc">{opt.title}</span>
                </button>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
