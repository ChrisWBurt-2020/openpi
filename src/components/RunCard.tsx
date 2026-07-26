import { CirclePause, CirclePlay, LoaderCircle, Square, TriangleAlert } from 'lucide-solid'
import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { RunState } from '../lib/runs'

interface RunCardProps {
  threadId: string | null
  workspacePath: string
}

function labelFor(run: RunState): string {
  if (run.lifecycle === 'waiting' && run.waitingReason === 'user_input') return 'Needs your input'
  if (run.lifecycle === 'waiting' && run.waitingReason === 'continuation_budget_exhausted')
    return 'Needs attention'
  if (run.lifecycle === 'waiting' && run.waitingReason === 'stalled') return 'Stalled'
  if (run.lifecycle === 'terminal' && run.reviewState === 'ready') return 'Ready for review'
  if (run.lifecycle === 'terminal') return run.terminalReason ?? 'Finished'
  if (run.lifecycle === 'continuation_queued') return 'Continuing'
  return run.phase ? `${run.phase[0]?.toUpperCase() ?? ''}${run.phase.slice(1)}` : run.lifecycle
}

export function RunCard(props: RunCardProps) {
  const [run, setRun] = createSignal<RunState | null>(null)
  const [answer, setAnswer] = createSignal('')
  const [request, setRequest] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  let cardElement: HTMLElement | undefined

  const refresh = async () => {
    if (!props.threadId || !props.workspacePath) return setRun(null)
    const runs = await window.openpi.listRuns(props.workspacePath)
    setRun(runs.find((item) => item.threadId === props.threadId) ?? null)
  }

  onMount(() => {
    void refresh()
    const unsubscribe = window.openpi.onRunChanged((next) => {
      if (next.threadId === props.threadId) setRun(next)
    })
    const focus = () => cardElement?.focus()
    document.addEventListener('openpi:focus-run', focus)
    onCleanup(() => {
      unsubscribe()
      document.removeEventListener('openpi:focus-run', focus)
    })
  })
  createEffect(() => {
    props.threadId
    props.workspacePath
    void refresh()
  })

  const invoke = async (action: () => Promise<RunState>) => {
    try {
      setError(null)
      setRun(await action())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <Show when={run()} keyed>
      {(active) => (
        <section
          ref={cardElement}
          class="run-card"
          aria-label="Experimental Run status"
          tabIndex={-1}
        >
          <header>
            <span class="run-card-title">
              <LoaderCircle
                classList={{ 'run-card-spin': active.lifecycle === 'active' }}
                size={15}
              />
              Run <em>Experimental</em>
            </span>
            <strong>{labelFor(active)}</strong>
          </header>
          <p>
            {active.executionMode === 'ssh-workspace'
              ? 'Local models · SSH workspace'
              : active.executionMode === 'persistent-runner'
                ? 'Remote models · Persistent runner'
                : 'Local models · This PC'}
            {' · '} {active.continuationCountThisCycle}/{active.maxContinuationsThisCycle}{' '}
            continuations
          </p>
          <Show when={Object.values(active.activeTools).length > 0}>
            <div class="run-card-tools">
              <For each={Object.values(active.activeTools)}>
                {(tool) => <span>{tool.label ?? tool.toolName}</span>}
              </For>
            </div>
          </Show>
          <Show when={active.lastCheckpoint}>
            {(checkpoint) => <p class="run-card-checkpoint">{checkpoint().summary}</p>}
          </Show>
          <Show when={active.recoveryNotice}>
            <p class="run-card-notice">
              <TriangleAlert size={14} /> {active.recoveryNotice}
            </p>
          </Show>
          <Show when={active.pendingInput}>
            {(input) => (
              <div class="run-card-input">
                <strong>{input().question}</strong>
                <p>{input().reason}</p>
                <div class="run-card-options">
                  <For each={input().options ?? []}>
                    {(option) => (
                      <button type="button" onClick={() => setAnswer(option.label)}>
                        {option.label}
                      </button>
                    )}
                  </For>
                </div>
                <textarea
                  value={answer()}
                  onInput={(event) => setAnswer(event.currentTarget.value)}
                />
                <button
                  type="button"
                  disabled={!answer().trim()}
                  onClick={() =>
                    void invoke(async () => {
                      const result = await window.openpi.answerRunInput(
                        active.id,
                        answer().trim(),
                        active.stateVersion
                      )
                      setAnswer('')
                      return result
                    })
                  }
                >
                  Continue Run
                </button>
              </div>
            )}
          </Show>
          <Show when={active.reviewState === 'ready'}>
            <div class="run-card-review">
              <button
                type="button"
                onClick={() => document.dispatchEvent(new Event('openpi:open-review'))}
              >
                Open review
              </button>
              <button
                type="button"
                onClick={() =>
                  void invoke(() => window.openpi.acceptRunReview(active.id, active.stateVersion))
                }
              >
                Accept
              </button>
              <textarea
                placeholder="Request changes"
                value={request()}
                onInput={(event) => setRequest(event.currentTarget.value)}
              />
              <button
                type="button"
                disabled={!request().trim()}
                onClick={() =>
                  void invoke(async () => {
                    const result = await window.openpi.requestRunChanges(
                      active.id,
                      request().trim(),
                      active.stateVersion
                    )
                    setRequest('')
                    return result
                  })
                }
              >
                Request changes
              </button>
            </div>
          </Show>
          <Show when={active.lifecycle !== 'terminal'}>
            <footer>
              <button
                type="button"
                onClick={() =>
                  void invoke(() => window.openpi.pauseRun(active.id, 'now', active.stateVersion))
                }
              >
                <CirclePause size={14} /> Pause now
              </button>
              <button
                type="button"
                onClick={() =>
                  void invoke(() =>
                    window.openpi.pauseRun(active.id, 'after_tool', active.stateVersion)
                  )
                }
              >
                Pause after tool
              </button>
              <button
                type="button"
                onClick={() =>
                  void invoke(() => window.openpi.cancelRun(active.id, active.stateVersion))
                }
              >
                <Square size={14} /> End Run
              </button>
            </footer>
          </Show>
          <Show
            when={
              active.lifecycle === 'paused' ||
              active.waitingReason === 'continuation_budget_exhausted'
            }
          >
            <button
              type="button"
              onClick={() =>
                void invoke(() => window.openpi.resumeRun(active.id, active.stateVersion))
              }
            >
              <CirclePlay size={14} /> Resume
            </button>
          </Show>
          <Show when={error()}>{(message) => <p class="run-card-error">{message()}</p>}</Show>
        </section>
      )}
    </Show>
  )
}
