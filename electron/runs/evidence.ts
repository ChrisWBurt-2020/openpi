import type { ObservedRunEvidence, RunState } from '../../src/lib/runs'

const MAX_ITEMS = 1_000

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function mutablePath(toolName: string, args: unknown): string | null {
  if (!/(?:write|edit|patch|replace)/i.test(toolName)) return null
  const fields = record(args)
  return string(fields?.path) ?? string(fields?.filePath) ?? string(fields?.file_path)
}

function command(toolName: string, args: unknown): string | null {
  if (!/(?:bash|shell|command)/i.test(toolName)) return null
  const fields = record(args)
  return string(fields?.command)
}

function exitCode(result: unknown): number | null {
  const fields = record(result)
  const code = fields?.exitCode ?? fields?.exit_code
  return typeof code === 'number' && Number.isInteger(code) ? code : null
}

/** Builds a bounded, renderer-safe receipt from actual observed tool lifecycle events. */
export function evidenceForEvent(
  state: RunState,
  event: Record<string, unknown>
): ObservedRunEvidence {
  const toolCallId = string(event.toolCallId)
  const toolName = string(event.toolName)
  if (!toolCallId || !toolName) return state.observedEvidence
  const evidence = state.observedEvidence
  if (event.type === 'tool_execution_start') {
    const path = mutablePath(toolName, event.args)
    if (!path || evidence.changedFiles.includes(path)) return evidence
    return { ...evidence, changedFiles: [...evidence.changedFiles, path].slice(-MAX_ITEMS) }
  }
  if (event.type !== 'tool_execution_end') return evidence
  const executed = command(toolName, event.args)
  if (!executed) return evidence
  const commandEvidence = { toolCallId, command: executed, exitCode: exitCode(event.result) }
  const commands = [
    ...evidence.commands.filter((item) => item.toolCallId !== toolCallId),
    commandEvidence,
  ]
  const checks =
    commandEvidence.exitCode === null
      ? evidence.checks
      : [
          ...evidence.checks.filter((item) => item.evidenceToolCallId !== toolCallId),
          {
            name: commandEvidence.command.slice(0, 300),
            result: commandEvidence.exitCode === 0 ? ('passed' as const) : ('failed' as const),
            evidenceToolCallId: toolCallId,
          },
        ]
  return { ...evidence, commands: commands.slice(-MAX_ITEMS), checks: checks.slice(-MAX_ITEMS) }
}
