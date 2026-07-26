import fs from 'node:fs'
import path from 'node:path'

export const FIRST_PARTY_THEME_IDS = ['heron-flight', 'natural-focus'] as const
export type FirstPartyThemeId = (typeof FIRST_PARTY_THEME_IDS)[number]

export function isFirstPartyThemeId(value: string): value is FirstPartyThemeId {
  return (FIRST_PARTY_THEME_IDS as readonly string[]).includes(value)
}

function themesDirectory(): string {
  const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'themes') : ''
  if (packaged && fs.existsSync(packaged)) return packaged
  return path.resolve(process.cwd(), 'themes')
}

export function bundledThemePaths(): string[] {
  const directory = themesDirectory()
  return FIRST_PARTY_THEME_IDS.map((id) => path.join(directory, `${id}.json`)).filter((file) =>
    fs.existsSync(file)
  )
}
