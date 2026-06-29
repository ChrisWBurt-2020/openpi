/**
 * Parse `@heyhuynhgiabuu/pi-task` artifacts under `.pi/artifacts/`.
 *
 * Canonical layout (flat, no per-task dirs):
 *   TASKS.md              — `### <task-id>` blocks with `status:` frontmatter
 *   task-sessions.json    — conversation_id → { task_id, session_file }
 */
import fs from 'node:fs'
import path from 'node:path'

export const TASKS_FILE = 'TASKS.md'

export interface PiTaskBlock {
  taskId: string
  status: 'active' | 'done' | 'abandoned' | null
  body: string
  updatedAtMs: number
}

export interface PiTaskMetadata {
  conversation_id?: string
  task_id?: string
  agent_type?: string
  session_file?: string
  last_prompt?: string
  last_used_at?: string
  created_at?: string
}

export function getTasksFilePath(artifactsDir: string): string {
  return path.join(artifactsDir, TASKS_FILE)
}

export function parseTaskBlocks(content: string): Map<string, PiTaskBlock> {
  const blocks = new Map<string, PiTaskBlock>()
  const lines = content.split('\n')
  let currentTaskId: string | null = null
  let currentStatus: PiTaskBlock['status'] = null
  let currentUpdatedMs = 0
  let currentBody: string[] = []

  const flush = () => {
    if (currentTaskId === null) return
    blocks.set(currentTaskId, {
      taskId: currentTaskId,
      status: currentStatus,
      body: currentBody.join('\n'),
      updatedAtMs: currentUpdatedMs,
    })
    currentTaskId = null
    currentStatus = null
    currentUpdatedMs = 0
    currentBody = []
  }

  for (const line of lines) {
    const heading = line.match(/^###\s+(\S+)\s*$/)
    if (heading) {
      flush()
      currentTaskId = heading[1]
      continue
    }
    if (currentTaskId === null) continue

    const statusLine = line.match(/^status:\s*([^|\s]+)/)
    if (statusLine) {
      const raw = statusLine[1].trim().toLowerCase()
      if (raw === 'active' || raw === 'done' || raw === 'abandoned') {
        currentStatus = raw
      }
      const updatedMatch = line.match(/updated:\s*(\S+)/)
      if (updatedMatch) {
        const parsed = Date.parse(updatedMatch[1])
        if (Number.isFinite(parsed)) currentUpdatedMs = parsed
      }
      continue
    }
    currentBody.push(line)
  }
  flush()
  return blocks
}

export function parseMetadataFromBody(body: string): PiTaskMetadata | undefined {
  const match = body.match(/```json\n([\s\S]*?)\n```/)
  if (!match) return undefined
  try {
    return JSON.parse(match[1]) as PiTaskMetadata
  } catch {
    return undefined
  }
}

export function extractResultSection(body: string): string | null {
  const idx = body.indexOf('#### Result')
  if (idx === -1) return null
  const after = body.slice(idx + '#### Result'.length).trim()
  return after.length > 0 ? after : null
}

export function readTasksFile(artifactsDir: string): Map<string, PiTaskBlock> {
  const filePath = getTasksFilePath(artifactsDir)
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const stat = fs.statSync(filePath)
    const blocks = parseTaskBlocks(content)
    for (const block of blocks.values()) {
      if (block.updatedAtMs === 0) block.updatedAtMs = stat.mtimeMs
    }
    return blocks
  } catch {
    return new Map()
  }
}
