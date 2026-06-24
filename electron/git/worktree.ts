/**
 * worktree.ts — Git worktree creation and cleanup for OpenPi.
 *
 * Every function creates its own simple-git instance; no shared state.
 * All paths are resolved from the repository root (the "parent" repo).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import simpleGit from 'simple-git'

export interface WorktreeOptions {
  /** Full path to the repository root. */
  repoPath: string
  /** Branch or commit to base the worktree on (default: HEAD). */
  baseBranch: string
  /** Full path where the worktree will be created. */
  worktreePath: string
}

/**
 * Create a detached Git worktree.
 *
 * Uses `git worktree add --detach <worktreePath> <baseBranch>`.
 * Creates the parent directory if it doesn't exist.
 *
 * @throws if the repo is not a Git repo, the branch doesn't exist,
 *         or the worktree path already exists.
 */
export async function createWorktree(options: WorktreeOptions): Promise<void> {
  const { repoPath, baseBranch, worktreePath } = options

  // Ensure parent dir exists
  const parentDir = path.dirname(worktreePath)
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true })
  }

  const git = simpleGit({ baseDir: repoPath })
  await git.raw(['worktree', 'add', '--detach', worktreePath, baseBranch])
}

/**
 * Remove a Git worktree.
 *
 * Uses `git worktree remove --force <worktreePath>`.
 * Errors silently if the worktree path doesn't exist or isn't a worktree.
 */
export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  try {
    const git = simpleGit({ baseDir: repoPath })
    await git.raw(['worktree', 'remove', '--force', worktreePath])
  } catch {
    // Worktree already removed or never existed — ignore.
  }
}

/**
 * List all Git worktrees for a repo, returning their paths.
 */
export async function listWorktreePaths(repoPath: string): Promise<string[]> {
  const git = simpleGit({ baseDir: repoPath })
  const output = await git.raw(['worktree', 'list', '--porcelain'])
  const paths: string[] = []
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      paths.push(line.slice('worktree '.length).trim())
    }
  }
  return paths
}

/**
 * Check whether a directory is a valid Git worktree (has a `.git` file pointing
 * to the repo's `.git` directory, or is the main worktree with a `.git` dir).
 */
export function isWorktree(dir: string): boolean {
  const gitPath = path.join(dir, '.git')
  if (!fs.existsSync(gitPath)) return false
  // Main worktree has a directory `.git`; linked worktrees have a file `.git`
  return fs.statSync(gitPath).isDirectory() || fs.statSync(gitPath).isFile()
}

/** Get the default directory where OpenPi stores managed worktrees. */
export function getWorktreeStoreDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  return path.join(home, '.openpi', 'worktrees')
}

/** Generate a unique worktree path for a thread. */
export function generateWorktreePath(repoRoot: string, threadId: string): string {
  const storeDir = getWorktreeStoreDir()
  const repoName = path.basename(repoRoot)
  return path.join(storeDir, `${repoName}-${threadId}`)
}

/** Get the current branch name of a repository. Returns 'HEAD' if detached. */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  const git = simpleGit({ baseDir: repoPath })
  try {
    const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
    return branch === 'HEAD' ? 'HEAD' : branch
  } catch {
    return 'HEAD'
  }
}
