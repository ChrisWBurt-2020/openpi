/**
 * themeApply.ts
 *
 * Maps Pi theme JSON tokens → OpenPi CSS custom properties on <html>.
 * Persists the applied var map to localStorage so the theme survives restarts.
 *
 * Pi themes expose two layers:
 *   vars:   raw palette (hex),  e.g. { crust: '#11111b', base: '#1e1e2e', gray: '#363b54', ... }
 *   colors: semantic mappings (already resolved to hex by the IPC handler),
 *           e.g. { accent: '#cba6f7', success: '#a6e3a1', muted: '#6c7086', ... }
 *
 * Because different themes use different var naming conventions, we try a
 * priority-ordered list of candidate names for each OpenPi CSS var.
 */

import { z } from 'zod'
import { isFirstPartyThemeId } from './appThemes'
import type { ThemeTokens } from './ipc'

const STORAGE_KEY = 'openpi-active-theme-vars'
export const THEME_CHANGED_EVENT = 'openpi:theme-changed'

export interface AppliedThemeState {
  version: 2
  themeId: string
  cssVariables: Record<string, string>
  previousColorScheme?: 'system' | 'light' | 'dark'
}

const appliedThemeStateSchema = z.object({
  version: z.literal(2),
  themeId: z.string(),
  cssVariables: z.record(z.string()),
  previousColorScheme: z.enum(['system', 'light', 'dark']).optional(),
})

function readStoredThemeState(): AppliedThemeState | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    const current = appliedThemeStateSchema.safeParse(parsed)
    if (current.success) return current.data

    // Version 1 was the bare CSS-variable map. Preserve it during migration.
    const legacy = z.record(z.string()).safeParse(parsed)
    return legacy.success ? { version: 2, themeId: 'custom', cssVariables: legacy.data } : null
  } catch {
    return null
  }
}

// All CSS custom properties we may set — used for full reset
const OPENPI_OWN_VARS = [
  '--canvas',
  '--canvas-warm',
  '--scrim',
  '--footer',
  '--surface-soft',
  '--surface-card',
  '--surface-raised',
  '--surface-inset',
  '--hairline',
  '--hairline-soft',
  '--hairline-strong',
  '--ink',
  '--ink-soft',
  '--graphite',
  '--mute',
  '--stone',
  '--ash',
  '--accent',
  '--success',
  '--warning',
  '--danger',
  '--error',
  // Shiki css-variables theme tokens (cleared on theme reset so :root defaults take over)
  '--shiki-color-background',
  '--shiki-color-text',
  '--shiki-token-keyword',
  '--shiki-token-string',
  '--shiki-token-string-expression',
  '--shiki-token-comment',
  '--shiki-token-function',
  '--shiki-token-constant',
  '--shiki-token-parameter',
  '--shiki-token-link',
  '--shiki-token-punctuation',
  '--theme-panel-alpha',
  '--theme-blur',
  '--theme-edge',
  '--theme-glow',
  '--theme-vignette',
  '--theme-grain',
  '--theme-motion',
] as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Return first non-empty value found in `vars` for any of the given keys. */
function tryVars(vars: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (vars[k]) return vars[k]
  }
  return undefined
}

/** Set a CSS custom property on <html> only when value is defined. */
function set(cssVar: string, val: string | undefined | null): void {
  if (val) document.documentElement.style.setProperty(cssVar, val)
}

// ─── Core mapping ─────────────────────────────────────────────────────────────

/**
 * Map Pi theme tokens to OpenPi CSS vars and apply them to <html>.
 *
 * Priority order per var is derived by studying the two shipped Pi themes:
 *   Catppuccin Mocha: crust/mantle/base/surface0/surface1/surface2/overlay0/overlay1/text/subtext0/subtext1
 *   Tokyo Night:     bgDark/bg/gray/dimGray/fg/lightBlue/comment
 */
