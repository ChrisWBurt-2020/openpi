import { z } from 'zod'
import {
  companionEvidenceRefSchema,
  companionOperationalStateSchema,
  projectHarnessProfileSchema,
} from './companion'

export const companionAttentionSchema = z.object({
  id: z.string().min(1).max(240),
  level: z.enum(['informational', 'action_required']),
  label: z.string().min(1).max(240),
  sourceRevision: z.number().int().nonnegative(),
  acknowledged: z.boolean(),
  evidence: z.array(companionEvidenceRefSchema).min(1).max(8),
})
export type CompanionAttention = z.infer<typeof companionAttentionSchema>

export const companionActionSchema = z.object({
  id: z.enum(['open_project', 'open_run', 'answer', 'review', 'resume', 'inspect_error']),
  label: z.string().min(1).max(80),
  evidenceUri: z.string().min(1).max(512).optional(),
})
export type CompanionAction = z.infer<typeof companionActionSchema>

export const companionActivitySchema = z.object({
  openLoop: z.string().min(1).max(500).nullable(),
  actions: z.array(companionActionSchema).max(6),
  evidenceCount: z.number().int().nonnegative(),
})
export type CompanionActivity = z.infer<typeof companionActivitySchema>

export const companionSpriteSchema = z.object({
  packId: z.string().min(1).max(120),
  clipId: z.string().min(1).max(120),
  palette: z.object({ accent: z.string(), signal: z.string(), alert: z.string() }),
  accessory: z.string().min(1).max(80),
})
export type CompanionSprite = z.infer<typeof companionSpriteSchema>

export const companionProjectViewSchema = z.object({
  projectId: z.string().regex(/^project_[a-z0-9]+$/),
  projectPath: z.string().min(1).max(4096),
  revision: z.number().int().nonnegative(),
  profile: projectHarnessProfileSchema,
  state: companionOperationalStateSchema,
  attention: companionAttentionSchema.nullable(),
  activity: companionActivitySchema,
  sprite: companionSpriteSchema,
  evidence: z.array(companionEvidenceRefSchema).max(8),
  updatedAt: z.string().datetime(),
})
export type CompanionProjectView = z.infer<typeof companionProjectViewSchema>

export const companionViewsSchema = z.record(z.string().regex(/^project_[a-z0-9]+$/), companionProjectViewSchema)
export type CompanionViews = z.infer<typeof companionViewsSchema>

export function companionSeverity(state: CompanionProjectView['state']): number {
  switch (state.kind) {
    case 'error': return 5
    case 'unknown': return 4
    case 'blocked': return 3
    case 'review': return 2
    case 'active': return 1
    case 'idle': return 0
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}
