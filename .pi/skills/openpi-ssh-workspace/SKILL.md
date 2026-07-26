---
name: openpi-ssh-workspace
description: Diagnose and repair OpenPi SSH Workspace sessions that use local models/authentication against remote Linux files. Use for missing remote file trees, tool timeouts, path-not-found errors, local-vs-remote authority confusion, stalled SSH transport, or sidecar workspace-request/result failures.
---

# OpenPi SSH Workspace

Keep workspace authority remote and inference authority local. Establish which boundary failed before changing the transport or asking the user to reconnect.

## Triage order

1. Confirm the execution mode is **SSH Workspace**, not Persistent Remote Runner. Local Pi models and JSONL are expected; files and commands execute on the selected host.
2. Inspect the main-process diagnostic journal and Electron terminal for the same request ID. Follow: sidecar request received → Electron-main operation started → SSH/SFTP or shell operation completed/failed → matching `workspace_result` delivered → Pi tool card reaches a terminal result.
3. If Electron main reports a completed request but Pi says the workspace timed out or is missing, inspect sidecar result-envelope handling before touching SSH. A successful result includes `data`; never mistake that field for an Electron `MessageEvent` wrapper.
4. If transport itself is slow, verify the host with a read-only direct SSH command. Keep host, path, user, and credential details out of normal logs.

## Safety invariants

- Never fall back to a Windows workspace path when an SSH request fails.
- Keep paths and commands out of shell interpolation. Send them as structured data or through the fixed shell bootstrap's stdin.
- Accept a POSIX absolute path only when its normalized, remote-resolved location is inside the selected project root.
- Resolve symlinks and nearest existing parents before read/write authority decisions.
- Treat Stop Agent, sidecar replacement, connection loss, and timeout as terminal outcomes for pending requests.
- Do not retry writes or arbitrary shell commands automatically after a connection reset. A read-only operation may be retried after an explicit reconnect.

## Transport guidance

- Keep one reusable SFTP channel per live profile for structured read/write/stat operations and recreate it after failure.
- Use the fixed, root-contained shell bootstrap for bash, bounded remote search, and large file-tree discovery. Avoid recursive SFTP tree walks: they create one round trip per directory and can exceed UI deadlines.
- Give every request an ID, deadline, operation kind, and terminal response. Reset a stalled SSH client so the next request reconnects instead of reusing a dead channel.
- Validate both directions of the sidecar protocol with Zod. Test direct Node-fork payloads and utility-process envelopes separately.

## Verification

Run this minimal remote smoke sequence before declaring a fix:

1. File tree lists known project files without showing a local directory.
2. `bash` returns `pwd` and `echo connected` from the selected remote root.
3. `read` returns a known remote file.
4. Exercise `edit` or `write` only in a disposable fixture, then verify the remote change.
5. Stop Agent cancels a pending operation and leaves no request unresolved.
6. Test a successful result containing `data`, a failed result, split message chunks, and a stale sidecar response.
