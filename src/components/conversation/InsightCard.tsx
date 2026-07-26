import {
  Bug,
  ChevronDown,
  Copy,
  Lightbulb,
  Save,
  ShieldAlert,
  Sparkles,
  Telescope,
} from 'lucide-solid'
import { type Component, createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { type InsightCategory, insightPayloadSchema } from '../../lib/insights'
import type { ToolCard } from '../../types/session'

interface InsightCardProps {
  card: ToolCard
  workspacePath?: string
  sessionPath?: string | null
  onFileClick?: (path: string) => void
}

const CATEGORY: Record<
  InsightCategory,
  { label: string; color: string; icon: Component<{ size?: number }> }
> = {
  architecture: { label: 'Architecture', color: '#9b7bff', icon: Telescope },
  pattern: { label: 'Pattern', color: '#42c98c', icon: Sparkles },
  tradeoff: { label: 'Trade-off', color: '#67a7ff', icon: Lightbulb },
  risk: { label: 'Risk', color: '#eab35a', icon: ShieldAlert },
  debugging: { label: 'Debugging', color: '#ef7589', icon: Bug },
  learning: { label: 'Learning', color: '#55c9df', icon: Lightbulb },
}
const FALLBACK_INSIGHT = {
  category: 'learning' as const,
  title: 'Unavailable signal',
  explanation: 'This saved signal could not be read.',
  whyItMatters: undefined,
  evidence: [
    { type: 'command' as const, command: 'unavailable', description: 'Malformed signal payload' },
  ],
  confidence: 'low' as const,
  basis: 'inferred' as const,
  knowledgeCandidate: false,
}

function safePath(value: string): boolean {
  return (
    !value.startsWith('/') &&
    !value.startsWith('\\') &&
    !/^[a-z]:/i.test(value) &&
    !value.split(/[\\/]/).includes('..')
  )
}

export const InsightCard: Component<InsightCardProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [dismissed, setDismissed] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  const insight = createMemo(() => insightPayloadSchema.safeParse(props.card.args))
  const parsed = () => (insight().success ? insight().data : null)
  const signalValue = () => parsed() ?? FALLBACK_INSIGHT

  onMount(() => {
    void window.openpi.getPref('insights.density').then((density) => {
      if (density === 'expanded') setOpen(true)
    })
    if (!props.sessionPath) return
    void window.openpi.insights.listState(props.sessionPath).then((state) => {
      setDismissed(state[props.card.toolCallId]?.dismissed === true)
    })
  })

  const dismiss = () => {
    setDismissed(true)
    if (props.sessionPath)
      void window.openpi.insights.setDismissed(props.sessionPath, props.card.toolCallId, true)
  }
  const save = () => {
    const value = parsed()
    if (!value || !props.workspacePath) return
    void window.openpi.insights
      .save({
        workspacePath: props.workspacePath,
        sessionPath: props.sessionPath ?? null,
        toolCallId: props.card.toolCallId,
        insight: value,
      })
      .then(() => setSaved(true))
  }
  const askPi = () => {
    const value = parsed()
    if (!value) return
    document.dispatchEvent(new CustomEvent('openpi:ask-insight', { detail: value }))
  }
  const copy = () => {
    const value = parsed()
    if (!value) return
    void navigator.clipboard.writeText(
      `${value.title}\n\n${value.explanation}${value.whyItMatters ? `\n\nWhy it matters: ${value.whyItMatters}` : ''}`
    )
  }

  return (
    <Show when={parsed() && !dismissed()}>
      {(() => {
        const signal = signalValue()
        const meta = () => CATEGORY[signal.category]
        return (
          <article class="pi-signal-card" style={`--signal: ${meta().color}`}>
            <button
              class="pi-signal-main"
              type="button"
              onClick={() => setOpen((current) => !current)}
              aria-expanded={open()}
            >
              <span class="pi-signal-star">
                <Sparkles size={15} />
              </span>
              <span class="pi-signal-copy">
                <span class="pi-signal-label">✦ {meta().label} signal</span>
                <strong>{signal.title}</strong>
                <span class="pi-signal-summary">{signal.explanation}</span>
              </span>
              <span class="pi-signal-meta">
                {signal.confidence} · {signal.basis}
              </span>
              <ChevronDown class={`pi-signal-chevron${open() ? ' is-open' : ''}`} size={15} />
            </button>
            <Show when={open()}>
              <div class="pi-signal-details">
                <Show when={signal.whyItMatters}>
                  <section>
                    <h4>Why it matters</h4>
                    <p>{signal.whyItMatters}</p>
                  </section>
                </Show>
                <section>
                  <h4>Evidence</h4>
                  <div class="pi-signal-evidence">
                    <For each={signal.evidence}>
                      {(evidence) =>
                        evidence.type === 'file' ? (
                          <button
                            type="button"
                            disabled={!safePath(evidence.path)}
                            onClick={() => props.onFileClick?.(evidence.path)}
                          >
                            {evidence.path}
                            {evidence.startLine
                              ? `:${evidence.startLine}${evidence.endLine && evidence.endLine !== evidence.startLine ? `–${evidence.endLine}` : ''}`
                              : ''}
                          </button>
                        ) : (
                          <code title={evidence.description}>{evidence.command}</code>
                        )
                      }
                    </For>
                  </div>
                </section>
                <footer>
                  <Show when={signal.knowledgeCandidate}>
                    <span class="pi-signal-candidate">Worth keeping</span>
                  </Show>
                  <button type="button" onClick={askPi}>
                    Ask Pi
                  </button>
                  <button type="button" onClick={copy}>
                    <Copy size={12} /> Copy
                  </button>
                  <button type="button" disabled={saved()} onClick={save}>
                    <Save size={12} /> {saved() ? 'Saved' : 'Save'}
                  </button>
                  <button type="button" onClick={dismiss}>
                    Dismiss
                  </button>
                </footer>
              </div>
            </Show>
          </article>
        )
      })()}
    </Show>
  )
}
