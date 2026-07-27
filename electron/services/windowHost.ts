import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MenuItemConstructorOptions } from 'electron'
import { BrowserWindow, Menu, shell } from 'electron'
import { IPC } from '../../src/lib/ipc'
import { resolveBootTarget } from '../session/bootTarget'
import type { SessionIndexStore } from '../session/sessionIndex'
import { classifyNavigation } from './navigationPolicy'
import type { PtyHost } from './ptyHost'
import { appIconPath } from './shellEnv'
import { attachWindowStateSaver, loadWindowState } from './windowState'

type PtyHostInstance = InstanceType<typeof PtyHost>

interface CreateWindowOptions {
  currentDir: string
  getPtyHost: () => Promise<PtyHostInstance>
  getSessionIndex: () => SessionIndexStore | null
  showDeferredWorkspace: (workspacePath: string) => void
  /** Reopen a specific session on boot. See resolveBootTarget(). */
  resumeSession: (cwd: string, sessionFile: string) => Promise<void>
  refreshSessionIndex: () => Promise<void>
  onClosed: () => void
}

/**
 * Keep links from replacing the app.
 *
 * A plain <a href> click navigates the window away from the UI, and there is
 * no back button or Back menu item to return — the app has to be killed. This
 * routes anything that isn't the app itself to the user's real browser.
 */
function applyNavigationPolicy(window: BrowserWindow, appUrl: string | null): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (classifyNavigation(url, appUrl) === 'external') void shell.openExternal(url)
    // Never let the renderer spawn its own chrome-less windows.
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const decision = classifyNavigation(url, appUrl)
    if (decision === 'allow') return
    // Anything else must not replace the app window.
    event.preventDefault()
    if (decision === 'external') void shell.openExternal(url)
  })
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' as const },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'pasteAndMatchStyle' as const },
        { role: 'delete' as const },
        { role: 'selectAll' as const },
      ],
    },
    { role: 'viewMenu' as const },
    { role: 'windowMenu' as const },
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  buildAppMenu()

  const saved = loadWindowState()
  const mainWindow = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenPi',
    icon: appIconPath(),
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.resolve(options.currentDir, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (saved.isMaximized) mainWindow.maximize()
  if (saved.isFullScreen) mainWindow.setFullScreen(true)
  attachWindowStateSaver(mainWindow)

  // Preload failures otherwise appear only in DevTools, leaving the renderer
  // looking healthy while its entire privileged API is missing.
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[preload] ${preloadPath}: ${error.message}`, error)
  })

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key.toLowerCase() === 'f' && (input.meta || input.control)) {
      mainWindow.webContents.send(IPC.FILE_FIND_SHORTCUT)
    }
  })

  let appUrl: string | null = null
  if (process.env.ELECTRON_RENDERER_URL) {
    appUrl = process.env.ELECTRON_RENDERER_URL
    mainWindow.loadURL(appUrl)
  } else {
    const indexPath = path.resolve(options.currentDir, '../renderer/index.html')
    appUrl = pathToFileURL(indexPath).toString()
    mainWindow.loadFile(indexPath)
  }
  applyNavigationPolicy(mainWindow, appUrl)

  mainWindow.webContents.once('did-finish-load', () => {
    void options.getPtyHost().then((pty) => pty.setSender(mainWindow.webContents))

    mainWindow.webContents.send(IPC.SESSION_INDEX_UPDATED)

    const index = options.getSessionIndex()
    const lastWorkspace = index?.getLastWorkspace() ?? null
    const target = resolveBootTarget({
      lastWorkspace,
      lastSessionFile: lastWorkspace
        ? (index?.getLastSessionForWorkspace(lastWorkspace) ?? null)
        : null,
      sessionFileExists: (p) => fs.existsSync(p),
    })

    if (target.kind === 'session') {
      // Reopen the conversation the user was actually in. Falling back to the
      // workspace keeps a stale index row from wedging startup entirely.
      void options.resumeSession(target.cwd, target.sessionFile).catch(() => {
        options.showDeferredWorkspace(target.cwd)
      })
    } else if (target.kind === 'workspace') {
      options.showDeferredWorkspace(target.cwd)
    } else {
      void options.refreshSessionIndex()
    }
  })

  mainWindow.on('closed', options.onClosed)
  return mainWindow
}
