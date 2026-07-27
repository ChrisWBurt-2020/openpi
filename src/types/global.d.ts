import type { OpenPiAPI } from '../../electron/preload'
import type { CompanionViews } from '../lib/companionView'

declare global {
  interface Window {
    openpi: OpenPiAPI
    heron: {
      list: () => Promise<CompanionViews>
      pin: (projectPath: string, pinned: boolean) => Promise<void>
      showSiege: () => Promise<void>
      activate: (projectPath: string) => Promise<void>
      showMenu: (projectPath: string) => Promise<void>
      setPointerInteractive: (projectPath: string, interactive: boolean) => Promise<void>
      openEvidence: (projectPath: string, evidenceUri: string) => Promise<void>
      listPacks: () => Promise<import('../lib/petPack').PetPackSummary[]>
      getPack: (id: string) => Promise<import('../lib/petPack').PetPackRuntime | null>
      setExpanded: (projectPath: string, expanded: boolean) => Promise<void>
      importPack: () => Promise<import('../lib/petPack').PetPackSummary | null>
      removePack: (id: string) => Promise<void>
      updateProfile: (request: import('../lib/companion').ProjectHarnessProfileUpdate) => Promise<import('../lib/companion').ProjectHarnessProfile>
      setExpanded: (projectPath: string, expanded: boolean) => Promise<void>
      onChanged: (callback: (views: CompanionViews) => void) => () => void
      getPack: (id: string) => Promise<import('../lib/petPack').PetPackRuntime | null>
    }
  }
}
