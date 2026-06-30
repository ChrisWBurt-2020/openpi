# Phase 0 — Execution / cwd Foundation Audit

**Date:** 2025-07-17  
**Scope:** Trace every surface where a thread/agent/sidecar/terminal/Git operation
resolves "which directory am I working in" and identify gaps before adding
worktree mode or automations.

---

## How cwd flows today

```
User opens project folder
    │
    ▼
setDeferredWorkspace(path)   ─── stored in module-level `deferredWorkspace`
    │
    ▼
NEW_SESSION { cwd }          ─── renderer sends the deferred workspace path
    │
    ▼
sidecarHost.start(cwd)       ─── Pi sidecar launched with --session-cwd <cwd>
    │
    ▼
Pi sidecar responds SessionReady { cwd }
    │
    ▼
applySessionValues()         ─── calls setSessionState({ cwd, ... })
    │
    ▼
getSessionState()?.cwd       ─── authoritative cwd for the active session
    │
    ├──▶ getCwd()            ─── IPC handlers for PTY, Git, resources
    ├──▶ activeWorkspacePath() ─── workbench context, side-panel metadata
    └──▶ getReady().cwd      ─── renderer (App.tsx, via SessionReady IPC)
```

### Fallback

| Sink | Prefers | Falls back to |
|------|---------|---------------|
| `getCwd()` | `sessionState?.cwd` | `getDeferredWorkspace()` |
| `activeWorkspacePath()` | `sessionState?.cwd` | `getDeferredWorkspace()` |
| `getReady().cwd` (renderer) | `SessionReady.cwd` | `null` (guarded by `<Show when={session.ready}>`) |

---

## File-by-file inventory

### 1. `electron/session/sessionHost.ts`

- `setDeferredWorkspace(p)`, `getDeferredWorkspace()` — module-level string.
- `setSessionState(s)`, `getSessionState()` — stored in `_currentSessionState`.
- `activeWorkspacePath()` — returns `sessionState?.cwd ?? getDeferredWorkspace()`.
- `startSession(cwd)` — creates `.pi` dir, sets up trust, calls `sidecarHost.start()`.
- State is **global singleton** — there is exactly one active session with one cwd.

**Status:** Clean for single-session. **Blocking for worktrees** — global.

### 2. `electron/session/sessionIndex.ts`

- `SessionEntry` has `cwd: string` and `workspacePath: string`.
- `add()` saves the session entry with both fields.
- `SessionIndexStore` persists them to JSON.

**Status:** Good. Both fields already present for worktree future use.

### 3. `electron/pi/sidecarHost.ts`

- `start(cwd)` spawns `pi --mode rpc --session-cwd <cwd>`.
- `handleSidecarMessage()` parses `SessionReady` → calls `applySessionValues(cwd, ...)`.
- Only one sidecar process at a time.

**Status:** Clean for single session. For worktrees, each thread would need its own
sidecar or the sidecar must be told to switch cwd.

### 4. `electron/ipc/register.ts`

- `registerIpcHandlers()` constructs `getCwd()` closure:
  ```ts
  const getCwd = () => sessionState?.cwd ?? getDeferredWorkspace()
  ```
- This is passed to PTY IPC, Git IPC, and resource IPC.
- All handlers subscribe to the **same global `getCwd`**.

**Status:** Single cwd source. Worktree mode requires per-thread cwd resolution.

### 5. `electron/ipc/pty.ts`

- `createPty` handler uses `getCwd()` to set the shell startup directory.
- `PtyHost.create(cwd, ...)` → `spawn(shell, [], { cwd })`.
- `XtermPty` stores the initial cwd but does **not** track shell `cd`.

**Status:** PTY cwd is correct at creation time. **No shell cwd tracking.**
Agent cannot programmatically know the terminal's current directory after `cd`.

### 6. `electron/services/ptyHost.ts`

- `PtyHost.create(cwd, ...)` sets `options.cwd = cwd` for the child process.
- Terminal output flows to renderer as a raw stream.
- No structured "current directory" information sent to the renderer or agent.

**Status:** Correct initialization. No `getCurrentCwd()` lifecycle.

### 7. `electron/git/ipc.ts`

- Every Git IPC handler receives `getCwd()` as the workspace root.
- `gitHost.getChanges(cwd)`, `gitHost.getDiff(cwd, ...)`, etc.
- All Git operations use the same global cwd.

**Status:** Single cwd today. Worktree mode needs per-thread routing.

### 8. `electron/git/gitMutations.ts`

- `stageFiles(cwd, files)`, `revertFiles(cwd, files)`, `stageAllChanges(cwd)`.
- Operates on whole files only — **no hunk-level stage/unstage/revert**.

**Status:** Functional for whole-file operations. Hunk operations are missing.

### 9. `electron/git/gitHost.ts`

- `exec(args)` runs `child_process.exec` at `this.cwd`.
- GitHost is instantiated per-call with the global `getCwd()` result.

**Status:** Stateless per-call. Worktree-safe as long as caller passes correct cwd.

### 10. `electron/services/workbenchContext.ts`

