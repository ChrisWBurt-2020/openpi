import fs from 'node:fs'
import path from 'node:path'
import { nativeImage } from 'electron'
import { petPackManifestSchema, type PetPackManifest, type PetPackRuntime, type PetPackSummary } from '../../src/lib/petPack'

const MAX_FILE_BYTES = 32 * 1024 * 1024
const BUILTIN: PetPackSummary = { id: 'builtin-graphic-heron', displayName: 'Graphic Heron', description: 'OpenPi’s black-and-ivory circuit Heron.', renderMode: 'smooth', source: 'builtin', removable: false }

export class PetPackStore {
  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true })
  }

  list(): PetPackSummary[] {
    const packs = [BUILTIN]
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifest = this.readManifest(entry.name)
      if (!manifest) continue
      packs.push({ id: manifest.id, displayName: manifest.displayName, description: manifest.description, renderMode: manifest.renderMode, source: 'openpi', removable: true })
    }
    return packs.sort((left, right) => left.displayName.localeCompare(right.displayName))
  }

  importFolder(folder: string): PetPackSummary {
    const source = path.resolve(folder)
    const manifest = this.readSourceManifest(source)
    this.validateAssets(source, manifest)
    const target = path.join(this.root, manifest.id)
    if (fs.existsSync(target)) throw new Error(`A pet pack named ${manifest.id} is already installed.`)
    fs.mkdirSync(target, { recursive: true })
    const files = new Set([manifest.atlas.path, manifest.railAtlas?.path].filter(isString))
    for (const asset of files) fs.copyFileSync(path.join(source, asset), path.join(target, asset))
    fs.writeFileSync(path.join(target, 'openpi-pet.json'), JSON.stringify(manifest, null, 2), 'utf8')
    return { id: manifest.id, displayName: manifest.displayName, description: manifest.description, renderMode: manifest.renderMode, source: 'openpi', removable: true }
  }

  remove(id: string): void {
    if (id === BUILTIN.id) throw new Error('The built-in Heron cannot be removed.')
    const target = path.join(this.root, id)
    if (!fs.existsSync(target)) return
    fs.rmSync(target, { recursive: true, force: true })
  }

  resolve(id: string, asset: string): string | null {
    if (id === BUILTIN.id) return null
    const manifest = this.readManifest(id)
    if (!manifest || ![manifest.atlas.path, manifest.railAtlas?.path].includes(asset)) return null
    const file = path.resolve(this.root, id, asset)
    return isInside(path.resolve(this.root, id), file) && fs.existsSync(file) ? file : null
  }

  manifest(id: string): PetPackManifest | null {
    return id === BUILTIN.id ? null : this.readManifest(id)
  }

  runtime(id: string): PetPackRuntime | null {
    const manifest = this.manifest(id)
    if (!manifest) return null
    return {
      ...manifest,
      atlasUrl: `openpi-pet://${manifest.id}/${encodeURIComponent(manifest.atlas.path)}`,
      railAtlasUrl: manifest.railAtlas ? `openpi-pet://${manifest.id}/${encodeURIComponent(manifest.railAtlas.path)}` : null,
    }
  }

  private readManifest(id: string): PetPackManifest | null {
    if (!/^[a-z0-9-]+$/.test(id)) return null
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(this.root, id, 'openpi-pet.json'), 'utf8'))
      const parsed = petPackManifestSchema.safeParse(raw)
      return parsed.success ? parsed.data : null
    } catch { return null }
  }

  private readSourceManifest(folder: string): PetPackManifest {
    const openPiPath = path.join(folder, 'openpi-pet.json')
    if (fs.existsSync(openPiPath)) return petPackManifestSchema.parse(readJson(openPiPath))
    const codexPath = path.join(folder, 'pet.json')
    if (!fs.existsSync(codexPath)) throw new Error('Select a folder containing openpi-pet.json or Codex pet.json.')
    const raw = readRecord(readJson(codexPath))
    const id = stringField(raw, 'id')
    const displayName = stringField(raw, 'displayName')
    const description = typeof raw.description === 'string' ? raw.description : ''
    return petPackManifestSchema.parse(codexManifest(id, displayName, description, typeof raw.spritesheetPath === 'string' ? raw.spritesheetPath : 'spritesheet.webp'))
  }

  private validateAssets(folder: string, manifest: PetPackManifest): void {
    if (!manifest.clips.some((clip) => clip.id === 'idle')) throw new Error('A pet pack needs an idle clip.')
    for (const relative of [manifest.atlas.path, manifest.railAtlas?.path].filter(isString)) {
      const file = path.resolve(folder, relative)
      if (!isInside(folder, file) || !fs.existsSync(file)) throw new Error(`Missing pack asset: ${relative}`)
      if (fs.statSync(file).size > MAX_FILE_BYTES) throw new Error(`Pack asset is too large: ${relative}`)
      const image = nativeImage.createFromPath(file)
      const size = image.getSize()
      if (image.isEmpty() || size.width < 1 || size.height < 1 || size.width > 4096 || size.height > 4096) throw new Error(`Invalid pack image: ${relative}`)
    }
    const atlas = nativeImage.createFromPath(path.resolve(folder, manifest.atlas.path)).getSize()
    if (atlas.width !== manifest.atlas.cellWidth * manifest.atlas.columns || atlas.height !== manifest.atlas.cellHeight * manifest.atlas.rows) throw new Error('Atlas dimensions do not match its manifest.')
    for (const clip of manifest.clips) for (const frame of clip.frames) if (frame.column >= manifest.atlas.columns || frame.row >= manifest.atlas.rows) throw new Error(`Clip ${clip.id} addresses a frame outside the atlas.`)
  }
}

function codexManifest(id: string, displayName: string, description: string, atlasPath: string): PetPackManifest {
  const frames = (row: number, count: number, duration: number) => Array.from({ length: count }, (_, column) => ({ row, column, durationMs: duration }))
  const clip = (name: string, row: number, count: number, duration: number) => ({ id: name, frames: frames(row, count, duration), loop: true, reducedMotionFrame: 0, anchor: { x: 0.5, y: 0.9 }, hitbox: { x: 16, y: 16, width: 160, height: 180 } })
  return {
    schemaVersion: 1, id, displayName, description, renderMode: 'pixelated',
    atlas: { path: atlasPath, cellWidth: 192, cellHeight: 208, columns: 8, rows: 9 },
    palette: { accent: '#59c7ff', signal: '#c9df45', alert: '#ff7145' },
    clips: [clip('idle', 0, 6, 180), clip('drag-right', 1, 8, 120), clip('drag-left', 2, 8, 120), clip('wave', 3, 4, 160), clip('celebrate', 4, 5, 160), clip('error', 5, 8, 150), clip('blocked-user_input', 6, 6, 170), clip('active-executing', 7, 6, 140), clip('review', 8, 6, 170)],
    fallbacks: { 'active-planning': 'active-executing', 'active-verifying': 'active-executing', 'active-finalizing': 'active-executing', 'blocked-approval': 'blocked-user_input', 'blocked-other': 'blocked-user_input' },
  }
}

function readJson(file: string): unknown { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function readRecord(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object') throw new Error('Invalid pet manifest.'); return value as Record<string, unknown> }
function stringField(value: Record<string, unknown>, key: string): string { if (typeof value[key] !== 'string' || !value[key]) throw new Error(`Pet manifest needs ${key}.`); return value[key] }
function isString(value: string | undefined): value is string { return typeof value === 'string' }
function isInside(root: string, target: string): boolean { const relative = path.relative(root, target); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) }
