# Concurrent Thread Workers

**Status:** Accepted
**Date:** 2026-07-26

## Context

OpenPi originally hosted one Pi sidecar and replaced its live session whenever the user opened another chat. That serialized all work, could mix late events into the newly selected chat, and made switching away from a running task destructive.

Concurrency must preserve Pi's native JSONL session semantics, keep untrusted extensions and tool execution isolated, and never discard in-flight work to satisfy navigation.

## Decision

OpenPi runs one sidecar process per live chat, managed by a capped worker pool.

- The default cap is three live workers.
- Running workers and the foreground worker are never evicted.
- At capacity, OpenPi evicts the least-recently-used idle worker. If every worker is protected, opening another chat fails explicitly.
- Every renderer-facing ready, event, and error payload carries the pool `threadId`.
- Electron main retains thread-scoped session and cwd state. Foreground-only Git, review, extension UI, and notification effects do not run for background events.
- The renderer stores immutable per-thread snapshots and exposes the selected snapshot through the existing session API.
- Idle worker eviction does not delete conversation state; Pi's JSONL session rehydrates it when reopened.

## Consequences

Chats can continue streaming while the user reads or starts work elsewhere. A worker crash is isolated to its chat, and late events cannot bleed across threads.

The application uses more memory while several workers are live. The pool cap and idle eviction bound that cost. Some application-wide catalogs remain shared, while mutable conversation state must stay thread-scoped.

## Verification

Focused tests cover pool capacity and eviction, per-thread epoch gates, session-start races, A/B transcript and queue isolation, retained model/thinking state, shutdown, and crash cleanup.
