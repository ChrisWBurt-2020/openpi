import { runCheckpointSchema, runInputSchema, runOutcomeSchema } from '../../src/lib/runs'
import type { RunContext, RunControlEvent } from '../pi/runExtension'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function context(value: unknown): RunContext | null {
  const candidate = record(value)
  if (
    !candidate ||
    typeof candidate.id !== 'string' ||
    typeof candidate.epoch !== 'number' ||
    typeof candidate.contractVersion !== 'number'
  )
    return null
  return {
    id: candidate.id,
    epoch: candidate.epoch,
    contractVersion: candidate.contractVersion,
    ...(typeof candidate.continuationId === 'string'
      ? { continuationId: candidate.continuationId }
      : {}),
  }
}

/** Converts an untrusted remote Pi tool result into a local Run control event. */
export function remoteRunControl(event: Record<string, unknown>): RunControlEvent | null {
  if (event.type !== 'tool_execution_end') return null
  const result = record(event.result)
  const details = record(result?.details)
  const control = record(details?.openpiRunControl)
  const runContext = context(control?.context)
  const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : null
  if (!control || !runContext || !toolCallId) return null
  if (control.type === 'outcome') {
    const payload = runOutcomeSchema.safeParse(control.payload)
    return payload.success
      ? { type: 'outcome', context: runContext, payload: payload.data, toolCallId }
      : null
  }
  if (control.type === 'input') {
    const payload = runInputSchema.safeParse(control.payload)
    return payload.success
      ? { type: 'input', context: runContext, payload: payload.data, toolCallId }
      : null
  }
  if (control.type === 'checkpoint') {
    const payload = runCheckpointSchema.safeParse(control.payload)
    return payload.success
      ? { type: 'checkpoint', context: runContext, payload: payload.data, toolCallId }
      : null
  }
  return null
}
