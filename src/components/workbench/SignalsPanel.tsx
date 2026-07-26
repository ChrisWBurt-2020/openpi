import { BookOpen, MessageCircle, Sparkles, Trash2 } from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { type InsightPayload, insightPayloadSchema, type SavedInsight } from '../../lib/insights'
import type { Message } from '../../types/session'

interface SignalsPanelProps {
  workspacePath: string
  sessionPath: string | null
  messages: Message[]
  onFileClick: (path: string) => void
}

function insightsFromMessages(messages: Message[]): Array<{ id: string; insight: InsightPayload }> {
  return messages.flatMap((message) => {
    if (message.role !== 'assistant') return []
    return message.toolCards.flatMap((card) => {
      if (card.toolName !== 'emit_insight') return []
      const parsed = insightPayloadSchema.safeParse(card.args)
      return parsed.success ? [{ id: card.toolCallId, insight: parsed.data }] : []
    })
  })
}

export function SignalsPanel(props: SignalsPanelProps) {
  const [tab, setTab] = createSignal<'session' | 'notebook'>('session')
  const [notebook, setNotebook] = createSignal<SavedInsight[]>([])
  const [showDigest, setShowDigest] = createSignal(true)
  const signals = createMemo(() => insightsFromMessages(props.messages))

  const loadNotebook = () => {
    if (!props.workspacePath) return
    void window.openpi.insights
      .listSaved(props.workspacePath)
      .then(setNotebook)
      .catch(() => setNotebook([]))
  }
  createEffect(loadNotebook)
  onMount(() => {
    void window.openpi.getPref('insights.show_digest').then((value) => {
      setShowDigest(value !== 'false')
    })
  })

  const openFirstEvidence = (insight: InsightPayload) => {
    const evidence = insight.evidence.find((item) => item.type === 'file')
    if (evidence) props.onFileClick(evidence.path)
  }
  const teachPi = (insight: InsightPayload) => {
    document.dispatchEvent(new CustomEvent('openpi:ask-insight', { detail: insight }))
  }

  return (
    <div class="signals-panel">
      <div class="signals-tabs">
        <button
          classList={{ 'is-active': tab() === 'session' }}
          type="button"
          onClick={() => setTab('session')}
        >
          <Sparkles size={13} /> This session
        </button>
        <button
          classList={{ 'is-active': tab() === 'notebook' }}
          type="button"
          onClick={() => {
            setTab('notebook')
            loadNotebook()
          }}
        >
          <BookOpen size={13} /> Notebook
        </button>
      </div>
      <Show
        when={tab() === 'session'}
        fallback={
          <div class="signals-list">
            <Show
              when={notebook().length > 0}
              fallback={
                <p class="signals-empty">Save a strong signal to build your project notebook.</p>
              }
            >
              <For each={notebook()}>
                {(saved) => (
                  <article class="signals-item">
                    <span class="signals-item-category">{saved.category}</span>
                    <strong>{saved.title}</strong>
                    <p>{saved.explanation}</p>
                    <div>
                      <button type="button" onClick={() => openFirstEvidence(saved)}>
                        Open evidence
                      </button>
                      <button type="button" onClick={() => teachPi(saved)}>
                        <MessageCircle size={12} /> Teach Pi
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void window.openpi.insights.remove(saved.id).then(loadNotebook)
                        }
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </article>
                )}
              </For>
            </Show>
          </div>
        }
      >
        <div class="signals-list">
          <Show
            when={showDigest()}
            fallback={<p class="signals-empty">Session digest is hidden in Pi Signals settings.</p>}
          >
            <Show
              when={signals().length > 0}
              fallback={
                <p class="signals-empty">
                  Pi Signals will collect evidence-backed discoveries here as Pi works.
                </p>
              }
            >
              <For each={signals()}>
                {(signal) => (
                  <article class="signals-item">
                    <span class="signals-item-category">{signal.insight.category}</span>
                    <strong>{signal.insight.title}</strong>
                    <p>{signal.insight.explanation}</p>
                    <button type="button" onClick={() => openFirstEvidence(signal.insight)}>
                      Open evidence
                    </button>
                  </article>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  )
}
