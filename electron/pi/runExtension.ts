import type { InlineExtension } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import {
  type RunCheckpoint,
  type RunInput,
  type RunOutcome,
  runCheckpointSchema,
  runInputSchema,
  runOutcomeSchema,
} from '../../src/lib/runs'

export interface RunContext {
  id: string
  epoch: number
  contractVersion: number
  continuationId?: string
}

export type RunControlEvent =
  | { type: 'outcome'; context: RunContext; payload: RunOutcome; toolCallId: string }
  | { type: 'input'; context: RunContext; payload: RunInput; toolCallId: string }
  | { type: 'checkpoint'; context: RunContext; payload: RunCheckpoint; toolCallId: string }
  | { type: 'continuation_ack'; context: RunContext; continuationId: string }

const OUTCOME = Type.Object({
  status: Type.Union([Type.Literal('completed'), Type.Literal('blocked')]),
  contractVersion: Type.Integer({ minimum: 1 }),
  summary: Type.String({ minLength: 1, maxLength: 2000 }),
  verification: Type.Optional(
    Type.Array(
      Type.Object({
        label: Type.String({ minLength: 1, maxLength: 240 }),
        result: Type.Union([
          Type.Literal('passed'),
          Type.Literal('failed'),
          Type.Literal('not_run'),
          Type.Literal('not_applicable'),
        ]),
        evidenceToolCallId: Type.Optional(Type.String({ minLength: 1 })),
        notes: Type.Optional(Type.String({ maxLength: 800 })),
      }),
      { maxItems: 30 }
    )
  ),
  blockers: Type.Optional(
    Type.Array(
      Type.Object({
        kind: Type.Union([
          Type.Literal('credential'),
          Type.Literal('environment'),
          Type.Literal('dependency'),
          Type.Literal('external_service'),
          Type.Literal('safety'),
          Type.Literal('unsupported'),
        ]),
        message: Type.String({ minLength: 1, maxLength: 800 }),
        suggestedAction: Type.Optional(Type.String({ maxLength: 800 })),
      }),
      { maxItems: 20 }
    )
  ),
  remainingWork: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 30 })
  ),
})
const INPUT = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 2000 }),
  reason: Type.String({ minLength: 1, maxLength: 1000 }),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String({ minLength: 1, maxLength: 100 }),
        label: Type.String({ minLength: 1, maxLength: 160 }),
        description: Type.Optional(Type.String({ maxLength: 500 })),
      }),
      { maxItems: 8 }
    )
  ),
})
const CHECKPOINT = Type.Object({
  phase: Type.Union([
    Type.Literal('planning'),
    Type.Literal('executing'),
    Type.Literal('verifying'),
    Type.Literal('finalizing'),
  ]),
  summary: Type.String({ minLength: 1, maxLength: 800 }),
  completedSteps: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 20 })
  ),
  nextStep: Type.Optional(Type.String({ maxLength: 500 })),
  evidenceToolCallIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 })),
})

const RUN_TOOL_NAMES = [
  'openpi_report_run_outcome',
  'openpi_request_run_input',
  'openpi_report_run_checkpoint',
]

export function runInstructions(context: RunContext): string {
  return `
## OpenPi Run contract

You are executing Run ${context.id}, contract revision ${context.contractVersion}. Give a concise plan, then begin the first executable step in this same turn. Do not stop after setup narration. Continue until the task is complete, blocked, or requires a human decision.

When complete or blocked, call openpi_report_run_outcome as the only tool call in that assistant tool batch. When you need a user decision, call openpi_request_run_input as the only tool call in its batch. Report meaningful phase changes with openpi_report_run_checkpoint. Do not claim background work after your turn ends.
`
}

