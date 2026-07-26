// biome-ignore-all lint/a11y/useAriaPropsSupportedByRole: existing decorative theme swatches are tracked separately from this release.
import { AlertTriangle, Check, RotateCcw } from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'
import forestArt from '../../assets/themes/forest.svg'
import flightHeron from '../../assets/themes/heron.svg'
import { APPEARANCE_PREF_KEYS, saveAppearancePreference } from '../../lib/appearancePreferences'
import { isFirstPartyThemeId } from '../../lib/appThemes'
import type { CustomizationItem, CustomizationScope, ThemeColors } from '../../lib/ipc'
import {
  activeThemeId,
  applyThemeTokens,
  isThemeApplied,
  previousThemeColorScheme,
  resetTheme,
} from '../../lib/themeApply'

function shortenPath(p: string | null): string {
  if (!p) return ''
  return p.replace(/^\/Users\/[^/]+\//, '~/')
}

const DISPLAY_SCOPE: Record<CustomizationScope, string> = {
  user: 'Global',
  project: 'Project',
  temporary: 'Temp',
}

const SWATCH_KEYS: Array<keyof ThemeColors> = [
  'accent',
  'userMessageBg',
  'toolSuccessBg',
  'toolErrorBg',
  'syntaxKeyword',
  'syntaxString',
  'mdHeading',
]

function ColorSwatch(props: { color: string | null | undefined; label: string }) {
  if (!props.color) return null
  return (
    <span
      class="thm-swatch"
      style={{ background: props.color }}
      title={`${props.label}: ${props.color}`}
      aria-label={`${props.label} color: ${props.color}`}
    />
  )
}

function ThemePreview(props: { themeId: string }) {
  if (!isFirstPartyThemeId(props.themeId)) return null
  const isFlight = props.themeId === 'heron-flight'
  return (
    <div class={`thm-preview thm-preview-${props.themeId}`} aria-hidden="true">
      <img src={isFlight ? flightHeron : forestArt} alt="" />
      <span>{isFlight ? 'Celestial glass · indigo + cyan' : 'Forest glass · moss + gold'}</span>
    </div>
  )
}

function ThemeCard(props: {
  item: CustomizationItem
  isActive: boolean
  onApply: (item: CustomizationItem) => Promise<void>
}) {
  const [colors, setColors] = createSignal<ThemeColors | null>(null)
  const [applying, setApplying] = createSignal(false)
  const [applied, setApplied] = createSignal(false)

  createEffect(() => {
    const path = props.item.path
    if (!path) {
      setColors(null)
      return
    }
    void window.openpi.readThemeColors(path).then((value) => {
      setColors(value)
    })
  })

  const resolvedSwatches = createMemo(() => {
    if (!colors()) return []
    return SWATCH_KEYS.map((key) => ({ key, color: colors()?.[key] ?? null })).filter(
      (entry) => entry.color
    )
  })

  const handleApply = async () => {
    if (props.isActive || applying()) return
    setApplying(true)
    try {
      await props.onApply(props.item)
      setApplied(true)
      setTimeout(() => setApplied(false), 2000)
    } finally {
      setApplying(false)
    }
  }

  return (
    <article
      class={`thm-card${props.isActive ? ' is-active' : ''}${props.item.builtIn ? ' is-openpi' : ''}`}
    >
      <div class="thm-card-header">
        <div class="thm-card-title-row">
          <span class="thm-card-name">{props.item.name}</span>
          <Show when={props.isActive}>
            <span class="thm-active-chip">
              <Check size={10} /> Active
            </span>
          </Show>
          <span class="thm-scope-chip">{DISPLAY_SCOPE[props.item.scope]}</span>
          <Show when={!props.item.enabled}>
            <span class="thm-disabled-chip">disabled</span>
          </Show>
        </div>

        <button
          type="button"
          class={`thm-apply-btn${props.isActive ? ' is-active' : ''}${applied() ? ' is-applied' : ''}`}
          onClick={() => {
            void handleApply()
          }}
          disabled={props.isActive || applying()}
          aria-label={props.isActive ? 'This theme is active' : `Apply ${props.item.name} theme`}
          title={props.isActive ? 'Currently active' : 'Apply theme globally'}
        >
          <Show when={!applying()} fallback={'…'}>
            <Show
              when={!applied()}
              fallback={
                <>
                  <Check size={12} /> Applied
                </>
              }
            >
              <Show when={props.isActive} fallback={'Apply'}>
                <Check size={12} /> Active
              </Show>
            </Show>
          </Show>
        </button>
      </div>

      <ThemePreview themeId={props.item.name} />

      <div class="thm-swatches-row">
        <Show
          when={resolvedSwatches().length > 0}
          fallback={<span class="thm-swatches-empty">No extractable colors</span>}
        >
          <For each={resolvedSwatches()}>
            {(entry) => <ColorSwatch color={entry.color} label={String(entry.key)} />}
          </For>
        </Show>
      </div>

      <div class="thm-card-footer">
        <Show when={props.item.path}>
          <span class="thm-card-path">{shortenPath(props.item.path)}</span>
        </Show>
        <Show when={props.item.warning}>
          <div class="thm-card-warning">
            <AlertTriangle size={11} />
            <span>{props.item.warning}</span>
          </div>
        </Show>
      </div>
    </article>
  )
}

type ThemesPaneProps = {
  items: CustomizationItem[]
  loading: boolean
}

export function ThemesPane(props: ThemesPaneProps) {
  const [activeTheme, setActiveTheme] = createSignal<string | null>(activeThemeId())
  const [hasCustomTheme, setHasCustomTheme] = createSignal(isThemeApplied())

  onMount(() => {
    void window.openpi.getSettings().then((result) => {
      const theme = (result.effective as Record<string, unknown>)?.theme
      if (typeof theme === 'string') setActiveTheme(theme)
    })
  })

  const applyTheme = async (item: CustomizationItem) => {
    const currentTheme = activeThemeId()
    const savedScheme = await window.openpi.getPref(APPEARANCE_PREF_KEYS.colorScheme)
    const previousScheme = isFirstPartyThemeId(currentTheme)
      ? previousThemeColorScheme()
      : savedScheme === 'system' || savedScheme === 'light' || savedScheme === 'dark'
        ? savedScheme
        : undefined
    if (!item.builtIn && isFirstPartyThemeId(currentTheme)) {
      const restore = previousThemeColorScheme() ?? 'system'
      await saveAppearancePreference('colorScheme', restore)
    }
    const current = await window.openpi.getSettings()
    const globalSettings = { ...((current.global as Record<string, unknown>) ?? {}) }
    globalSettings.theme = item.name
    await window.openpi.saveSettings('global', globalSettings)
    setActiveTheme(item.name)

    if (item.path) {
      const tokens = await window.openpi.readThemeTokens(item.path)
      if (tokens) {
        if (item.builtIn) {
          await saveAppearancePreference('colorScheme', 'dark')
        }
        applyThemeTokens(tokens, item.name, item.builtIn ? previousScheme : undefined)
        setHasCustomTheme(true)
      }
    }
  }

  const handleReset = async () => {
    const current = await window.openpi.getSettings()
    const globalSettings = { ...((current.global as Record<string, unknown>) ?? {}) }
    delete globalSettings.theme
    await window.openpi.saveSettings('global', globalSettings)
    const restore = previousThemeColorScheme()
    if (restore) {
      await saveAppearancePreference('colorScheme', restore)
    }
    resetTheme()
    setActiveTheme(null)
    setHasCustomTheme(false)
  }

  const hasBuiltIn = createMemo(() => props.items.some((item) => item.scope === 'temporary'))
  const openPiThemes = createMemo(() => props.items.filter((item) => item.builtIn))
  const communityThemes = createMemo(() => props.items.filter((item) => !item.builtIn))

  return (
    <div class="thm-pane">
      <div class="thm-toolbar">
        <div class="thm-toolbar-copy">
          <span class="thm-toolbar-eyebrow">Appearance</span>
          <p>
            Applying a theme updates Pi settings and recolors the OpenPi interface when theme tokens
            are available.
          </p>
        </div>
        <Show when={hasCustomTheme()}>
          <button
            type="button"
            class="thm-reset-btn"
            onClick={() => void handleReset()}
            title="Reset OpenPi UI to default colors"
          >
            <RotateCcw size={12} />
            Reset UI colors
          </button>
        </Show>
      </div>

      <div class="thm-list">
        <Show
          when={!props.loading}
          fallback={<div class="thm-empty">Scanning Pi theme directories…</div>}
        >
          <Show
            when={props.items.length > 0}
            fallback={
              <div class="thm-empty">
                <p>No custom themes discovered.</p>
                <p class="thm-empty-hint">
                  Pi includes <code>dark</code> and <code>light</code> built-in. Use the shell-level
                  AI generator or drop a JSON file in <code>~/.pi/agent/themes/</code>.
                </p>
              </div>
            }
          >
            <Show when={openPiThemes().length > 0}>
              <section class="thm-group">
                <span class="thm-group-label">OpenPi themes</span>
                <p class="thm-group-copy">Atmospheric, dark workspaces built into OpenPi.</p>
                <For each={openPiThemes()}>
                  {(item) => (
                    <ThemeCard
                      item={item}
                      isActive={activeTheme() === item.name}
                      onApply={applyTheme}
                    />
                  )}
                </For>
              </section>
            </Show>
            <Show when={hasBuiltIn() && communityThemes().length > 0}>
              <p class="thm-builtin-note">
                Built-in themes (<code>dark</code>, <code>light</code>) are always available and do
                not appear here.
              </p>
            </Show>
            <For each={communityThemes()}>
              {(item) => (
                <ThemeCard
                  item={item}
                  isActive={activeTheme() === item.name}
                  onApply={applyTheme}
                />
              )}
            </For>
          </Show>
        </Show>
      </div>

      <Show when={props.items.length > 0}>
        <div class="thm-footer">
          Select the active theme via <code>/settings</code> or{' '}
          <code>~/.pi/agent/settings.json</code> → <code>"theme": "name"</code>. Use{' '}
          <strong>Reset UI colors</strong> to restore OpenPi defaults.
        </div>
      </Show>
    </div>
  )
}
