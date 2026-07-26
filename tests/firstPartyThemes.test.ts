import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { bundledThemePaths, FIRST_PARTY_THEME_IDS } from '../electron/services/bundledThemes'
import { isFirstPartyThemeId, THEME_VISUAL_PROFILES } from '../src/lib/appThemes'

const REQUIRED_COLORS = [
  'accent',
  'border',
  'borderAccent',
  'borderMuted',
  'success',
  'error',
  'warning',
  'muted',
  'dim',
  'text',
  'thinkingText',
  'selectedBg',
  'userMessageBg',
  'userMessageText',
  'customMessageBg',
  'customMessageText',
  'customMessageLabel',
  'toolPendingBg',
  'toolSuccessBg',
  'toolErrorBg',
  'toolTitle',
  'toolOutput',
  'mdHeading',
  'mdLink',
  'mdLinkUrl',
  'mdCode',
  'mdCodeBlock',
  'mdCodeBlockBorder',
  'mdQuote',
  'mdQuoteBorder',
  'mdHr',
  'mdListBullet',
  'toolDiffAdded',
  'toolDiffRemoved',
  'toolDiffContext',
  'syntaxComment',
  'syntaxKeyword',
  'syntaxFunction',
  'syntaxVariable',
  'syntaxString',
  'syntaxNumber',
  'syntaxType',
  'syntaxOperator',
  'syntaxPunctuation',
  'thinkingOff',
  'thinkingMinimal',
  'thinkingLow',
  'thinkingMedium',
  'thinkingHigh',
  'thinkingXhigh',
  'bashMode',
]

describe('first-party themes', () => {
  it('ships discoverable Pi theme definitions with every required color token', () => {
    const paths = bundledThemePaths()
    expect(paths).toHaveLength(FIRST_PARTY_THEME_IDS.length)
    for (const file of paths) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        name: string
        colors: Record<string, string>
      }
      expect(isFirstPartyThemeId(parsed.name)).toBe(true)
      for (const color of REQUIRED_COLORS) expect(parsed.colors[color]).toBeTruthy()
    }
  })

  it('keeps a visual profile for each packaged theme', () => {
    for (const id of FIRST_PARTY_THEME_IDS) {
      expect(THEME_VISUAL_PROFILES[id].colorScheme).toBe('dark')
      expect(
        path.basename(bundledThemePaths().find((file) => file.endsWith(`${id}.json`)) ?? '')
      ).toBe(`${id}.json`)
    }
  })

  it('loads both definitions through Pi resource discovery', async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-theme-agent-'))
    try {
      const loader = new DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir,
        settingsManager: SettingsManager.create(process.cwd(), agentDir),
        noExtensions: true,
        additionalThemePaths: bundledThemePaths(),
      })
      await loader.reload()
      const names = loader.getThemes().themes.map((theme) => theme.name)
      expect(names).toContain('heron-flight')
      expect(names).toContain('natural-focus')
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true })
    }
  })
})
