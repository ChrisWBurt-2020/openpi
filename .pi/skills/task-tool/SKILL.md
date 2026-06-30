---
name: task-tool
description: How to call the `task` tool from `@heyhuynhgiabuu/pi-task` v0.2.0 correctly. Load when you need to delegate to a subagent (scout, explore, planner, reviewer, vision, worker).
---

## Rules (matches pi-task v0.2.0)

1. **Never pass `task_id` on a fresh delegation.** Omit the field. `task_id` is for resuming an existing background task only.
2. **Never pass `conversation_id` unless the user explicitly asked for a durable specialist conversation.**
3. **Never invent UUIDs** as `task_id` or `agent_id`. The tool will reject them.
4. **Only use a `task_id` that came back in a successful prior `task` result.** Never reuse one from an error message or old history.
5. If a `task` call returns `Unknown task_id: "..."`, re-issue without `task_id` and without `conversation_id`.

## Call shapes

Fresh:
```json
{ "agent_type": "scout", "description": "Research X", "prompt": "..." }
```

Background (default in pi-task):
```json
{ "agent_type": "scout", "description": "Research X", "background": true, "prompt": "..." }
```

Resume (only with a valid `task_id` from a prior result):
```json
{ "agent_type": "scout", "task_id": "m1lxyz-a1b2", "description": "Continue", "prompt": "..." }
```

Durable conversation (only when the user asked for one):
```json
{ "agent_type": "scout", "conversation_id": "research-ai", "description": "Continue", "prompt": "..." }
```

## Anti-patterns

- `task_id` on a fresh call.
- `task_id` as a UUID.
- `conversation_id` without the user asking.
- Resuming a task that was never successfully started.

## Error recovery

| Error | Fix |
|---|---|
| `Unknown task_id: "..."` | Re-issue without `task_id` (fresh task) or use a `conversation_id` |
| `Unknown agent: "..."` | Use one of: scout, explore, planner, reviewer, vision, worker |
| `task_id/conversation_id mismatch` | Use the `task_id` that maps to your `conversation_id` |