/** Trusted control plane only: Pi retains ownership of model turns and tools. */
export function createRunExtension(
  getContext: () => RunContext | null,
  emit: (event: RunControlEvent) => void
): InlineExtension {
  return {
    name: 'openpi-run-continuity',
    factory: (pi) => {
      const dispatched = new Set<string>()
      pi.on('session_start', (_event, ctx) => {
        for (const entry of ctx.sessionManager.getEntries()) {
          const continuationId = continuationIdFromEntry(entry)
          if (continuationId) dispatched.add(continuationId)
        }
      })
      pi.registerCommand('openpi-run-continue', {
        description: 'Internal OpenPi Run continuation dispatch.',
        handler: async () => {
          const context = getContext()
          const continuationId = context?.continuationId
          if (!context || !continuationId) return
          if (dispatched.has(continuationId)) {
            emit({ type: 'continuation_ack', context, continuationId })
            return
          }
          pi.sendMessage(
            {
              customType: 'openpi-run-continuation',
              content:
                '[OpenPi Run continuation] Continue the active task. Reinspect current state, do not repeat completed work, and finish, block, or request input.',
              display: false,
              details: { continuationId, runId: context.id, runEpoch: context.epoch },
            },
            { deliverAs: 'followUp', triggerTurn: true }
          )
          pi.appendEntry('openpi-run-dispatch', {
            continuationId,
            runId: context.id,
            runEpoch: context.epoch,
            contractVersion: context.contractVersion,
          })
          dispatched.add(continuationId)
          emit({ type: 'continuation_ack', context, continuationId })
        },
      })
      pi.on('before_agent_start', (event) => {
        const context = getContext()
        const active = pi.getActiveTools().filter((name) => !RUN_TOOL_NAMES.includes(name))
        pi.setActiveTools(context ? [...active, ...RUN_TOOL_NAMES] : active)
        return context
          ? { systemPrompt: `${event.systemPrompt}\n${runInstructions(context)}` }
          : undefined
      })
      pi.registerTool({
        name: 'openpi_report_run_outcome',
        label: 'Report Run Outcome',
        description: 'Finish the active OpenPi Run with a structured completed or blocked outcome.',
        parameters: OUTCOME,
        async execute(toolCallId, raw) {
          const context = getContext()
          const parsed = runOutcomeSchema.safeParse(raw)
          if (
            !context ||
            !parsed.success ||
            parsed.data.contractVersion !== context.contractVersion
          )
            return {
              content: [{ type: 'text', text: 'Run outcome rejected.' }],
              details: {},
              terminate: true,
            }
          emit({ type: 'outcome', context, payload: parsed.data, toolCallId })
          return {
            content: [{ type: 'text', text: 'Run outcome recorded; wait for settlement.' }],
            details: {},
            terminate: true,
          }
        },
      })
      pi.registerTool({
        name: 'openpi_request_run_input',
        label: 'Request Run Input',
        description: 'Pause the active OpenPi Run for a necessary user decision.',
        parameters: INPUT,
        async execute(toolCallId, raw) {
          const context = getContext()
          const parsed = runInputSchema.safeParse(raw)
          if (!context || !parsed.success)
            return {
              content: [{ type: 'text', text: 'Run input request rejected.' }],
              details: {},
              terminate: true,
            }
          emit({ type: 'input', context, payload: parsed.data, toolCallId })
          return {
            content: [{ type: 'text', text: 'Run is waiting for user input.' }],
            details: {},
            terminate: true,
          }
        },
      })
      pi.registerTool({
        name: 'openpi_report_run_checkpoint',
        label: 'Report Run Checkpoint',
        description: 'Record a concise, meaningful Run progress checkpoint.',
        parameters: CHECKPOINT,
        async execute(toolCallId, raw) {
          const context = getContext()
          const parsed = runCheckpointSchema.safeParse(raw)
          if (!context || !parsed.success)
            return { content: [{ type: 'text', text: 'Run checkpoint rejected.' }], details: {} }
          emit({ type: 'checkpoint', context, payload: parsed.data, toolCallId })
          return { content: [{ type: 'text', text: 'Run checkpoint recorded.' }], details: {} }
        },
      })
    },
  }
}

function continuationIdFromEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const data = record.data
  if (record.type === 'custom' && record.customType === 'openpi-run-dispatch') {
    return continuationIdFromData(data)
  }
  if (record.type !== 'custom_message') return null
  const message = record.message
  if (!message || typeof message !== 'object') return null
  const details = (message as Record<string, unknown>).details
  return continuationIdFromData(details)
}

function continuationIdFromData(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const continuationId = (value as Record<string, unknown>).continuationId
  return typeof continuationId === 'string' && continuationId.length > 0 ? continuationId : null
}
