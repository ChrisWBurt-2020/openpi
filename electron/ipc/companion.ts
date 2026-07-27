import { dialog, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { IPC } from '../../src/lib/ipc'
import { projectHarnessProfileUpdateSchema } from '../../src/lib/companion'
import type { CompanionProjector } from '../services/companionProjector'
import type { PetPackStore } from '../services/petPacks'

const pinSchema = z.object({ projectPath: z.string().min(1), pinned: z.boolean() })

interface CompanionIpcDeps {
  ipcMain: IpcMain
  getProjector: () => CompanionProjector | null
  showSiege: () => void
  activateProject: (projectPath: string) => void
  showPetMenu: (event: IpcMainInvokeEvent, projectPath: string) => void
  setPetPointerInteractive: (
    event: IpcMainInvokeEvent,
    projectPath: string,
    interactive: boolean
  ) => void
  openEvidence: (projectPath: string, evidenceUri: string) => void
  getPetPacks: () => PetPackStore | null
  setPetExpanded: (event: IpcMainInvokeEvent, projectPath: string, expanded: boolean) => void
}

export function registerCompanionIpc(deps: CompanionIpcDeps): void {
  deps.ipcMain.handle(IPC.COMPANION_LIST, () => deps.getProjector()?.list() ?? {})
  deps.ipcMain.handle(IPC.COMPANION_PIN, (_event, raw: unknown) => {
    const request = pinSchema.parse(raw)
    deps.getProjector()?.setPinned(request.projectPath, request.pinned)
  })
  deps.ipcMain.handle(IPC.COMPANION_SHOW_SIEGE, () => deps.showSiege())
  deps.ipcMain.handle(IPC.COMPANION_PET_ACTIVATE, (_event, raw: unknown) => {
    const request = pinSchema.pick({ projectPath: true }).parse(raw)
    deps.activateProject(request.projectPath)
  })
  deps.ipcMain.handle(IPC.COMPANION_PET_MENU, (event, raw: unknown) => {
    const request = pinSchema.pick({ projectPath: true }).parse(raw)
    deps.showPetMenu(event, request.projectPath)
  })
  deps.ipcMain.handle(IPC.COMPANION_PET_POINTER, (event, raw: unknown) => {
    const request = z
      .object({ projectPath: z.string().min(1), interactive: z.boolean() })
      .parse(raw)
    deps.setPetPointerInteractive(event, request.projectPath, request.interactive)
  })
  deps.ipcMain.handle(IPC.COMPANION_EVIDENCE_OPEN, (_event, raw: unknown) => {
    const request = z.object({ projectPath: z.string().min(1), evidenceUri: z.string().regex(/^evidence:\/\//) }).parse(raw)
    deps.openEvidence(request.projectPath, request.evidenceUri)
  })
  deps.ipcMain.handle(IPC.COMPANION_PACK_LIST, () => deps.getPetPacks()?.list() ?? [])
  deps.ipcMain.handle(IPC.COMPANION_PACK_GET, (_event, raw: unknown) =>
    deps.getPetPacks()?.runtime(z.string().regex(/^[a-z0-9-]+$/).parse(raw)) ?? null
  )
  deps.ipcMain.handle(IPC.COMPANION_PACK_IMPORT, async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (picked.canceled || !picked.filePaths[0]) return null
    return deps.getPetPacks()?.importFolder(picked.filePaths[0]) ?? null
  })
  deps.ipcMain.handle(IPC.COMPANION_PACK_REMOVE, (_event, raw: unknown) => {
    const id = z.string().regex(/^[a-z0-9-]+$/).parse(raw)
    const inUse = Object.values(deps.getProjector()?.list() ?? {}).some((view) => view.profile.appearance.petPackId === id)
    if (inUse) throw new Error('Select a different pet pack before removing this one.')
    deps.getPetPacks()?.remove(id)
  })
  deps.ipcMain.handle(IPC.COMPANION_PROFILE_UPDATE, (_event, raw: unknown) => {
    const request = projectHarnessProfileUpdateSchema.parse(raw)
    const profile = deps.getProjector()?.updateProfile(request.projectId, request.expectedRevision, request.patch)
    if (!profile) throw new Error('Profile changed in another window. Refresh and try again.')
    return profile
  })
  deps.ipcMain.handle(IPC.COMPANION_PET_EXPANDED, (event, raw: unknown) => {
    const request = z.object({ projectPath: z.string().min(1), expanded: z.boolean() }).parse(raw)
    deps.setPetExpanded(event, request.projectPath, request.expanded)
  })
}
