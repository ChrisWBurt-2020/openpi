export const FIRST_PARTY_THEME_IDS = ['heron-flight', 'natural-focus'] as const
export type FirstPartyThemeId = (typeof FIRST_PARTY_THEME_IDS)[number]

export interface ThemeVisualProfile {
  id: FirstPartyThemeId
  displayName: string
  colorScheme: 'dark'
  motif: 'celestial-heron' | 'forest-heron'
  motion: 'precise' | 'ambient'
}

export const THEME_VISUAL_PROFILES: Record<FirstPartyThemeId, ThemeVisualProfile> = {
  'heron-flight': {
    id: 'heron-flight',
    displayName: 'Heron Flight',
    colorScheme: 'dark',
    motif: 'celestial-heron',
    motion: 'precise',
  },
  'natural-focus': {
    id: 'natural-focus',
    displayName: 'Natural Focus',
    colorScheme: 'dark',
    motif: 'forest-heron',
    motion: 'ambient',
  },
}

export function isFirstPartyThemeId(value: string | null | undefined): value is FirstPartyThemeId {
  return Boolean(value && FIRST_PARTY_THEME_IDS.includes(value as FirstPartyThemeId))
}
