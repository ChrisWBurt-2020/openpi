import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { CompanionEvidenceRef } from '../../lib/companion'
import type { CompanionProjectView, CompanionViews } from '../../lib/companionView'
import { HeronSprite } from './HeronSprite'

type SiegeFilter = 'all' | 'attention' | 'active' | 'hidden'

function projectPath(): string | null {
  return new URLSearchParams(window.location.search).get('project')
}

function stateLabel(view: CompanionProjectView): string {
  return view.state.kind === 'idle'
    ? 'Idle'
    : view.state.kind === 'active'
      ? `Active · ${view.state.phase}`
      : view.state.kind === 'blocked'
        ? `Blocked · ${view.state.reason.replace('_', ' ')}`
        : view.state.kind[0].toUpperCase() + view.state.kind.slice(1)
}

function evidence(view: CompanionProjectView): CompanionEvidenceRef[] {
  return view.evidence
}

function hasAttention(view: CompanionProjectView): boolean {
  return view.attention !== null && !view.attention.acknowledged
}

function activityRank(view: CompanionProjectView): number {
  if (view.state.kind === 'error') return 5
  if (view.state.kind === 'unknown') return 4
  if (view.state.kind === 'blocked') return 3
  if (view.state.kind === 'review') return 2
  return view.state.kind === 'active' ? 1 : 0
}

function openProject(path: string) {
  void window.heron.activate(path)
}

function openEvidence(path: string, entry: CompanionEvidenceRef) {
  if (entry.uri) void window.heron.openEvidence(path, entry.uri)
}

export function Pet() {
  const [views, setViews] = createSignal<CompanionViews>({})
  const [details, setDetails] = createSignal(false)
  const [filter, setFilter] = createSignal<SiegeFilter>('all')
  const selected = () => projectPath()
  let clickTimer: number | undefined
  const profile = (): CompanionProjectView | undefined => {
    const path = selected()
    return path ? Object.values(views()).find((view) => view.projectPath === path) : undefined
  }
  const visibleProfiles = createMemo(() =>
    Object.values(views()).filter((item) => {
      if (filter() === 'attention') return hasAttention(item)
      if (filter() === 'active') return item.state.kind === 'active'
      if (filter() === 'hidden') return !item.profile.appearance.visible
      return true
    })
  )
  const activityTray = createMemo(() =>
    Object.values(views())
      .filter((item) => item.state.kind !== 'idle')
      .sort(
        (left, right) =>
          activityRank(right) - activityRank(left) ||
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.profile.displayName.localeCompare(right.profile.displayName)
      )
      .slice(0, 5)
  )

  onMount(() => {
    void window.heron.list().then(setViews)
    const unlisten = window.heron.onChanged(setViews)
    onCleanup(() => {
      unlisten()
      if (clickTimer !== undefined) window.clearTimeout(clickTimer)
    })
  })
  const toggleDetails = (item: CompanionProjectView) => {
    if (clickTimer !== undefined) window.clearTimeout(clickTimer)
    clickTimer = window.setTimeout(() => {
      const next = !details()
      setDetails(next)
      void window.heron.setExpanded(item.projectPath, next)
      clickTimer = undefined
    }, 280)
  }
  const openFromDoubleClick = (item: CompanionProjectView) => {
    if (clickTimer !== undefined) window.clearTimeout(clickTimer)
    clickTimer = undefined
    setDetails(false)
    void window.heron.setExpanded(item.projectPath, false)
    openProject(item.projectPath)
  }

  return (
    <main class={`heron-pet${selected() ? '' : ' heron-siege'}`}>
      <Show
        when={profile()}
        fallback={<Siege profiles={visibleProfiles()} filter={filter()} onFilter={setFilter} />}
      >
        {(item) => (
          <section
            class="pet-shell"
            style={{
              '--heron-accent': item().sprite.palette.accent,
              '--heron-glow': item().sprite.palette.alert,
            }}
          >
            <button
              type="button"
              class="pet-sprite-button"
              aria-label={`Open ${item().profile.displayName} companion`}
              onClick={() => toggleDetails(item())}
              onDblClick={() => openFromDoubleClick(item())}
              onContextMenu={(event) => {
                event.preventDefault()
                void window.heron.showMenu(item().projectPath)
              }}
            >
              <HeronSprite view={item()} />
            </button>
            <div class="pet-perch">
              <span>{item().profile.displayName}</span>
              <small>⠿ Drag to move · {stateLabel(item())}</small>
            </div>
            <button
              type="button"
              class="pet-inspect-toggle"
              onClick={() => {
                const next = !details()
                setDetails(next)
                void window.heron.setExpanded(item().projectPath, next)
              }}
              aria-expanded={details()}
            >
              Evidence
            </button>
            <Show when={details()}>
              <section class="pet-inspect" aria-label="Verified companion evidence">
                <p>
                  {item().activity.openLoop ??
                    (item().state.kind === 'idle' ? 'No open evidence.' : 'Verified evidence')}
                </p>
                <div class="pet-actions">
                  <For each={item().activity.actions}>
                    {(action) => (
                      <button
                        type="button"
                        onClick={() =>
                          action.evidenceUri
                            ? void window.heron.openEvidence(item().projectPath, action.evidenceUri)
                            : openProject(item().projectPath)
                        }
                      >
                        {action.label}
                      </button>
                    )}
                  </For>
                </div>
                <For each={evidence(item())}>
                  {(entry) => (
                    <button type="button" onClick={() => openEvidence(item().projectPath, entry)}>
                      {entry.label}
                    </button>
                  )}
                </For>
                <Show when={activityTray().length > 0}>
                  <p class="pet-activity-label">Siege activity</p>
                  <For each={activityTray()}>
                    {(other) => (
                      <button type="button" onClick={() => openProject(other.projectPath)}>
                        {other.profile.displayName} · {stateLabel(other)}
                      </button>
                    )}
                  </For>
                </Show>
              </section>
            </Show>
          </section>
        )}
      </Show>
    </main>
  )
}

