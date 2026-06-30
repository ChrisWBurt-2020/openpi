/**
 * Sub-session navigation primitives.
 *
 * pi-task creates one sub-session file per task, at
 * `<cwd>/.pi/artifacts/sessions/<taskId>/<file>.jsonl`. Sub-sessions are
 * first-class nodes in the session tree — clicking a `task` tool row in
 * the parent should navigate to the child, not expand a widget.
 *
 * The functions here are pure: no Solid runtime, no DOM, no IPC. They
 * only compute paths and reason about whether a given session file is a
 * sub-session. Tested in `tests/isSubSessionPath.test.ts`.
 */

/** Path marker shared by main and renderer to identify sub-sessions. */
export const SUB_SESSION_PATH_HINT = '/.pi/artifacts/sessions/'

/** True iff `path` points inside `.pi/artifacts/sessions/` (a pi-task sub-session). */
export function isSubSessionPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && path.includes(SUB_SESSION_PATH_HINT)
}
