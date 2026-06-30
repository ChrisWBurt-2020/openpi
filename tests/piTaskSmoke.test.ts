import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readTaskSessionHistory, resolveSubSessionPath } from '../electron/services/piTaskArtifacts'

describe('pi-task JSON smoke fixture', () => {
  it('reads task history and resolves sub-session JSONL', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-pitask-'))
    const taskId = 'm1done-c3d4'
    try {
      fs.mkdirSync(path.join(cwd, '.pi', 'artifacts', 'sessions', taskId), { recursive: true })
      fs.writeFileSync(
        path.join(cwd, '.pi', 'task-session-history.json'),
        JSON.stringify([{ id: taskId, status: 'done', agentType: 'scout' }])
      )
      fs.writeFileSync(
        path.join(cwd, '.pi', 'artifacts', 'sessions', taskId, 'session.jsonl'),
        `${JSON.stringify({
          type: 'message',
          message: {
            role: 'assistant',
            stopReason: 'stop',
            content: [{ type: 'text', text: 'done' }],
          },
        })}\n`
      )

      expect(readTaskSessionHistory(cwd)[0]?.id).toBe(taskId)
      expect(resolveSubSessionPath(path.join(cwd, '.pi', 'artifacts'), taskId)).toContain(
        'session.jsonl'
      )
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })
})
