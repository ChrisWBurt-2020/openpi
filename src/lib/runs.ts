import { z } from 'zod'

export const composerIntentSchema = z.enum(['ask', 'run'])
export type ComposerIntent = z.infer<typeof composerIntentSchema>

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
export const projectExecutionModeSchema = z.enum(['local', 'ssh-workspace', 'persistent-runner'])
export type ProjectExecutionMode = z.infer<typeof projectExecutionModeSchema>

export const runWorkspaceIdentitySchema = z.object({
  hostId: z.string().min(1),
  connectionId: z.string().uuid().nullable(),
  workspacePath: z.string().min(1),
  checkoutId: z.string().min(1),
  worktreePath: z.string().nullable(),
  branch: z.string().nullable(),
  headSha: z.string().nullable(),
  dirtyAtStart: z.boolean(),
})
export type RunWorkspaceIdentity = z.infer<typeof runWorkspaceIdentitySchema>

export const activeToolStateSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  label: z.string().max(240).optional(),
  startedAt: z.string(),
  lastUpdateAt: z.string(),
})
export type ActiveToolState = z.infer<typeof activeToolStateSchema>

const runRevisionSchema = z.object({
  version: z.number().int().positive(),
  source: z.enum(['initial', 'steer', 'queue', 'resume', 'user_input', 'request_changes']),
  text: z.string().min(1).max(100_000),
  createdAt: z.string(),
})

export const runContractSchema = z.object({
  version: z.number().int().positive(),
  originalInput: z.object({
    text: z.string().min(1).max(100_000),
    attachmentRefs: z.array(z.string().max(4_096)).max(100),
    contextRefs: z.array(z.string().max(4_096)).max(100),
    mentionRefs: z.array(z.string().max(4_096)).max(100),
  }),
  acceptanceCriteria: z.array(z.string().max(2_000)).max(30),
  constraints: z.array(z.string().max(2_000)).max(30),
  modelId: z.string().max(500),
  providerId: z.string().max(500),
  thinkingLevel: z.string().max(100).nullable(),
  permissionProfileId: z.string().min(1).max(200),
  sandboxProfileId: z.string().max(200).nullable(),
  createdAt: z.string(),
  revisions: z.array(runRevisionSchema).max(100),
})
export type RunContract = z.infer<typeof runContractSchema>

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

export const observedRunEvidenceSchema = z.object({
  changedFiles: z.array(z.string().min(1).max(4_096)).max(10_000),
  diffHash: z.string().max(200).nullable(),
  commands: z
    .array(
      z.object({
        toolCallId: z.string().min(1),
        command: z.string().max(10_000),
        exitCode: z.number().int().nullable(),
      })
    )
    .max(1_000),
  checks: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        result: z.enum(['passed', 'failed']),
        evidenceToolCallId: z.string().min(1),
      })
    )
    .max(1_000),
})
export type ObservedRunEvidence = z.infer<typeof observedRunEvidenceSchema>

const supervisorSchema = z.object({
  runnerInstanceId: z.string().min(1),
  heartbeatAt: z.string(),
  leaseExpiresAt: z.string(),
  activeTurnId: z.string().nullable(),
})

export const runStateSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().nullable(),
  threadId: z.string().nullable(),
  openPiThreadId: z.string().nullable(),
  piSessionId: z.string().nullable(),
  sessionPath: z.string().nullable(),
  sessionLeafId: z.string().nullable(),
  executionMode: projectExecutionModeSchema,
  workspacePath: z.string().min(1),
  workspace: runWorkspaceIdentitySchema,
  contract: runContractSchema,
  runEpoch: z.number().int().positive(),
  stateVersion: z.number().int().nonnegative(),
  lastEventSequence: z.number().int().nonnegative(),
  lifecycle: runLifecycleSchema,
  phase: runPhaseSchema.nullable(),
  waitingReason: runWaitingReasonSchema.nullable(),
  terminalReason: runTerminalReasonSchema.nullable(),
  reviewState: runReviewStateSchema,
  activeTurnId: z.string().nullable(),
  hasPendingPiQueue: z.boolean(),
  pauseAfterCurrentTool: z.boolean(),
  activeTools: z.record(z.string(), activeToolStateSchema),
  contractVersion: z.number().int().positive(),
  lastContinuationId: z.string().nullable(),
  continuationCountThisCycle: z.number().int().nonnegative(),
  continuationCountTotal: z.number().int().nonnegative(),
  maxContinuationsThisCycle: z.number().int().positive(),
  lastProgressFingerprint: z.string().nullable(),
  repeatedNoProgressCount: z.number().int().nonnegative(),
  startedAt: z.string(),
  updatedAt: z.string(),
  lastEventAt: z.string(),
  lastMeaningfulProgressAt: z.string(),
  outcome: runOutcomeSchema.nullable(),
  lastCheckpoint: runCheckpointSchema.nullable(),
  observedEvidence: observedRunEvidenceSchema,
  pendingInput: runInputSchema.nullable(),
  pendingApproval: z
    .object({ id: z.string().min(1), summary: z.string().min(1).max(2_000) })
    .nullable(),
  supervisor: supervisorSchema.nullable(),
  recoveryNotice: z.string().max(2_000).nullable(),
})
export type RunState = z.infer<typeof runStateSchema>

export const runIdSchema = z.object({
  runId: z.string().uuid(),
  expectedStateVersion: z.number().int().nonnegative(),
})
export const runListSchema = z.object({ workspacePath: z.string().min(1).optional() }).optional()
export const runPauseSchema = runIdSchema.extend({
  mode: z.enum(['now', 'after_tool']).default('now'),
})
export const runAnswerInputSchema = runIdSchema.extend({ answer: z.string().min(1).max(100_000) })
export const runRequestChangesSchema = runIdSchema.extend({ text: z.string().min(1).max(100_000) })
export const checkoutStrategySchema = z.enum(['queue', 'cancel', 'worktree'])
export const runCheckoutConflictSchema = runIdSchema.extend({ strategy: checkoutStrategySchema })
export type CheckoutStrategy = z.infer<typeof checkoutStrategySchema>

export const sessionPromptResultSchema = z.discriminatedUnion('accepted', [
  z.object({ accepted: z.literal(true), runId: z.string().uuid().optional() }),
  z.object({
    accepted: z.literal(false),
    reason: z.literal('checkout_busy'),
    message: z.string(),
    runId: z.string().uuid().nullable().optional(),
  }),
])
export type SessionPromptResult = z.infer<typeof sessionPromptResultSchema>
