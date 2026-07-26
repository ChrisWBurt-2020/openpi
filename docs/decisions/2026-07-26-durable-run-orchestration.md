# Durable Run Orchestration and Honest Status

**Status:** Partially staged — not a verified product surface
**Date:** 2026-07-26

## Context

Pi owns an individual agent turn, tool execution, its message queue, and the
authoritative JSONL session. OpenPi needs a narrow, durable control plane for a
user-selected task that can span more than one Pi turn without claiming that
work continues after Pi has stopped.

The initial implementation was exercised while SSH Workspace transport was
unstable. It exposed continuation loops, stale checkout ownership, and UI that
could not accurately explain what was active. Workspace stabilization is now
the prerequisite for making this feature broadly available.

## Decision

OpenPi will retain the following boundary:

- **Ask** is one user-dispatched Pi turn and remains the default.
- **Run** is an explicit, versioned task contract owned by Electron main.
- Pi remains responsible for each agent turn. OpenPi decides only whether a
  settled Run may wait, finish, or receive one explicitly recorded
  continuation.
- Settlement decisions use Pi's `agent_settled`; `agent_end` is telemetry and
  transient UI only.
- A write-capable Run owns one physical checkout at a time. Thread identity is
  insufficient because two chats can target the same files.
- Completion after a write is a reviewable state, never an implicit commit,
  merge, or acceptance.

## Current implementation

The repository currently has an experimental foundation:

| Area | Present | Current limitation |
| --- | --- | --- |
| Ask / Run composer intent | Yes | Ask is the only verified smoke path. |
| Durable materialized state and event log | Yes | The stored shape is a reduced Run state, not the full task-contract/evidence model. |
| Checkout ownership | Yes | It has no queue or worktree-choice UX, and startup/loss reconciliation needs broader smoke coverage. |
| `agent_settled` continuation decision | Yes | The continuation protocol has not completed acknowledgement and replay hardening. |
| Run control tools | Yes | Outcome/input sibling-batch rejection and checkpoint rate limiting are not enforced end to end. |
| Pause / cancel IPC | Yes | It aborts the Pi turn, but remote process acknowledgement and a visible surviving-process state are incomplete. |
| Ready-for-review state | Partial | It is inferred without authoritative changed-file/diff/test evidence or a review receipt. |
| Renderer Run status | Partial | The composer toggle exists; durable cards, status interception, input answers, notifications, and review actions are absent. |

In particular, `run_dispatches` records scheduled continuations, but the
extension does not yet acknowledge a persisted continuation entry or deduplicate
one after process recovery. The current recovery message is deliberately
minimal; it does not yet include the required checkout, diff, checkpoints, and
observed verification envelope.

## Required stabilization before enabling Run as a product feature

1. Prove local Git, local non-Git, SSH Workspace, and Persistent Runner Ask
   flows can list, read, edit, and stop cleanly. A transport failure must put a
   Run into an actionable waiting state and must never trigger a continuation.
2. Reconcile leases on startup, worker loss, and sidecar replacement so an
   unconfirmed Run cannot block a new chat indefinitely.
3. Finish idempotent continuation dispatch: transactionally schedule, append
   the visible continuation through Pi's supported API, receive its entry
   acknowledgement, and reject duplicate IDs.
4. Persist the complete contract revision and bind it to session ID, JSONL
   path, leaf ID, checkout identity, epoch, and evidence. A later steer, queue,
   or answer must invalidate an older provisional outcome immediately.
5. Derive review evidence from actual tool, Git, diff, and command events.
   Claims without compatible observed evidence remain visibly unverified.
6. Add durable renderer controls for status, input, queue/worktree conflict,
   pause/cancel, recovery, and review. "Working" may only appear for an active
   turn/tool, a durably queued continuation, or supervisor-confirmed execution.

## Consequences

Run remains experimental while the workspace gate is open. It must not spend
additional provider turns merely because a sidecar event, SSH channel, or
renderer projection failed. Users can continue to use Ask, Pi's native steer,
follow-up, and abort controls while the durable orchestration contract is
hardened.

When implemented, Run will make task continuity observable and reviewable
without replacing Pi's agent loop or changing OpenPi's existing desktop policy.

## Verification gate

Before changing this ADR to **Accepted**, require tests for settlement after
automatic Pi retry/compaction, duplicate and out-of-order events, continuation
crash windows, stale contract outcomes, checkout exclusivity, worker-loss lease
recovery, remote stop acknowledgement, and evidence contradictions. Run the
local and SSH Workspace smoke matrix before enabling continuations by default.
