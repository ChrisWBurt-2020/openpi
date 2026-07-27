import { contextBridge } from 'electron'
import { api } from './preload/api'
import { companionApi } from './preload/companion'

/**
 * Narrow, typed preload bridge.
 * Renderer accesses ONLY what is explicitly exposed here.
 * No Node built-ins, no raw ipcRenderer, no electron imports in renderer.
 */
// Sandboxed Electron preloads cannot resolve Rollup's shared chunks. Keep this
// as the sole preload entry and expose the small pet bridge only in pet windows.
if (new URLSearchParams(window.location.search).has('companion')) {
  contextBridge.exposeInMainWorld('heron', companionApi.companion)
} else {
  contextBridge.exposeInMainWorld('openpi', api)
}

export type OpenPiAPI = typeof api
