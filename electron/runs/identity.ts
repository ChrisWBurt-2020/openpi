import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function gitCommonDir(workspacePath: string): string | null {
  try {
    const value = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: workspacePath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim()
    return value ? path.resolve(workspacePath, value) : null
  } catch {
    return null
  }
}

/** Stable ownership key: different hosts never collide even when their paths do. */
export function checkoutIdentity(workspacePath: string): string {
  if (workspacePath.startsWith('ssh://')) return workspacePath
  let canonical = workspacePath
  try {
    canonical = fs.realpathSync.native(workspacePath)
  } catch {
    canonical = path.resolve(workspacePath)
  }
  const commonDir = gitCommonDir(canonical)
  return commonDir ? `local-git:${commonDir}` : `local:${canonical}`
}
