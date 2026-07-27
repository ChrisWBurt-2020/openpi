import activeSheet from '../../assets/companion/sprites/sheets/active.webp?url'
import blockedSheet from '../../assets/companion/sprites/sheets/blocked.webp?url'
import errorSheet from '../../assets/companion/sprites/sheets/error.webp?url'
import idleSheet from '../../assets/companion/sprites/sheets/idle.webp?url'
import reviewSheet from '../../assets/companion/sprites/sheets/review.webp?url'
import unknownSheet from '../../assets/companion/sprites/sheets/unknown.webp?url'
import { z } from 'zod'
import type { SpriteManifest } from './HeronSprite'

export const spriteClipSchema = z.object({
  sheet: z.string().min(1),
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  frames: z.number().int().positive(),
  fps: z.number().positive().max(10),
  reducedMotionFrame: z.number().int().nonnegative(),
  loop: z.boolean(),
  anchor: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  hitbox: z.object({ x: z.number().min(0), y: z.number().min(0), width: z.number().positive(), height: z.number().positive() }),
  paletteKeys: z.array(z.enum(['accent', 'signal', 'alert'])).min(1),
})

export const spriteManifestSchema = z.object({ clips: z.record(z.string().min(1), spriteClipSchema) })

const frame = (sheet: string, fps: number): SpriteManifest['clips'][string] => ({
  sheet,
  frameWidth: 160,
  frameHeight: 160,
  frames: 2,
  fps,
  reducedMotionFrame: 0,
  loop: true,
  anchor: { x: 0.5, y: 0.92 },
  hitbox: { x: 20, y: 14, width: 120, height: 132 },
  paletteKeys: ['accent', 'signal', 'alert'],
})

export const heronSpriteManifest: SpriteManifest = spriteManifestSchema.parse({
  clips: {
    idle: frame(idleSheet, 2),
    active: frame(activeSheet, 6),
    'active-planning': frame(activeSheet, 4),
    'active-executing': frame(activeSheet, 8),
    'active-verifying': frame(reviewSheet, 6),
    'active-finalizing': frame(idleSheet, 4),
    review: frame(reviewSheet, 4),
    blocked: frame(blockedSheet, 3),
    'blocked-user_input': frame(blockedSheet, 4),
    'blocked-approval': frame(blockedSheet, 3),
    'blocked-paused': frame(blockedSheet, 2),
    'blocked-checkout_busy': frame(blockedSheet, 3),
    'blocked-rate_limited': frame(blockedSheet, 3),
    'blocked-stalled': frame(blockedSheet, 2),
    'blocked-budget_exhausted': frame(blockedSheet, 2),
    'blocked-other': frame(blockedSheet, 3),
    error: frame(errorSheet, 6),
    unknown: frame(unknownSheet, 2),
  },
})
