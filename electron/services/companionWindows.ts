import path from 'node:path'
import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  Menu,
  screen,
} from 'electron'
import type { CompanionViews } from '../../src/lib/companionView'
import { IPC } from '../../src/lib/ipc'
import type { CompanionProjector } from './companionProjector'
import {
  boundsFromPlacement,
  clampCompanionBounds,
  loadCompanionBounds,
  placementFromBounds,
} from './companionBounds'
import {
  destroyCompanionWindow,
  companionBoundsPath,
  companionViewForPath,
  hideCompanionWindow,
  liveCompanionContents,
  loadCompanionWindow,
  showCompanionWindow,
} from './companionWindowUtils'

interface CompanionWindowsOptions {
  currentDir: string
  projector: CompanionProjector
  getMainWindow: () => BrowserWindow | null
  activateProject: (projectPath: string) => void
}

export class CompanionWindows {
  private activeProject: string | null = null
  private heronsVisible = true
  private follower: BrowserWindow | null = null
  private followerProject: string | null = null
  private siege: BrowserWindow | null = null
  private expanded: BrowserWindow | null = null
  private readonly pinned = new Map<string, BrowserWindow>()
  private readonly petOwners = new Map<number, string>()
  private readonly saved = loadCompanionBounds(companionBoundsPath())
  constructor(private readonly options: CompanionWindowsOptions) {
    options.projector.subscribe((views) => this.update(views))
  }
  setActive(projectPath: string | null): void {
    this.activeProject = projectPath
    this.update(this.options.projector.list())
  }
  showSiege(): void {
    this.siege ??= this.create('?companion=siege', 520, 460, false, 'siege')
    this.siege.show()
    this.siege.focus()
  }
  activateProject(projectPath: string, tab: 'now' | 'evidence' = 'now'): void {
    const view = this.options.projector.byPath(projectPath)
    if (!view) return
    this.options.projector.acknowledge(view.projectId)
    this.setActive(projectPath)
    this.options.activateProject(projectPath)
    const main = this.options.getMainWindow()
    main?.show()
    main?.focus()
    main?.webContents.send(IPC.COMPANION_OPEN, { projectPath, tab })
  }
  openEvidence(projectPath: string, evidenceUri: string): void {
    const view = this.options.projector.byPath(projectPath)
    if (!view?.evidence.some((evidence) => evidence.uri === evidenceUri && evidence.available))
      return
    this.activateProject(projectPath, 'evidence')
  }
  showPetMenu(event: IpcMainInvokeEvent, projectPath: string): void {
    if (!this.ownsPet(event, projectPath)) return
    const view = this.options.projector.byPath(projectPath)
    if (!view) return
    const owner = BrowserWindow.fromWebContents(event.sender)
    Menu.buildFromTemplate([
      { label: 'Open Project', click: () => this.activateProject(projectPath) },
      {
        label: 'Inspect Latest Evidence',
        enabled: view.state.kind !== 'idle',
        click: () => this.activateProject(projectPath, 'evidence'),
      },
      { type: 'separator' },
      {
        label: view.profile.appearance.pinned ? 'Unpin Heron' : 'Pin Heron',
        click: () => this.options.projector.setPinned(projectPath, !view.profile.appearance.pinned),
      },
      {
        label: 'Hide This Heron',
        click: () => hideCompanionWindow(owner),
      },
    ]).popup({ window: owner ?? undefined })
  }
  setPetPointerInteractive(
    event: IpcMainInvokeEvent,
    projectPath: string,
    interactive: boolean
  ): void {
    if (!this.ownsPet(event, projectPath)) return
    const owner = BrowserWindow.fromWebContents(event.sender)
    owner?.setIgnoreMouseEvents(!interactive, { forward: !interactive })
  }
  setPetExpanded(event: IpcMainInvokeEvent, projectPath: string, expanded: boolean): void {
    if (!this.ownsPet(event, projectPath)) return
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || owner.isDestroyed()) return
    if (expanded && this.expanded && this.expanded !== owner) this.resizePet(this.expanded, false)
    this.resizePet(owner, expanded)
    this.expanded = expanded ? owner : null
  }
  showAll(): void {
    this.heronsVisible = true
    const views = this.options.projector.list()
    this.activeProject ??= Object.values(views)[0]?.projectPath ?? null
    this.update(views)
    showCompanionWindow(this.follower)
    for (const win of this.pinned.values()) showCompanionWindow(win)
  }
  hideAll(): void {
    this.heronsVisible = false
    hideCompanionWindow(this.follower)
    for (const win of this.pinned.values()) hideCompanionWindow(win)
  }
  destroy(): void {
    destroyCompanionWindow(this.follower)
    destroyCompanionWindow(this.siege)
    for (const win of this.pinned.values()) destroyCompanionWindow(win)
    this.pinned.clear()
    this.petOwners.clear()
  }
  private update(views: CompanionViews): void {
    this.sendAll(views)
    this.removeDestroyedWindows()
    for (const [projectPath, win] of this.pinned) {
      const view = companionViewForPath(views, projectPath)
      if (!view?.profile.appearance.pinned || !view.profile.appearance.visible) {
        destroyCompanionWindow(win)
        this.pinned.delete(projectPath)
      }
    }
    for (const view of Object.values(views)) {
      const projectPath = view.projectPath
      if (
        view.profile.appearance.pinned &&
        view.profile.appearance.visible &&
        !this.pinned.has(projectPath)
      )
        this.pinned.set(
          projectPath,
          this.create(
            `?companion=pet&project=${encodeURIComponent(projectPath)}`,
            176,
            190,
            true,
            `pinned:${projectPath}`
          )
        )
      if (
        (!view.profile.appearance.pinned || !view.profile.appearance.visible) &&
        this.pinned.has(projectPath)
      ) {
        destroyCompanionWindow(this.pinned.get(projectPath) ?? null)
        this.pinned.delete(projectPath)
      }
    }
    if (!this.heronsVisible) {
      hideCompanionWindow(this.follower)
      for (const win of this.pinned.values()) hideCompanionWindow(win)
      return
    }
    if (!this.activeProject || this.pinned.has(this.activeProject)) {
      this.destroyFollower()
      for (const win of this.pinned.values()) showCompanionWindow(win)
      return
    }
    const active = companionViewForPath(views, this.activeProject)
    if (!active?.profile.appearance.visible) {
      this.destroyFollower()
      return
    }
    const query = `?companion=pet&project=${encodeURIComponent(this.activeProject)}`
    if (this.follower && this.followerProject !== this.activeProject) {
      destroyCompanionWindow(this.follower)
      this.follower = null
      this.followerProject = null
    }
    if (!this.follower) {
      this.follower = this.create(query, 176, 190, true, `active:${this.activeProject}`)
      this.followerProject = this.activeProject
    }
    this.follower.setAlwaysOnTop(active.profile.appearance.alwaysOnTop, 'floating')
    showCompanionWindow(this.follower)
    for (const win of this.pinned.values()) showCompanionWindow(win)
  }

  private create(
    query: string,
    width: number,
    height: number,
    transparent: boolean,
    key: string
  ): BrowserWindow {
    const projectPath = new URLSearchParams(query).get('project')
    const placement = projectPath
      ? this.options.projector.byPath(projectPath)?.profile.appearance.placement
      : null
    const saved = placement
      ? boundsFromPlacement(
          screen.getAllDisplays().find((display) => String(display.id) === placement.displayId) ??
            screen.getPrimaryDisplay(),
          placement,
          width,
          height
        )
      : clampCompanionBounds(this.saved[key], width, height)
    const bounds = saved
    const win = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: transparent ? '#00000000' : '#111522',
      webPreferences: {
        preload: path.resolve(this.options.currentDir, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    const contentsId = win.webContents.id
    win.setMovable(true)
    win.setAlwaysOnTop(true, 'floating')
    win.on('move', () => {
      if (win.isDestroyed()) return
      if (projectPath)
        this.options.projector.setPlacement(projectPath, placementFromBounds(win.getBounds()))
    })
    win.on('closed', () => {
      if (win === this.follower) {
        this.follower = null
        this.followerProject = null
      }
      if (win === this.siege) this.siege = null
      if (win === this.expanded) this.expanded = null
      for (const [projectPath, pinned] of this.pinned) {
        if (pinned === win) this.pinned.delete(projectPath)
      }
      this.petOwners.delete(contentsId)
    })
    loadCompanionWindow(win, this.options.currentDir, query)
    if (projectPath) this.petOwners.set(contentsId, projectPath)
    return win
  }

  private sendAll(views: CompanionViews): void {
    this.options.getMainWindow()?.webContents.send(IPC.COMPANION_CHANGED, views)
    for (const contents of this.contents()) contents.send(IPC.COMPANION_CHANGED, views)
  }
  private ownsPet(event: IpcMainInvokeEvent, projectPath: string): boolean {
    return this.petOwners.get(event.sender.id) === projectPath
  }
  private destroyFollower(): void {
    destroyCompanionWindow(this.follower)
    this.follower = null
    this.followerProject = null
  }
  private resizePet(win: BrowserWindow, expanded: boolean): void {
    if (win.isDestroyed()) return
    const bounds = win.getBounds()
    const width = expanded ? 360 : 176
    const height = expanded ? 390 : 190
    const work = screen.getDisplayNearestPoint(bounds).workArea
    win.setBounds({
      x: Math.max(work.x, Math.min(bounds.x, work.x + work.width - width)),
      y: Math.max(work.y, Math.min(bounds.y, work.y + work.height - height)),
      width,
      height,
    })
  }
  private removeDestroyedWindows(): void {
    if (this.follower?.isDestroyed()) {
      this.follower = null
      this.followerProject = null
    }
    if (this.siege?.isDestroyed()) this.siege = null
    for (const [projectPath, win] of this.pinned) {
      if (win.isDestroyed()) this.pinned.delete(projectPath)
    }
  }
  private contents() {
    return liveCompanionContents([this.follower, this.siege, ...this.pinned.values()])
  }
}
