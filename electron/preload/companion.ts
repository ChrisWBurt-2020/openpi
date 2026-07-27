import { ipcRenderer } from 'electron'
import { z } from 'zod'
import type { CompanionViews } from '../../src/lib/companionView'
import { companionViewsSchema } from '../../src/lib/companionView'
import { IPC } from '../../src/lib/ipc'
import type { PetPackRuntime, PetPackSummary } from '../../src/lib/petPack'
import type { ProjectHarnessProfile, ProjectHarnessProfileUpdate } from '../../src/lib/companion'

const projectPathSchema = z.object({ projectPath: z.string().min(1) })
const pointerSchema = projectPathSchema.extend({ interactive: z.boolean() })
const openSchema = projectPathSchema.extend({ tab: z.enum(['now', 'evidence']) })

export const companionApi = {
  companion: {
    list: async (): Promise<CompanionViews> =>
      companionViewsSchema.parse(await ipcRenderer.invoke(IPC.COMPANION_LIST)),
    pin: (projectPath: string, pinned: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.COMPANION_PIN, { projectPath, pinned }),
    showSiege: (): Promise<void> => ipcRenderer.invoke(IPC.COMPANION_SHOW_SIEGE),
    activate: (projectPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.COMPANION_PET_ACTIVATE, projectPathSchema.parse({ projectPath })),
    showMenu: (projectPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.COMPANION_PET_MENU, projectPathSchema.parse({ projectPath })),
    setPointerInteractive: (projectPath: string, interactive: boolean): Promise<void> =>
      ipcRenderer.invoke(
        IPC.COMPANION_PET_POINTER,
        pointerSchema.parse({ projectPath, interactive })
      ),
    openEvidence: (projectPath: string, evidenceUri: string): Promise<void> =>
      ipcRenderer.invoke(IPC.COMPANION_EVIDENCE_OPEN, { projectPath, evidenceUri }),
    listPacks: (): Promise<PetPackSummary[]> => ipcRenderer.invoke(IPC.COMPANION_PACK_LIST),
    getPack: (id: string): Promise<PetPackRuntime | null> => ipcRenderer.invoke(IPC.COMPANION_PACK_GET, id),
    importPack: (): Promise<PetPackSummary | null> => ipcRenderer.invoke(IPC.COMPANION_PACK_IMPORT),
    removePack: (id: string): Promise<void> => ipcRenderer.invoke(IPC.COMPANION_PACK_REMOVE, id),
    updateProfile: (request: ProjectHarnessProfileUpdate): Promise<ProjectHarnessProfile> =>
      ipcRenderer.invoke(IPC.COMPANION_PROFILE_UPDATE, request),
    setExpanded: (projectPath: string, expanded: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.COMPANION_PET_EXPANDED, { projectPath, expanded }),
    onChanged: (cb: (views: CompanionViews) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        const parsed = companionViewsSchema.safeParse(payload)
        if (parsed.success) cb(parsed.data)
      }
      ipcRenderer.on(IPC.COMPANION_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.COMPANION_CHANGED, handler)
    },
    onOpen: (cb: (request: z.infer<typeof openSchema>) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        const parsed = openSchema.safeParse(payload)
        if (parsed.success) cb(parsed.data)
      }
      ipcRenderer.on(IPC.COMPANION_OPEN, handler)
      return () => ipcRenderer.removeListener(IPC.COMPANION_OPEN, handler)
    },
  },
} as const
