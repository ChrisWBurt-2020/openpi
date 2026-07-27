import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, type BrowserWindow, type WebContents } from 'electron'
import type { CompanionViews } from '../../src/lib/companionView'
import type { CompanionProjector } from './companionProjector'

export function showCompanionWindow(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) win.showInactive()
}

export function hideCompanionWindow(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) win.hide()
}

export function destroyCompanionWindow(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) win.destroy()
}

export function liveCompanionContents(windows: Array<BrowserWindow | null>): WebContents[] {
  return windows.flatMap((win) => (win && !win.isDestroyed() ? [win.webContents] : []))
}

export function companionBoundsPath(): string {
  return path.join(app.getPath('userData'), 'companion-windows.json')
}

export function loadCompanionWindow(win: BrowserWindow, currentDir: string, query: string): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(`${devUrl}${query}`)
  else
    void win.loadURL(
      `${pathToFileURL(path.resolve(currentDir, '../renderer/index.html')).toString()}${query}`
    )
}

export function companionViewForPath(
  views: CompanionViews,
  projectPath: string
): ReturnType<CompanionProjector['byPath']> {
  return Object.values(views).find((view) => view.projectPath === projectPath) ?? null
}
