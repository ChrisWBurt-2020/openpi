import { afterEach, describe, expect, it } from 'vitest'
import {
  activeThemeId,
  applyThemeTokens,
  previousThemeColorScheme,
  resetTheme,
  restoreThemeFromStorage,
} from '../src/lib/themeApply'

const tokens = {
  vars: {
    crust: '#070B16',
    mantle: '#0E1730',
    base: '#111C38',
    surface0: '#1A2850',
    surface1: '#233560',
    surface2: '#344A78',
    text: '#DDE6FF',
    subtext0: '#AAB8DA',
    subtext1: '#C7D2F0',
    overlay0: '#62729A',
    overlay1: '#8192BB',
  },
  colors: {
    accent: '#6E62FF',
    success: '#44D18C',
    warning: '#FFB347',
    error: '#F47592',
    text: '#DDE6FF',
    muted: '#8192BB',
    borderMuted: '#344A78',
  },
}

afterEach(() => {
  resetTheme()
  localStorage.clear()
  delete document.documentElement.dataset.openpiTheme
})

describe('theme application', () => {
  it('persists and restores a first-party dark profile', () => {
    applyThemeTokens(tokens, 'heron-flight', 'light')

    expect(document.documentElement.dataset.openpiTheme).toBe('heron-flight')
    expect(activeThemeId()).toBe('heron-flight')
    expect(previousThemeColorScheme()).toBe('light')

    document.documentElement.style.removeProperty('--canvas')
    delete document.documentElement.dataset.openpiTheme
    restoreThemeFromStorage()

    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('#070B16')
    expect(document.documentElement.dataset.openpiTheme).toBe('heron-flight')
  })

  it('migrates the former bare CSS variable map', () => {
    localStorage.setItem('openpi-active-theme-vars', JSON.stringify({ '--canvas': '#101010' }))

    restoreThemeFromStorage()

    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe('#101010')
    expect(activeThemeId()).toBe('custom')
  })

  it('drops malformed saved state safely', () => {
    localStorage.setItem('openpi-active-theme-vars', JSON.stringify({ version: 2, themeId: 2 }))

    restoreThemeFromStorage()

    expect(localStorage.getItem('openpi-active-theme-vars')).toBeNull()
  })
})