export function applyThemeTokens(
  tokens: ThemeTokens,
  themeId = 'custom',
  previousColorScheme?: 'system' | 'light' | 'dark'
): void {
  const v = tokens.vars // palette, hex
  const c = tokens.colors // semantic, hex

  // ── Background layers ─────────────────────────────────────────────────────
  // darkest                            Catppuccin  TN
  set('--canvas', tryVars(v, 'crust', 'bgDark', 'mantle'))
  set('--canvas-warm', tryVars(v, 'mantle', 'bgDark', 'crust'))
  // --scrim: main panel + composer bg. Use darkest layer same as canvas.
  set('--scrim', tryVars(v, 'crust', 'bgDark', 'mantle'))
  // --footer: very bottom bar. Use darkest layer.
  set('--footer', tryVars(v, 'crust', 'bgDark', 'mantle'))
  set('--surface-soft', tryVars(v, 'base', 'bg'))
  set('--surface-card', tryVars(v, 'surface0', 'gray', 'selectedBg'))
  set('--surface-raised', tryVars(v, 'surface1'))
  set('--surface-inset', tryVars(v, 'mantle', 'bgDark', 'crust'))

  // ── Borders ──────────────────────────────────────────────────────────────
  // borderMuted is the subtle separator in Pi; colors.border is usually accent-bright, avoid for hairlines
  set('--hairline', c.borderMuted ?? tryVars(v, 'surface0', 'gray'))
  set('--hairline-soft', tryVars(v, 'mantle', 'bgDark'))
  set('--hairline-strong', tryVars(v, 'surface2', 'overlay0', 'dimGray', 'gray'))

  // ── Text ──────────────────────────────────────────────────────────────────
  // colors['text'] may be empty string for some themes → fallback to vars
  set('--ink', c.text || tryVars(v, 'text', 'fg'))
  set('--ink-soft', tryVars(v, 'subtext1', 'lightBlue', 'fg'))
  set('--graphite', tryVars(v, 'subtext0', 'dimGray', 'fg'))
  set('--mute', c.muted || tryVars(v, 'overlay1', 'comment', 'dimGray'))
  set('--stone', tryVars(v, 'overlay0', 'comment', 'dimGray'))
  set('--ash', tryVars(v, 'surface2', 'overlay0', 'dimGray', 'gray'))

  // ── Semantic / accent ─────────────────────────────────────────────────────
  if (c.accent) set('--accent', c.accent)
  if (c.success) set('--success', c.success)
  if (c.warning) set('--warning', c.warning)
  if (c.error) {
    set('--danger', c.error)
    set('--error', c.error)
  }

  // ── Shiki token colours ──────────────────────────────────────────────────
  // Re-read computed values AFTER all palette vars have been written above,
  // then mirror them into the --shiki-* tokens used by the css-variables theme.
  // This keeps syntax highlighting in sync with whatever palette is active.
  const cs = getComputedStyle(document.documentElement)
  const _surface = cs.getPropertyValue('--surface-soft').trim()
  const _ink = cs.getPropertyValue('--ink').trim()
  const _stone = cs.getPropertyValue('--stone').trim()
  const _mute = cs.getPropertyValue('--mute').trim()
  const _graphite = cs.getPropertyValue('--graphite').trim()
  const _accent = cs.getPropertyValue('--accent').trim()
  if (_surface) set('--shiki-color-background', _surface)
  if (_ink) set('--shiki-color-text', _ink)
  if (_stone) set('--shiki-token-comment', _stone)
  if (_mute) set('--shiki-token-punctuation', _mute)
  if (_graphite) set('--shiki-token-parameter', _graphite)
  if (_accent) set('--shiki-token-keyword', _accent)

  // Persist for restore on next launch
  const root = document.documentElement
  if (isFirstPartyThemeId(themeId)) {
    root.dataset.openpiTheme = themeId
    root.dataset.theme = 'dark'
  } else {
    delete root.dataset.openpiTheme
  }
  persistAppliedVars(themeId, previousColorScheme)
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT))
}

/** Remove all OpenPi CSS vars we may have set → reverts to index.css defaults. */
export function resetTheme(): void {
  const root = document.documentElement
  for (const v of OPENPI_OWN_VARS) root.style.removeProperty(v)
  delete root.dataset.openpiTheme
  root.dataset.theme = root.dataset.colorScheme ?? 'dark'
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT))
}

/** Save current inline style vars to localStorage. */
function persistAppliedVars(
  themeId: string,
  previousColorScheme?: 'system' | 'light' | 'dark'
): void {
  const root = document.documentElement
  const snapshot: Record<string, string> = {}
  for (const v of OPENPI_OWN_VARS) {
    const val = root.style.getPropertyValue(v).trim()
    if (val) snapshot[v] = val
  }
  const state: AppliedThemeState = {
    version: 2,
    themeId,
    cssVariables: snapshot,
    previousColorScheme,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

/** Restore theme vars from localStorage on app start (call once in App.tsx). */
export function restoreThemeFromStorage(): void {
  const state = readStoredThemeState()
  if (!state) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  const root = document.documentElement
  for (const [key, value] of Object.entries(state.cssVariables)) {
    if (value && OPENPI_OWN_VARS.includes(key as (typeof OPENPI_OWN_VARS)[number])) {
      root.style.setProperty(key, value)
    }
  }
  if (isFirstPartyThemeId(state.themeId)) {
    root.dataset.openpiTheme = state.themeId
    root.dataset.theme = 'dark'
  }
}

/** True if any theme vars are currently applied (i.e. theme is active). */
export function isThemeApplied(): boolean {
  return Boolean(localStorage.getItem(STORAGE_KEY))
}

export function activeThemeId(): string | null {
  return readStoredThemeState()?.themeId ?? null
}

export function previousThemeColorScheme(): AppliedThemeState['previousColorScheme'] {
  return readStoredThemeState()?.previousColorScheme
}
