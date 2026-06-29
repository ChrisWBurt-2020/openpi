/**
 * Watches `.pi/artifacts/` for `@heyhuynhgiabuu/pi-task` (`TASKS.md`) and
 * pikit-style `TODO.md` lists. Emits `ARTIFACT_UPDATE` when content changes.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import type { ArtifactUpdate, SubagentArtifact, TodoListFile } from '../../src/lib/ipc/_full'
import { IPC } from '../../src/lib/ipc/_full'
import {
  extractResultSection,
  getTasksFilePath,
  parseMetadataFromBody,
  readTasksFile,
} from './piTaskArtifacts'

const POLL_MS = 2000

interface ArtifactWatcherDeps {
  getMainWindow: () => BrowserWindow | null
  getWorkspacePath: () => string | null
}

interface ArtifactSnapshot {
  artifact: SubagentArtifact
}

interface TodoSnapshot {
  todoFile: TodoListFile
}

function mapPiTaskStatus(
  status: 'active' | 'done' | 'abandoned' | null
): SubagentArtifact['status'] {
  if (status === 'done') return 'completed'
  if (status === 'abandoned') return 'failed'
  return 'running'
}

function blockToArtifact(
  taskId: string,
  status: 'active' | 'done' | 'abandoned' | null,
  body: string,
  updatedAtMs: number,
  artifactsDir: string
): SubagentArtifact {
  const metadata = parseMetadataFromBody(body)
  const agent = metadata?.agent_type ?? 'task'
  const prompt = (metadata?.last_prompt ?? '').trim().slice(0, 500)
  const resultText = extractResultSection(body)
  const filePath = getTasksFilePath(artifactsDir)
  return {
    id: taskId,
    taskId,
    conversationId: metadata?.conversation_id,
    agent,
    prompt: prompt || taskId,
    context: body.trim(),
    result: resultText,
    status: mapPiTaskStatus(status),
    createdAt: metadata?.created_at ? Date.parse(metadata.created_at) || updatedAtMs : updatedAtMs,
    completedAt: status === 'done' ? updatedAtMs : null,
    filePath,
  }
}

function parseTodoFile(filePath: string): TodoListFile | null {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
  const items: TodoListFile['items'] = []
  for (const line of content.split('\n')) {
    const unchecked = line.match(/^\s*-\s+\[\s\]\s+(.+)$/)
    const checked = line.match(/^\s*-\s+\[x\]\s+(.+)$/i)
    if (unchecked) items.push({ text: unchecked[1].trim(), checked: false })
    else if (checked) items.push({ text: checked[1].trim(), checked: true })
  }
  const openCount = items.filter((i) => !i.checked).length
  return { source: path.basename(filePath), openCount, items }
}

export function startArtifactWatcher(deps: ArtifactWatcherDeps): { stop: () => void } {
  const snapshots = new Map<string, ArtifactSnapshot>()
  const todoSnapshots = new Map<string, TodoSnapshot>()
  let lastTasksMtime = 0
  let timer: NodeJS.Timeout | null = null

  function getArtifactsDir(): string | null {
    const cwd = deps.getWorkspacePath()
    if (!cwd) return null
    return path.join(cwd, '.pi', 'artifacts')
  }

  function emit() {
    const win = deps.getMainWindow()
    if (!win || win.isDestroyed()) return
    const payload: ArtifactUpdate = {
      artifacts: [...snapshots.values()]
        .map((s) => s.artifact)
        .sort((a, b) => b.createdAt - a.createdAt),
      todoFiles: [...todoSnapshots.values()]
        .map((s) => s.todoFile)
        .filter((file) => file.openCount > 0)
        .sort((a, b) => a.source.localeCompare(b.source)),
      timestamp: Date.now(),
    }
    win.webContents.send(IPC.ARTIFACT_UPDATE, payload)
  }

  function tick() {
    const dir = getArtifactsDir()
    if (!dir) {
      if (snapshots.size > 0 || todoSnapshots.size > 0) {
        snapshots.clear()
        todoSnapshots.clear()
        emit()
      }
      return
    }

    let dirty = false

    const tasksPath = getTasksFilePath(dir)
    let tasksMtime = 0
    try {
      tasksMtime = fs.statSync(tasksPath).mtimeMs
    } catch {
      tasksMtime = 0
    }

    if (tasksMtime !== lastTasksMtime) {
      lastTasksMtime = tasksMtime
      dirty = true
      const blocks = readTasksFile(dir)
      const nextIds = new Set<string>()
      for (const block of blocks.values()) {
        nextIds.add(block.taskId)
        const artifact = blockToArtifact(
          block.taskId,
          block.status,
          block.body,
          block.updatedAtMs,
          dir
        )
        const prev = snapshots.get(block.taskId)
        if (
          !prev ||
          prev.artifact.status !== artifact.status ||
          prev.artifact.result !== artifact.result
        ) {
          snapshots.set(block.taskId, { artifact })
        }
      }
      for (const id of [...snapshots.keys()]) {
        if (!nextIds.has(id)) {
          snapshots.delete(id)
        }
      }
    }

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const todoNames = new Set(
        entries.filter((e) => e.isFile() && /^TODO.*\.md$/i.test(e.name)).map((e) => e.name)
      )
      for (const name of todoNames) {
        const filePath = path.join(dir, name)
        const todoFile = parseTodoFile(filePath)
        if (!todoFile) continue
        const prev = todoSnapshots.get(name)
        if (!prev || prev.todoFile.openCount !== todoFile.openCount) {
          todoSnapshots.set(name, { todoFile })
          dirty = true
        }
      }
      for (const name of [...todoSnapshots.keys()]) {
        if (!todoNames.has(name)) {
          todoSnapshots.delete(name)
          dirty = true
        }
      }
    } catch {
      // artifacts dir may not exist yet
    }

    if (dirty) emit()
  }

  timer = setInterval(tick, POLL_MS)
  tick()

  return {
    stop: () => {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
