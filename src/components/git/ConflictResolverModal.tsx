/**
 * ConflictResolverModal — merge-conflict resolution surface.
 *
 * Uses @pierre/diffs UnresolvedFile for current/incoming/both resolution UI.
 * Renderer collects intent only; saving resolved content goes through Electron main
 * via window.openpi.writeFile().
 */

import type { FileContents } from '@pierre/diffs'
import { UnresolvedFile } from '@pierre/diffs'
import { X } from 'lucide-solid'
import { createEffect, createSignal, onCleanup, Show } from 'solid-js'

interface ConflictResolverModalProps {
  path: string
  cwd?: string | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}

function ConflictRenderer(props: {
  file: FileContents
  onResolvedContent: (content: string) => void
}) {
  let containerRef!: HTMLDivElement
  let instance: UnresolvedFile | null = null

  createEffect(() => {
    if (!containerRef) return
    if (!instance) {
      instance = new UnresolvedFile({
        theme: 'pierre-dark',
        themeType: 'dark',
        disableFileHeader: true,
        mergeConflictActionsType: 'default',
        onMergeConflictResolve(file) {
          props.onResolvedContent(file.contents)
        },
      })
    }
    instance.render({ file: props.file, containerWrapper: containerRef, forceRender: true })
  })

  onCleanup(() => {
    instance?.cleanUp()
    instance = null
  })

  return <div ref={containerRef!} class="git-conflict-renderer" />
}

export function ConflictResolverModal(props: ConflictResolverModalProps) {
  const [content, setContent] = createSignal<string | null>(null)
  const [resolvedContent, setResolvedContent] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(() => {
    const path = props.path
    let cancelled = false
    setLoading(true)
    setError(null)
    setResolvedContent(null)

    void window.openpi
      .readFile(path)
      .then((result) => {
        if (cancelled) return
        if (!result) {
          setError('Could not read conflicted file.')
          setContent(null)
          return
        }
        setContent(result.content)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    onCleanup(() => {
      cancelled = true
    })
  })

  const saveResolved = async () => {
    const next = resolvedContent()
    if (!next || saving()) return
    setSaving(true)
    setError(null)
    try {
      await window.openpi.writeFile(props.path, next, props.cwd ?? undefined)
      await props.onSaved()
      props.onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const file = () => {
    const value = content()
    if (value == null) return null
    return {
      name: props.path,
      contents: value,
      cacheKey: `conflict:${props.path}:${value.length}`,
    } satisfies FileContents
  }

  return (
    <div class="git-conflict-overlay" role="dialog" aria-label="Resolve merge conflict">
      <div class="git-conflict-header">
        <div class="git-conflict-title">
          <strong>Resolve conflict</strong>
          <span>{props.path}</span>
        </div>
        <div class="git-conflict-actions">
          <button
            type="button"
            class="git-conflict-save-btn"
            onClick={() => void saveResolved()}
            disabled={!resolvedContent() || saving()}
            title="Save resolved file"
          >
            {saving() ? 'Saving…' : 'Save Resolved'}
          </button>
          <button
            type="button"
            class="git-conflict-close-btn"
            onClick={props.onClose}
            title="Close"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="git-conflict-error">{error()}</div>
      </Show>

      <div class="git-conflict-body">
        <Show when={loading()}>
          <div class="git-conflict-state">Loading conflicted file…</div>
        </Show>
        <Show when={!loading() && file()}>
          {(getFile) => (
            <ConflictRenderer file={getFile()} onResolvedContent={setResolvedContent} />
          )}
        </Show>
      </div>
    </div>
  )
}
