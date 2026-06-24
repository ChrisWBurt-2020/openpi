import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import simpleGit from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getGitFileDiff } from '../electron/git/gitDiffStatus'

/**
 * Integration tests for scope-aware per-file diff loading.
 *
 * The scope switcher in the Git Changes panel filters the file list by
 * unstaged / staged / branch, but clicking a file should also fetch the
 * diff *for that scope* (not always the unstaged diff). These tests
 * verify that getGitFileDiff respects the scope parameter.
 */
describe('getGitFileDiff scope parameter (integration)', () => {
  let tmpDir: string
  let cwd: string

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-scope-diff-'))
    cwd = tmpDir

    const git = simpleGit({ baseDir: cwd })
    await git.init()
    await git.addConfig('user.email', 'test@example.com')
    await git.addConfig('user.name', 'Test User')
    try {
      await git.branch(['-M', 'main'])
    } catch {
      /* not all git versions support this */
    }

    // File: 3 lines, "original line 2" on the middle line
    const filePath = path.join(cwd, 'src', 'foo.ts')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(
      filePath,
      ['line 1', 'original line 2', 'line 3', ''].join('\n'),
      'utf-8'
    )
    await git.add('src/foo.ts')
    await git.commit('initial')
  })

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('unstaged scope: returns working-tree vs index', async () => {
    const filePath = path.join(cwd, 'src', 'foo.ts')
    // Make an unstaged change (NOT staged)
    fs.writeFileSync(
      filePath,
      ['line 1', 'UNSTAGED line 2', 'line 3', ''].join('\n'),
      'utf-8'
    )

    const diff = await getGitFileDiff(cwd, 'src/foo.ts', { scope: 'unstaged' })
    expect(diff.rawPatch).toContain('original line 2')
    expect(diff.rawPatch).toContain('UNSTAGED line 2')
    // newContent is the working tree (unstaged version)
    expect(diff.newContent).toContain('UNSTAGED line 2')
    expect(diff.newContent).not.toContain('original line 2')
  })

  it('staged scope: returns index vs HEAD', async () => {
    const filePath = path.join(cwd, 'src', 'foo.ts')
    // Make a staged change
    fs.writeFileSync(
      filePath,
      ['line 1', 'STAGED line 2', 'line 3', ''].join('\n'),
      'utf-8'
    )
    const git = simpleGit({ baseDir: cwd })
    await git.add('src/foo.ts')
    // Now also add an unstaged change on top
    fs.writeFileSync(
      filePath,
      ['line 1', 'STAGED line 2', 'unstaged line 3', ''].join('\n'),
      'utf-8'
    )

    const diff = await getGitFileDiff(cwd, 'src/foo.ts', { scope: 'staged' })
    // The staged diff should show STAGED vs original, NOT the working tree
    expect(diff.rawPatch).toContain('original line 2')
    expect(diff.rawPatch).toContain('STAGED line 2')
    // Should NOT include the unstaged change
    expect(diff.rawPatch).not.toContain('unstaged line 3')
    // newContent is from the index (staged version)
    expect(diff.newContent).toContain('STAGED line 2')
    expect(diff.newContent).toContain('line 3') // not "unstaged line 3"
  })

  it('branch scope: returns working tree vs base branch', async () => {
    const filePath = path.join(cwd, 'src', 'foo.ts')
    // Create a feature branch with a change
    const git = simpleGit({ baseDir: cwd })
    await git.checkoutLocalBranch('feature')
    fs.writeFileSync(
      filePath,
      ['line 1', 'FEATURE line 2', 'line 3', ''].join('\n'),
      'utf-8'
    )
    await git.add('src/foo.ts')
    await git.commit('feature change')

    const diff = await getGitFileDiff(cwd, 'src/foo.ts', {
      scope: 'branch',
      baseBranch: 'main',
    })
    expect(diff.rawPatch).toContain('original line 2')
    expect(diff.rawPatch).toContain('FEATURE line 2')
    // newContent is the working tree (feature branch version)
    expect(diff.newContent).toContain('FEATURE line 2')
    expect(diff.newContent).not.toContain('original line 2')
  })

  it('auto scope (default): falls back to staged when unstaged is empty', async () => {
    const filePath = path.join(cwd, 'src', 'foo.ts')
    // Make a staged-only change (no unstaged)
    fs.writeFileSync(
      filePath,
      ['line 1', 'STAGED ONLY line 2', 'line 3', ''].join('\n'),
      'utf-8'
    )
    const git = simpleGit({ baseDir: cwd })
    await git.add('src/foo.ts')

    const diff = await getGitFileDiff(cwd, 'src/foo.ts') // no scope = auto
    expect(diff.rawPatch).toContain('STAGED ONLY line 2')
  })

  it('unstaged scope with no changes returns empty diff', async () => {
    // No changes at all
    const diff = await getGitFileDiff(cwd, 'src/foo.ts', { scope: 'unstaged' })
    expect(diff.rawPatch).toBe('')
    expect(diff.totalAdded).toBe(0)
    expect(diff.totalRemoved).toBe(0)
  })

  it('staged scope with no staged changes returns empty diff', async () => {
    // Only unstaged change
    const filePath = path.join(cwd, 'src', 'foo.ts')
    fs.writeFileSync(
      filePath,
      ['line 1', 'UNSTAGED line 2', 'line 3', ''].join('\n'),
      'utf-8'
    )

    const diff = await getGitFileDiff(cwd, 'src/foo.ts', { scope: 'staged' })
    expect(diff.rawPatch).toBe('')
    expect(diff.totalAdded).toBe(0)
  })
})