- `buildWorkbenchContextPrefix()` captures `activeWorkspacePath()` at call time.
- Workbench context is sent to the Pi agent every turn.
- Context includes: agent uptime, recent session snapshot, pending review,
  attached files, terminal info, active/preview tabs.

**Status:** Correct for single session. Would need `activeWorkspacePath()` to
resolve per-thread in worktree mode.

### 11. `src/App.tsx` (renderer)

- `getReady().cwd` is the renderer's cwd source.
- `useAppFileManager` receives `cwd: () => session.selectedWorkspacePath ?? ''`.
- `session.selectedWorkspacePath` comes from `getReady().cwd`.

**Status:** Correct for single session. Worktree mode needs per-tab cwd.

### 12. `electron/ipc/resources.ts`

- `readFile`, `writeFile`, `editFile`, `createFile`, `deleteFile`, `listDir`
  all resolve paths relative to `getCwd()` by default, or use absolute paths.

**Status:** Correct. Worktree mode would need to pass per-thread resolved paths.

### 13. `electron/ipc/workspaces.ts`

- `setDeferredWorkspace(path)` — used when switching projects.
- `getLastWorkspacePaths()` — returns recently opened workspaces.
- `openWorkspace(path)` — updates last-workspace list, sets deferred workspace.

**Status:** Solid. No issues for current single-session model.

### 14. Tests

| Test file | cwd coverage |
|-----------|-------------|
| `tests/sessionEvents.test.ts` | Verifies `SessionReady` payload has `cwd` field. |
| `tests/sessionIndex.test.ts` | Verifies `cwd` and `workspacePath` are stored. |
| `tests/ptyHost.test.ts` | Verifies `cwd` is passed to `spawn`. |
| `tests/workspaceTrustSync.test.ts` | Trust decisions use workspace path correctly. |

**Status:** Minimal but good for the current surface.

---

## Gap analysis for worktree/automation readiness

| # | Gap | Location | Severity | Fix needed before worktrees? |
|---|-----|----------|----------|-----|
| G1 | **cwd is a global singleton** throughout the Electron process | `sessionHost.ts`, `register.ts` | **blocking** | Yes — each thread must carry its own cwd |
| G2 | **No `ThreadCwd` abstraction** — `cwd` is just a `string` everywhere | Entire codebase | **blocking** | Yes — thread cwd must be a first-class concept |
| G3 | **Terminal `cd` drift** — PTY initial cwd is correct, but `cd` is untracked | `ptyHost.ts`, `pty.ts` | medium | No, but useful for review pane cwd accuracy |
| G4 | **No hunk-level Git operations** — only whole-file stage/revert | `gitMutations.ts` | medium | No (Phase 3 concern), but part of cwd audit because hunks need correct cwd context |
| G5 | **Workbench context cwd is a snapshot** — correct per-turn but not reactive | `workbenchContext.ts` | low | No |
| G6 | **Sidecar is single-instance** — one Pi agent per session | `sidecarHost.ts` | **blocking** | Yes — worktrees need either multiple sidecars or cwd-switching |
| G7 | **Renderer has no per-thread cwd model** — `getReady().cwd` is global | `App.tsx`, `useAppFileManager.ts` | **blocking** | Yes |

---

## Recommended actions for Phase 0

### Must fix before Phase 2 (worktree MVP)

1. **Define `ThreadCwd` interface**

   ```ts
   // somewhere in shared types (electron/types.ts or similar)
   type ThreadCwd = {
     /** The root directory this thread is working in */
     root: string
     /** Optional: Git worktree path if applicable */
     worktreePath?: string
     /** Optional: user-applied cd override in terminal (null = root) */
     terminalCwd?: string | null
   }
   ```

2. **Replace global `getCwd()` with thread-scoped resolution**

   - Create a `ThreadCwdRegistry` that maps thread/session IDs to `ThreadCwd`.
   - IPC handlers resolve cwd by thread/session ID, not global.
   - `getCwd()` becomes `getCwd(threadId: string)`.

3. **Make `sidecarHost` support per-thread cwd**

   - Either multiplex one sidecar with `cd` commands before tool execution,
   - Or start multiple sidecar processes (one per thread).

4. **Add `threadCwd` to `SessionReady` and renderer state**

   - Renderer stores per-thread cwd, not just `getReady().cwd`.
   - `useAppFileManager`, terminal, and Git panel all read from thread state.

### Can defer (track in Phase 2/3)

5. **Add terminal shell cwd tracking** — use shell integration or prompt parsing.

6. **Add hunk-level Git operations** — part of Phase 3 review controls.

7. **Switch sidecar to per-thread process model** — needed for concurrent worktree
   agent execution.

---

## Verification

After Phase 0 fixes, these assertions must hold:

- [ ] Every IPC handler receives a **thread-specific cwd**, not a global.
- [ ] Terminal PTY is created at the correct thread cwd.
- [ ] Git operations run at the correct thread cwd.
- [ ] Workbench context uses the correct thread cwd.
- [ ] Session persistence stores per-thread cwd correctly.
- [ ] `SessionReady.cwd` maps to the creating thread.
- [ ] Switching threads/workspaces does not leak cwd between threads.
- [ ] Tests exist for each cwd resolution path.
