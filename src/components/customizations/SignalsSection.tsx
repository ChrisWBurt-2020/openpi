import { createSignal, onMount } from 'solid-js'
import { type InsightMode, insightModeSchema } from '../../lib/insights'

export function SignalsSection() {
  const [mode, setMode] = createSignal<InsightMode>('mentor')
  const [digest, setDigest] = createSignal(true)
  const [density, setDensity] = createSignal<'compact' | 'expanded'>('compact')
  onMount(() => {
    void Promise.all([
      window.openpi.getPref('insights.mode'),
      window.openpi.getPref('insights.show_digest'),
      window.openpi.getPref('insights.density'),
    ]).then(([savedMode, savedDigest, savedDensity]) => {
      const parsed = insightModeSchema.safeParse(savedMode)
      if (parsed.success) setMode(parsed.data)
      if (savedDigest === 'false') setDigest(false)
      if (savedDensity === 'expanded') setDensity('expanded')
    })
  })
  const saveMode = (next: InsightMode) => {
    setMode(next)
    void window.openpi.setPref('insights.mode', next)
  }
  const saveDigest = (next: boolean) => {
    setDigest(next)
    void window.openpi.setPref('insights.show_digest', String(next))
  }
  const saveDensity = (next: 'compact' | 'expanded') => {
    setDensity(next)
    void window.openpi.setPref('insights.density', next)
  }
  return (
    <section class="osp-section">
      <div class="osp-section-head">Pi Signals</div>
      <div class="osp-row">
        <div class="osp-row-left">
          <div class="osp-row-name">Teaching cadence</div>
          <div class="osp-row-desc">
            Mentor mode surfaces evidence-backed discoveries while Pi works.
          </div>
        </div>
        <select
          value={mode()}
          onChange={(event) => saveMode(event.currentTarget.value as InsightMode)}
        >
          <option value="off">Off</option>
          <option value="critical">Critical only</option>
          <option value="balanced">Balanced</option>
          <option value="mentor">Mentor</option>
        </select>
      </div>
      <div class="osp-row">
        <div class="osp-row-left">
          <div class="osp-row-name">Show session digest</div>
          <div class="osp-row-desc">Keep the Signals tab available in the right panel.</div>
        </div>
        <button
          class={`osp-toggle${digest() ? ' is-on' : ''}`}
          type="button"
          onClick={() => saveDigest(!digest())}
          role="switch"
          aria-checked={digest()}
        >
          <span class="osp-toggle-thumb" />
        </button>
      </div>
      <div class="osp-row osp-row-last">
        <div class="osp-row-left">
          <div class="osp-row-name">Card density</div>
          <div class="osp-row-desc">
            Compact keeps mentor mode informative without crowding the conversation.
          </div>
        </div>
        <select
          value={density()}
          onChange={(event) => saveDensity(event.currentTarget.value as 'compact' | 'expanded')}
        >
          <option value="compact">Compact</option>
          <option value="expanded">Expanded</option>
        </select>
      </div>
    </section>
  )
}
