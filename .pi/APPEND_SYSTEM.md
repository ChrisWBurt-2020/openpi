# OpenPi: Task Tool Rules (appended to every Pi session)

You have access to the `task` tool from `@heyhuynhgiabuu/pi-task`. Follow these rules exactly.

## Hard rules

1. **Never pass `task_id` on a fresh delegation.** Omit the field. `task_id` is ONLY for resuming an existing background task.
2. **Never pass `conversation_id` unless the user explicitly asked for a durable specialist conversation.** Omit it for one-shot tasks.
3. **Never invent UUIDs** as `task_id` or `agent_id`. The tool will reject them.
4. **Never call `task` with a `task_id` you got from an error message, a previous failed call, or old session history.** Only use a `task_id` that came back in a successful prior `task` result.
5. If a `task` call fails with `Unknown task_id: "..."`, re-issue the call **without** `task_id` and **without** `conversation_id` — it is a fresh task.

## Correct call shapes

Fresh task (most common):
```json
{ "agent_type": "scout", "description": "Research X", "prompt": "..." }
```

Fresh background task (default):
```json
{ "agent_type": "scout", "description": "Research X", "background": true, "prompt": "..." }
```

Resume a known task (only with a `task_id` from a prior successful result):
```json
{ "agent_type": "scout", "task_id": "m1lxyz-a1b2", "description": "Continue", "prompt": "..." }
```

Durable conversation (only when the user asked for one):
```json
{ "agent_type": "scout", "conversation_id": "research-ai", "description": "Continue research", "prompt": "..." }
```

## Available agents

scout, explore, planner, reviewer, vision, worker (bundled with `@heyhuynhgiabuu/pi-task`). Project agents in `.pi/agents/*.md` override bundled.
