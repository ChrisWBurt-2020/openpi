import path from 'node:path'

/**
 * Maps a sidecar-only virtual path to its lexical remote counterpart. The
 * caller must still resolve the result on the remote host before a file
 * operation; shell commands enforce the equivalent realpath boundary in their
 * fixed bootstrap so they never depend on SFTP being available.
 */
export function workspaceCandidate(root: string, virtualCwd: string, value: string): string {
  if (value.includes('\0')) throw new Error('Remote workspace path contains an invalid character')
  if (path.posix.isAbsolute(value)) {
    const candidate = path.posix.normalize(value)
    if (candidate === root || candidate.startsWith(`${root}/`)) return candidate
    throw new Error('Remote workspace path escapes its selected root')
  }
  const relative = path.relative(virtualCwd, value).replace(/\\/g, '/')
  if (!relative || relative === '.') return root
  if (relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) {
    throw new Error('Remote workspace path escapes its selected root')
  }
  const candidate = path.posix.normalize(path.posix.join(root, relative))
  if (!candidate.startsWith('/')) throw new Error('Remote workspace path must be absolute')
  return candidate
}