interface SiegeProps {
  profiles: CompanionProjectView[]
  filter: SiegeFilter
  onFilter: (filter: SiegeFilter) => void
}

function Siege(props: SiegeProps) {
  const filters: { id: SiegeFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'attention', label: 'Needs attention' },
    { id: 'active', label: 'Active' },
    { id: 'hidden', label: 'Hidden' },
  ]
  return (
    <section class="siege-shell">
      <header class="siege-header">
        <div>
          <h1>Heron Siege</h1>
          <p>Project state is verified in OpenPi.</p>
        </div>
        <div class="siege-filters">
          <For each={filters}>
            {(item) => (
              <button
                type="button"
                classList={{ active: props.filter === item.id }}
                onClick={() => props.onFilter(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
      </header>
      <div class="siege-grid">
        <For
          each={props.profiles}
          fallback={<p class="siege-empty">No projects match this view.</p>}
        >
          {(item) => (
            <article class="siege-tile" style={{ '--heron-accent': item.sprite.palette.accent }}>
              <button
                type="button"
                class="siege-sprite"
                onClick={() => openProject(item.projectPath)}
              >
                <HeronSprite view={item} size={88} />
              </button>
              <button
                type="button"
                class="siege-project"
                onClick={() => openProject(item.projectPath)}
              >
                <strong>{item.profile.displayName}</strong>
                <span>{stateLabel(item)}</span>
              </button>
              <div class="siege-tile-footer">
                <small>{evidence(item).length} evidence</small>
                <button
                  type="button"
                  onClick={() =>
                    void window.heron.pin(item.projectPath, !item.profile.appearance.pinned)
                  }
                >
                  {item.profile.appearance.pinned ? 'Unpin' : 'Pin'}
                </button>
              </div>
            </article>
          )}
        </For>
      </div>
    </section>
  )
}
