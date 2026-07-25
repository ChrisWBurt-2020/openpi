/**
 * bootTarget.ts — what should the app show when it starts?
 *
 * Upstream behaviour restored the last *workspace* and then handed you a
 * blank new session, leaving the previous conversation on disk and in the
 * sidebar but not in front of you. After a crash or a forced restart that
 * reads as "my chat is gone", which is how this was reported.
 *
 * Restoring the last session instead is the same thing clicking it in the
 * sidebar does, just done for you.
 */

export type BootTarget =
  | { kind: 'session'; cwd: string; sessionFile: string }
  | { kind: 'workspace'; cwd: string }
  | { kind: 'none' }

export interface ResolveBootTargetInput {
  lastWorkspace: string | null
  /** Most recently updated session for that workspace, if the index knows one. */
  lastSessionFile: string | null
  /**
   * Whether the session file is still on disk. Sessions can be deleted or
   * moved behind the index's back, and resuming a path that no longer exists
   * would fail the boot instead of degrading to the workspace.
   */
  sessionFileExists: (path: string) => boolean
}

export function resolveBootTarget(input: ResolveBootTargetInput): BootTarget {
  const { lastWorkspace, lastSessionFile, sessionFileExists } = input

  if (!lastWorkspace) return { kind: 'none' }
  if (!lastSessionFile) return { kind: 'workspace', cwd: lastWorkspace }
  if (!sessionFileExists(lastSessionFile)) return { kind: 'workspace', cwd: lastWorkspace }

  return { kind: 'session', cwd: lastWorkspace, sessionFile: lastSessionFile }
}
