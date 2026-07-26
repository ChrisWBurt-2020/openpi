# Remote project execution over SSH

## Decision

OpenPi treats a remote project as an SSH location, not a mounted or mirrored local folder. Electron main owns the authenticated SSH client and exposes only validated intent through preload. A verified connection multiplexes SFTP, short remote checks, and worker channels.

Remote projects have two explicit execution modes:

- **SSH Workspace:** Pi, model discovery, provider authentication, and JSONL sessions remain on the desktop. The trusted local sidecar delegates workspace tool operations over SSH.
- **Persistent Remote Runner:** Pi runs on the host through the OpenPi runner supervisor. This mode is for work that must remain alive when the desktop disconnects, and its model catalog is explicitly remote.

## Security boundaries

- Profiles and accepted host fingerprints are stored in local SQLite; a changed fingerprint blocks the connection.
- SSH-agent and identity-file authentication are supported. Password authentication is intentionally absent.
- Provider keys are explicitly entered for a **Persistent Remote Runner** connection, encrypted with Electron `safeStorage`, and passed only to a newly started runner through its encrypted SSH channel. OpenPi never copies local Pi `auth.json` or sends local credentials to an SSH Workspace.
- Remote project paths are resolved with SFTP `realpath` before persistence. The renderer receives an opaque `ssh://<workspace-id>` location, never a client or file handle.

## Runtime boundary

Remote Pi runs through strict LF-delimited RPC mode. The remote runner helper is versioned under `~/.openpi/runtime/0.82.1`; its creation and private pinned package install require an explicit wizard click and never invoke `sudo`. Its Unix socket is owned by the remote user and mode `0600`.

## Consequences

Remote and local workers share the existing three-live-thread pool and the non-eviction rule for running work. An SSH Workspace loses only its remote tool transport on disconnect; its local Pi session and JSONL remain available. A Persistent Remote Runner detaches on desktop shutdown and reconnects through its runner supervisor; the UI only reports a run as alive after the supervisor confirms it.

SSH Workspace tool routing currently covers Pi's read, write, edit, list, find, and bash operations over the main-owned connection. Workbench file, Git, terminal, and session-index surfaces are being routed through the same backend and must never fall back to local filesystem authority.
