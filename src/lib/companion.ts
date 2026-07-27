import { z } from 'zod'

export const companionEvidenceRefSchema = z.object({
  kind: z.enum([
    'session',
    'run',
    'review',
    'error',
    'signal',
    'task',
    'sentinel',
    'memory',
    'transport',
  ]),
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(240),
  at: z.string().datetime(),
  threadId: z.string().min(1).max(200).optional(),
  sessionPath: z.string().min(1).max(4096).optional(),
  toolCallId: z.string().min(1).max(200).optional(),
  runId: z.string().uuid().optional(),
  code: z.string().min(1).max(200).optional(),
  uri: z.string().min(1).max(512).optional(),
  available: z.boolean().optional(),
})
export type CompanionEvidenceRef = z.infer<typeof companionEvidenceRefSchema>

export const companionSignalSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('activity_started'),
    projectPath: z.string().min(1),
    evidence: companionEvidenceRefSchema,
  }),
  z.object({
    type: z.literal('activity_stopped'),
    projectPath: z.string().min(1),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal('review_pending'),
    projectPath: z.string().min(1),
    evidence: companionEvidenceRefSchema,
  }),
  z.object({
    type: z.literal('review_cleared'),
    projectPath: z.string().min(1),
    id: z.string().min(1),
  }),
  z.object({
    type: z.literal('blocked'),
    projectPath: z.string().min(1),
    evidence: companionEvidenceRefSchema,
  }),
  z.object({ type: z.literal('unblocked'), projectPath: z.string().min(1), id: z.string().min(1) }),
  z.object({
    type: z.literal('error'),
    projectPath: z.string().min(1),
    evidence: companionEvidenceRefSchema,
  }),
  z.object({ type: z.literal('recovered'), projectPath: z.string().min(1), id: z.string().min(1) }),
])
export type CompanionSignal = z.infer<typeof companionSignalSchema>

const colorSchema = z.object({ accent: z.string(), muted: z.string(), glow: z.string() })
const idleStateSchema = z.object({ kind: z.literal('idle'), since: z.string().datetime() })
const evidencedStateSchema = z.object({
  kind: z.enum(['active', 'review', 'blocked', 'error']),
  since: z.string().datetime(),
  evidence: z.array(companionEvidenceRefSchema).min(1).max(8),
})
export const companionStateSchema = z.union([idleStateSchema, evidencedStateSchema])
export type CompanionState = z.infer<typeof companionStateSchema>

export const projectCompanionProfileSchema = z.object({
  projectPath: z.string().min(1),
  displayName: z.string().min(1).max(240),
  color: colorSchema,
  state: companionStateSchema,
  updatedAt: z.string().datetime(),
  pinned: z.boolean(),
})
export type ProjectCompanionProfile = z.infer<typeof projectCompanionProfileSchema>

export const companionStateByProjectSchema = z.record(
  z.string().min(1),
  projectCompanionProfileSchema
)
export type CompanionStateByProject = z.infer<typeof companionStateByProjectSchema>

export function companionColor(projectPath: string): ProjectCompanionProfile['color'] {
  let hash = 2166136261
  for (const char of projectPath.toLowerCase())
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  const hue = (hash >>> 0) % 360
  return {
    accent: `hsl(${hue} 78% 68%)`,
    muted: `hsl(${hue} 48% 32%)`,
    glow: `hsla(${hue} 88% 68% / 0.34)`,
  }
}

/** A stable, renderer-safe project identity derived from a canonical workspace path. */
export function projectIdForPath(projectPath: string): string {
  const canonical = projectPath.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  let first = 2166136261
  let second = 2246822519
  for (const char of canonical) {
    const point = char.charCodeAt(0)
    first = Math.imul(first ^ point, 16777619)
    second = Math.imul(second ^ point, 3266489917)
  }
  return `project_${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`
}

export const companionAccessorySchema = z.enum(['scarf', 'crest', 'ribbon', 'satchel', 'leg-band'])
export type CompanionAccessory = z.infer<typeof companionAccessorySchema>

export const companionMotionSchema = z.enum(['full', 'reduced', 'paused'])
export type CompanionMotion = z.infer<typeof companionMotionSchema>

const companionPlacementSchema = z.object({
  displayId: z.string().min(1).max(200),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  zOrder: z.number().int().nonnegative().default(0),
})

export const companionAppearanceSchema = z.object({
  accentOverride: colorSchema.nullable().default(null),
  accessory: companionAccessorySchema.default('scarf'),
  scale: z.number().min(0.75).max(1.5).default(1),
  motion: companionMotionSchema.default('full'),
  visible: z.boolean().default(true),
  pinned: z.boolean().default(false),
  alwaysOnTop: z.boolean().default(true),
  placement: companionPlacementSchema.nullable().default(null),
  petPackId: z.string().min(1).max(120).default('builtin-graphic-heron'),
})
export type CompanionAppearance = z.infer<typeof companionAppearanceSchema>

