import { createSignal, For, onMount, Show } from 'solid-js'
import type { CompanionEvidenceRef } from '../../lib/companion'
import type { CompanionProjectView } from '../../lib/companionView'
import type { PetPackSummary } from '../../lib/petPack'
import { HeronSprite } from './HeronSprite'

interface Props {
  view: CompanionProjectView | undefined
}

type Tab = 'now' | 'signals' | 'profile'

function stateReason(view: CompanionProjectView): string {
  return view.activity.openLoop ?? (view.state.kind === 'idle' ? 'No evidence-backed work is currently open.' : view.evidence[0]?.label ?? 'Evidence is unavailable.')
}

function evidence(view: CompanionProjectView): CompanionEvidenceRef[] {
  return view.evidence
}

export function CompanionPanel(props: Props) {
  const [tab, setTab] = createSignal<Tab>('now')
  const [packs, setPacks] = createSignal<PetPackSummary[]>([])
  onMount(() => {
    void window.openpi.companion.listPacks().then(setPacks).catch(() => setPacks([]))
  })
  const updateAppearance = (view: CompanionProjectView, patch: Partial<CompanionProjectView['profile']['appearance']>) =>
    void window.openpi.companion.updateProfile({
      projectId: view.projectId,
      expectedRevision: view.profile.revision,
      patch: { appearance: { ...view.profile.appearance, ...patch } },
    })
  return (
    <section class="companion-panel" aria-label="Project companion">
      <Show
        when={props.view}
        fallback={<p class="companion-empty">Select a project to see its companion.</p>}
      >
        {(profile) => (
          <>
            <header
              class="companion-panel-header"
              style={{ '--heron-accent': profile().sprite.palette.accent }}
            >
              <HeronSprite view={profile()} size={64} />
              <div>
                <h2>{profile().profile.displayName}</h2>
                <p>{profile().state.kind}</p>
              </div>
            </header>
            <div class="companion-panel-tabs" role="tablist" aria-label="Companion details">
              <For each={['now', 'signals', 'profile'] as const}>
                {(item) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab() === item}
                    classList={{ active: tab() === item }}
                    onClick={() => setTab(item)}
                  >
                    {item[0].toUpperCase() + item.slice(1)}
                  </button>
                )}
              </For>
            </div>
            <Show when={tab() === 'now'}>
              <div class="companion-panel-body">
                <p class="companion-reason">{stateReason(profile())}</p>
                <h3>Evidence</h3>
                <EvidenceList profile={profile()} />
              </div>
            </Show>
            <Show when={tab() === 'signals'}>
              <div class="companion-panel-body">
                <p>Signals appear here only when indexed from verified Pi events.</p>
                <EvidenceList profile={profile()} />
              </div>
            </Show>
            <Show when={tab() === 'profile'}>
              <div class="companion-panel-body">
                <p>
                  Project color{' '}
                  <span class="companion-color" style={{ background: profile().sprite.palette.accent }} />
                </p>
                <button
                  type="button"
                  onClick={() =>
                    updateAppearance(profile(), { pinned: !profile().profile.appearance.pinned })
                  }
                >
                  {profile().profile.appearance.pinned ? 'Unpin desktop heron' : 'Pin desktop heron'}
                </button>
                <p class="companion-profile-note">
                  Desktop controls are saved per project and never affect agent execution.
                </p>
                <div class="companion-profile-actions">
                  <button type="button" onClick={() => updateAppearance(profile(), { motion: profile().profile.appearance.motion === 'full' ? 'reduced' : 'full' })}>
                    Motion: {profile().profile.appearance.motion}
                  </button>
                  <button type="button" onClick={() => updateAppearance(profile(), { alwaysOnTop: !profile().profile.appearance.alwaysOnTop })}>
                    {profile().profile.appearance.alwaysOnTop ? 'Disable always on top' : 'Always on top'}
                  </button>
                  <button type="button" onClick={() => updateAppearance(profile(), { visible: !profile().profile.appearance.visible })}>
                    {profile().profile.appearance.visible ? 'Hide desktop pet' : 'Show desktop pet'}
                  </button>
                </div>
                <h3>Pet Library</h3>
                <div class="companion-pack-list">
                  <For each={packs()}>
                    {(pack) => (
                      <button
                        type="button"
                        classList={{ active: pack.id === profile().profile.appearance.petPackId }}
                        onClick={() => updateAppearance(profile(), { petPackId: pack.id })}
                      >
                        {pack.displayName}
                      </button>
                    )}
                  </For>
                </div>
                <button
                  type="button"
                  onClick={() => void window.openpi.companion.importPack().then(() => window.openpi.companion.listPacks()).then(setPacks)}
                >
                  Import local pet pack
                </button>
              </div>
            </Show>
          </>
        )}
      </Show>
    </section>
  )
}

function EvidenceList(props: { profile: CompanionProjectView }) {
  return (
    <ul class="companion-evidence-list">
      <For each={evidence(props.profile)} fallback={<li>No evidence required while idle.</li>}>
        {(entry) => (
          <li>
            <button
              type="button"
              disabled={!entry.uri || entry.available === false}
              onClick={() => entry.uri && void window.openpi.companion.openEvidence(props.profile.projectPath, entry.uri)}
            >
              {entry.label}
            </button>
            <small>{entry.available === false ? 'unavailable' : entry.kind}</small>
          </li>
        )}
      </For>
    </ul>
  )
}
