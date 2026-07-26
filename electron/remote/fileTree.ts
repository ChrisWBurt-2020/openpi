import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { FileTreeNode, FileTreeResult } from '../../src/lib/ipc'
import type { RemoteConnectionManager } from './connectionManager'

const IGNORED = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.cache',
  'coverage',
])
const MAX_NODES = 5_000

export interface RemoteWorkspaceLocation {
  connectionId: string
  root: string
}

export function remoteVirtualCwd(connectionId: string, root = '/'): string {
  const rootKey = createHash('sha256').update(root).digest('hex').slice(0, 16)
  return path.join(os.tmpdir(), 'openpi-file-tree', connectionId, rootKey)
}

export function parseRemoteWorkspace(cwd: string): RemoteWorkspaceLocation | null {
  try {
    const location = new URL(cwd)
    if (location.protocol !== 'ssh:' || !location.hostname) return null
    return { connectionId: location.hostname, root: decodeURIComponent(location.pathname) }
  } catch {
    return null
  }
}

function insertFile(children: FileTreeNode[], segments: string[], prefix = ''): void {
  const [name, ...rest] = segments
  if (!name) return
  const nodePath = prefix ? `${prefix}/${name}` : name
  if (rest.length === 0) {
    children.push({ name, path: nodePath, isDir: false })
    return
  }
  let directory = children.find((node) => node.isDir && node.name === name)
  if (!directory) {
    directory = { name, path: nodePath, isDir: true, children: [] }
    children.push(directory)
  }
  insertFile(directory.children ?? [], rest, nodePath)
}

function sortTree(nodes: FileTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  for (const node of nodes) if (node.children) sortTree(node.children)
}

export async function getRemoteFileTree(
  manager: RemoteConnectionManager,
  location: RemoteWorkspaceLocation
): Promise<FileTreeResult> {
  const virtualCwd = remoteVirtualCwd(location.connectionId, location.root)
  const result = await manager.workspaceOperation(
    location.connectionId,
    location.root,
    virtualCwd,
    {
      type: 'workspace_request',
      requestId: crypto.randomUUID(),
      operation: 'tree',
      path: virtualCwd,
      pattern: '*',
    }
  )
  const children: FileTreeNode[] = []
  const files = Array.isArray(result) ? result : []
  for (const value of files.slice(0, MAX_NODES)) {
    if (typeof value !== 'string') continue
    const relative = path.relative(virtualCwd, value).replace(/\\/g, '/')
    const segments = relative.split('/').filter(Boolean)
    if (segments.some((segment) => IGNORED.has(segment))) continue
    insertFile(children, segments)
  }
  sortTree(children)
  return { rootName: path.posix.basename(location.root), children }
}
