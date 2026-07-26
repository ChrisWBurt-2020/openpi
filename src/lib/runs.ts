import { z } from 'zod'

export const composerIntentSchema = z.enum(['ask', 'run'])
export type ComposerIntent = z.infer<typeof composerIntentSchema>

export const sessionPromptResultSchema = z.discriminatedUnion('accepted', [
  z.object({ accepted: z.literal(true) }),
  z.object({
    accepted: z.literal(false),
    reason: z.literal('checkout_busy'),
    message: z.string(),
  }),
])
export type SessionPromptResult = z.infer<typeof sessionPromptResultSchema>

export const runLifecycleSchema = z.enum([
  'starting',
  'active',
  'continuation_queued',
  'waiting',
  'pausing',
  'paused',
  'reconnecting',
  'terminal',
])
export const runPhaseSchema = z.enum(['planning', 'executing', 'verifying', 'finalizing'])
export const runWaitingReasonSchema = z.enum([
  'user_input',
  'approval',
  'checkout_busy',
  'connection_lost',
  'runner_unconfirmed',
  'rate_limited',
  'stalled',
  'continuation_budget_exhausted',
])
export const runTerminalReasonSchema = z.enum(['completed', 'blocked', 'failed', 'cancelled'])
export const runReviewStateSchema = z.enum([
  'not_applicable',
  'ready',
  'accepted',
  'changes_requested',
])

export const runOutcomeSchema = z.object({
  status: z.enum(['completed', 'blocked']),
  contractVersion: z.number().int().positive(),
  summary: z.string().min(1).max(2_000),
  verification: z
    .array(
      z.object({
        label: z.string().min(1).max(240),
        result: z.enum(['passed', 'failed', 'not_run', 'not_applicable']),
        evidenceToolCallId: z.string().min(1).optional(),
        notes: z.string().max(800).optional(),
      })
    )
    .max(30)
    .optional(),
  blockers: z
    .array(
      z.object({
        kind: z.enum([
          'credential',
          'environment',
          'dependency',
          'external_service',
          'safety',
          'unsupported',
        ]),
        message: z.string().min(1).max(800),
        suggestedAction: z.string().max(800).optional(),
      })
    )
    .max(20)
    .optional(),
  remainingWork: z.array(z.string().min(1).max(500)).max(30).optional(),
})
export type RunOutcome = z.infer<typeof runOutcomeSchema>

export const runInputSchema = z.object({
  question: z.string().min(1).max(2_000),
  reason: z.string().min(1).max(1_000),
  options: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        label: z.string().min(1).max(160),
        description: z.string().max(500).optional(),
      })
    )
    .max(8)
    .optional(),
})
export type RunInput = z.infer<typeof runInputSchema>

export const runCheckpointSchema = z.object({
  phase: runPhaseSchema,
  summary: z.string().min(1).max(800),
  completedSteps: z.array(z.string().min(1).max(300)).max(20).optional(),
  nextStep: z.string().max(500).optional(),
  evidenceToolCallIds: z.array(z.string().min(1)).max(20).optional(),
})
export type RunCheckpoint = z.infer<typeof runCheckpointSchema>

export const runStateSchema = z.object({
  id: z.string().uuid(),
  sessionPath: z.string().nullable(),
  threadId: z.string().nullable(),
  workspacePath: z.string().min(1),
  runEpoch: z.number().int().positive(),
  stateVersion: z.number().int().nonnegative(),
  lastEventSequence: z.number().int().nonnegative(),
  lifecycle: runLifecycleSchema,
  phase: runPhaseSchema.nullable(),
  waitingReason: runWaitingReasonSchema.nullable(),
  terminalReason: runTerminalReasonSchema.nullable(),
  reviewState: runReviewStateSchema,
  contractVersion: z.number().int().positive(),
  lastContinuationId: z.string().nullable(),
  continuationCountThisCycle: z.number().int().nonnegative(),
  continuationCountTotal: z.number().int().nonnegative(),
  maxContinuationsThisCycle: z.number().int().positive(),
  activeTools: z.record(
    z.string(),
    z.object({
      toolCallId: z.string(),
      toolName: z.string(),
      startedAt: z.string(),
      lastUpdateAt: z.string(),
    })
  ),
  updatedAt: z.string(),
  lastMeaningfulProgressAt: z.string(),
  outcome: runOutcomeSchema.nullable(),
  pendingInput: runInputSchema.nullable(),
})
export type RunState = z.infer<typeof runStateSchema>

export const runIdSchema = z.object({
  runId: z.string().uuid(),
  expectedStateVersion: z.number().int().nonnegative(),
})
export const runListSchema = z.object({ workspacePath: z.string().min(1).optional() }).optional()
