# ADR-007: Pi Signals use structured, user-curated insight events

## Decision

OpenPi provides Pi Signals through a named first-party Pi extension. The extension exposes a read-only `emit_insight` tool and injects concise explanatory guidance per user turn. It does not parse decorative assistant markdown or expose hidden reasoning.

Each signal carries a category, explanation, confidence, observed/inferred basis, and evidence. Tool-call arguments persist in Pi session JSONL, allowing cards to rehydrate after thread switching and sidecar suspension.

## User control

Signals are off, critical, balanced, or mentor; this installation defaults to mentor. Saving an insight to the project notebook is always an explicit user action. Notebook entries live in OpenPi's local SQLite index. “Teach Pi” creates a composer prompt for the agent to edit project context through normal, reviewable tools; OpenPi never writes `AGENTS.md` directly.

## Consequences

- The renderer remains presentation-only; all notebook writes go through validated Electron-main IPC.
- A signal is a model assertion, not a verified fact. Cards show confidence, basis, and evidence.
- The built-in extension is trusted app code and safe to load for untrusted workspaces because it has no filesystem, shell, Git, or network behavior.
- Pi-task subagents are outside the first slice; the parent task can still report a signal from their summary.
