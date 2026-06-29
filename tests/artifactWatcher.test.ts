import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readTasksFile } from '../electron/services/piTaskArtifacts'

describe('artifactWatcher inputs', () => {
  it('readTasksFile returns empty when TASKS.md is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-art-'))
    try {
      expect(readTasksFile(dir).size).toBe(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('readTasksFile parses pi-task TASKS.md blocks', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-art-'))
    try {
      const tasksPath = path.join(dir, 'TASKS.md')
      fs.writeFileSync(
        tasksPath,
        `### m1abc-x7f2
status: active | updated: 2026-06-01T00:00:00.000Z

#### Result

pending
`
      )
      const blocks = readTasksFile(dir)
      expect(blocks.size).toBe(1)
      expect(blocks.get('m1abc-x7f2')?.status).toBe('active')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
