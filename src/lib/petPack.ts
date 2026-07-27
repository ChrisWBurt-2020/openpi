import { z } from 'zod'

const pathSchema = z.string().min(1).max(240).refine((value) => !value.includes('..') && !value.includes('\\') && !value.startsWith('/'), 'asset path must be relative')
const frameSchema = z.object({ column: z.number().int().nonnegative(), row: z.number().int().nonnegative(), durationMs: z.number().int().min(40).max(2_000) })

export const petClipSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  frames: z.array(frameSchema).min(1).max(12),
  loop: z.boolean().default(true),
  reducedMotionFrame: z.number().int().nonnegative().default(0),
  anchor: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).default({ x: 0.5, y: 0.9 }),
  hitbox: z.object({ x: z.number().min(0), y: z.number().min(0), width: z.number().positive(), height: z.number().positive() }),
  accessoryAnchor: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
})
export type PetClip = z.infer<typeof petClipSchema>

export const petPackManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/).max(120),
  displayName: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  renderMode: z.enum(['smooth', 'pixelated']).default('smooth'),
  atlas: z.object({ path: pathSchema, cellWidth: z.number().int().min(24).max(512), cellHeight: z.number().int().min(24).max(512), columns: z.number().int().min(1).max(16), rows: z.number().int().min(1).max(24) }),
  railAtlas: z.object({ path: pathSchema, cellWidth: z.number().int().min(12).max(64), cellHeight: z.number().int().min(12).max(64) }).optional(),
  palette: z.object({ accent: z.string().regex(/^#[0-9a-fA-F]{6}$/), signal: z.string().regex(/^#[0-9a-fA-F]{6}$/), alert: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  clips: z.array(petClipSchema).min(1).max(32),
  fallbacks: z.record(z.string().max(120), z.string().max(120)).default({}),
})
export type PetPackManifest = z.infer<typeof petPackManifestSchema>

export const petPackSummarySchema = z.object({ id: z.string(), displayName: z.string(), description: z.string(), renderMode: z.enum(['smooth', 'pixelated']), source: z.enum(['builtin', 'openpi', 'codex']), removable: z.boolean() })
export type PetPackSummary = z.infer<typeof petPackSummarySchema>

export const petPackRuntimeSchema = petPackManifestSchema.extend({
  atlasUrl: z.string().min(1),
  railAtlasUrl: z.string().min(1).nullable(),
})
export type PetPackRuntime = z.infer<typeof petPackRuntimeSchema>

export const petPackImportSchema = z.object({ folder: z.string().min(1).max(4_096) })