const profileModelRolesSchema = z.record(z.string().min(1).max(80), z.string().min(1).max(200))
const contextSourceSchema = z.enum(['session', 'runs', 'review', 'signals', 'memory'])

/** Durable, user-owned project preferences. It never asserts operational truth. */
export const projectHarnessProfileSchema = z.object({
  projectId: z.string().regex(/^project_[a-z0-9]+$/),
  projectPath: z.string().min(1).max(4096),
  displayName: z.string().min(1).max(240),
  revision: z.number().int().nonnegative(),
  appearance: companionAppearanceSchema,
  modelRoles: profileModelRolesSchema.default({}),
  reviewChecks: z.array(z.string().min(1).max(200)).max(30).default([]),
  signalsMode: z.enum(['off', 'critical', 'balanced', 'mentor']).default('balanced'),
  sentinelEnabled: z.boolean().default(false),
  memoryPolicy: z.enum(['off', 'propose', 'curated']).default('propose'),
  contextSources: z
    .array(contextSourceSchema)
    .max(5)
    .default(['session', 'runs', 'review', 'signals']),
  acknowledgedAttentionRevision: z.number().int().nonnegative().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type ProjectHarnessProfile = z.infer<typeof projectHarnessProfileSchema>

export const projectHarnessProfilePatchSchema = projectHarnessProfileSchema
  .pick({
    displayName: true,
    appearance: true,
    modelRoles: true,
    reviewChecks: true,
    signalsMode: true,
    sentinelEnabled: true,
    memoryPolicy: true,
    contextSources: true,
    acknowledgedAttentionRevision: true,
  })
  .partial()
export type ProjectHarnessProfilePatch = z.infer<typeof projectHarnessProfilePatchSchema>

export const projectHarnessProfileUpdateSchema = z.object({
  projectId: z.string().regex(/^project_[a-z0-9]+$/),
  expectedRevision: z.number().int().nonnegative(),
  patch: projectHarnessProfilePatchSchema.refine((patch) => Object.keys(patch).length > 0, {
    message: 'patch must contain at least one field',
  }),
})
export type ProjectHarnessProfileUpdate = z.infer<typeof projectHarnessProfileUpdateSchema>

const nonIdleEvidenceSchema = z.array(companionEvidenceRefSchema).min(1).max(8)
export const companionOperationalStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('idle'), since: z.string().datetime() }),
  z.object({
    kind: z.literal('active'),
    phase: z.enum(['planning', 'executing', 'verifying', 'finalizing']),
    since: z.string().datetime(),
    evidence: nonIdleEvidenceSchema,
  }),
  z.object({
    kind: z.literal('review'),
    since: z.string().datetime(),
    evidence: nonIdleEvidenceSchema,
  }),
  z.object({
    kind: z.literal('blocked'),
    reason: z.enum([
      'user_input',
      'approval',
      'paused',
      'checkout_busy',
      'rate_limited',
      'stalled',
      'budget_exhausted',
      'other',
    ]),
    since: z.string().datetime(),
    evidence: nonIdleEvidenceSchema,
  }),
  z.object({
    kind: z.literal('error'),
    since: z.string().datetime(),
    evidence: nonIdleEvidenceSchema,
  }),
  z.object({
    kind: z.literal('unknown'),
    reason: z.enum(['transport', 'supervisor', 'stale']),
    since: z.string().datetime(),
    evidence: nonIdleEvidenceSchema,
  }),
])
export type CompanionOperationalState = z.infer<typeof companionOperationalStateSchema>

export const companionEvidenceRecordSchema = z.object({
  uri: z.string().regex(/^evidence:\/\/[a-z]+\/.+/),
  projectId: z.string().regex(/^project_[a-z0-9]+$/),
  sourceType: z.enum([
    'run',
    'review',
    'signal',
    'task',
    'sentinel',
    'memory',
    'session',
    'transport',
    'error',
  ]),
  sourceVersion: z.string().min(1).max(200),
  label: z.string().min(1).max(240),
  createdAt: z.string().datetime(),
  available: z.boolean(),
})
export type CompanionEvidenceRecord = z.infer<typeof companionEvidenceRecordSchema>

export const companionProjectionSchema = z.object({
  projectId: z.string().regex(/^project_[a-z0-9]+$/),
  projectPath: z.string().min(1).max(4096),
  state: companionOperationalStateSchema,
  attention: z
    .object({ label: z.string().min(1).max(240), evidence: nonIdleEvidenceSchema })
    .nullable()
    .default(null),
  insightEffects: z
    .array(
      z.object({ kind: z.enum(['feather', 'firefly', 'star']), evidence: nonIdleEvidenceSchema })
    )
    .max(3)
    .default([]),
  updatedAt: z.string().datetime(),
})
export type CompanionProjection = z.infer<typeof companionProjectionSchema>
