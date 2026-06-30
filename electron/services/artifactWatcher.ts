/**
 * Watches `.pi/artifacts/` for TODO.md-style lists and emits
 * `ARTIFACT_UPDATE` when content changes.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import type { ArtifactUpdate, TodoListFile } from '../../src/lib/ipc/_full'
import { IPC } from '../../src/lib/ipc/_full'

const POLL_MS = 2000

interface ArtifactWatcherDeps {
  getMainWindow: () => BrowserWindow | null
  getWorkspacePath: () => string | null
}

interface TodoSnapshot {
  todoFile: TodoListFile
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
  const todoSnapshots = new Map<string, TodoSnapshot>()
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
      artifacts: [],
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
      if (todoSnapshots.size > 0) {
        todoSnapshots.clear()
        emit()
      }
      return
    }

    let dirty = false
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
      if (todoSnapshots.size > 0) {
        todoSnapshots.clear()
        dirty = true
      }
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
