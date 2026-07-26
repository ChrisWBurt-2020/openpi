import type { RunContract, RunState } from '../../src/lib/runs'
import { timestamp } from './state'

export function transition(
  state: RunState,
  changes: Partial<RunState>,
  eventAt = timestamp()
): RunState {
  return {
    ...state,
    ...changes,
    stateVersion: state.stateVersion + 1,
    lastEventSequence: state.lastEventSequence + 1,
    updatedAt: eventAt,
    lastEventAt: eventAt,
  }
}

export function reviseContract(
  state: RunState,
  source: RunContract['revisions'][number]['source'],
  text: string
): RunState {
  const createdAt = timestamp()
  const version = state.contract.version + 1
  const contract = {
    ...state.contract,
    version,
    revisions: [...state.contract.revisions, { version, source, text, createdAt }],
  }
  return transition(
    state,
    { contract, contractVersion: version, outcome: null, phase: 'planning' },
    createdAt
  )
}

export function progressFingerprint(state: RunState): string {
  const commands = state.observedEvidence.commands
    .slice(-3)
    .map((command) => `${command.toolCallId}:${command.exitCode}`)
    .join('|')
  return [
    state.observedEvidence.diffHash ?? '',
    commands,
    state.lastCheckpoint?.summary ?? '',
    state.outcome?.summary ?? '',
  ].join('\n')
}
