import crypto from 'node:crypto'
import type { GitChangedFile, GitFileDiff, GitStatusResult } from '../../src/lib/ipc'
import type { RemoteConnectionManager } from './connectionManager'
import { parseRemoteWorkspace, remoteVirtualCwd } from './fileTree'

async function command(
  manager: RemoteConnectionManager,
  cwd: string,
  value: string
): Promise<string> {
  const workspace = parseRemoteWorkspace(cwd)
  if (!workspace) throw new Error('Invalid SSH workspace')
  const data = await manager.workspaceOperation(
    workspace.connectionId,
    workspace.root,
    remoteVirtualCwd(workspace.connectionId, workspace.root),
    {
      type: 'workspace_request',
      requestId: crypto.randomUUID(),
      operation: 'bash',
      command: value,
      timeout: 15,
    }
  )
  return typeof data === 'string' ? data : ''
}

export async function remoteGitStatus(
  manager: RemoteConnectionManager,
  cwd: string
): Promise<GitStatusResult | null> {
  const output = await command(manager, cwd, 'git status --porcelain=v1 -z --branch')
  if (!output.startsWith('## ')) return null
  const [head, ...entries] = output.split('\0')
  const branch = head.slice(3).split('...')[0] || 'HEAD'
  const files = entries.flatMap<GitChangedFile>((entry) => {
    if (entry.length < 4) return []
    const code = entry.slice(0, 2)
    const status: GitChangedFile['status'] = code.includes('?')
      ? '?'
      : code.includes('A')
        ? 'A'
        : code.includes('D')
          ? 'D'
          : code.includes('R')
            ? 'R'
            : code.includes('U')
              ? 'U'
              : 'M'
    return [
      {
        path: entry.slice(3),
        status,
        staged: code[0] !== ' ' && code[0] !== '?',
        added: 0,
        removed: 0,
      },
    ]
  })
  return {
    branch,
    upstream: null,
    ahead: 0,
    behind: 0,
    isDetached: branch === 'HEAD',
    hasConflicts: files.some((file) => file.status === 'U'),
    operation: 'none',
    stashCount: 0,
    totalAdded: 0,
    totalRemoved: 0,
    files,
  }
}

export async function remoteGitDiff(
  manager: RemoteConnectionManager,
  cwd: string,
  filePath: string
): Promise<GitFileDiff | null> {
  if (!filePath || filePath.includes('\0')) throw new Error('Invalid Git path')
  const escaped = filePath.replace(/'/g, "'\\''")
  const rawPatch = await command(
    manager,
    cwd,
    `git diff --no-ext-diff -- '${escaped}'; git diff --cached --no-ext-diff -- '${escaped}'`
  )
  if (!rawPatch) return null
  const added = rawPatch
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
  const removed = rawPatch
    .split('\n')
    .filter((line) => line.startsWith('-') && !line.startsWith('---')).length
  return {
    path: filePath,
    rawPatch,
    totalAdded: added,
    totalRemoved: removed,
    isNew: rawPatch.includes('new file mode'),
    isDeleted: rawPatch.includes('deleted file mode'),
  }
}
