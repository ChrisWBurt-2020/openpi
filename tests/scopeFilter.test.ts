import { describe, expect, it } from 'vitest'
import { diffScopeFilter } from '../src/components/git/scopeFilter'
import type { GitChangedFile } from '../src/lib/ipc'

function makeFile(path: string, staged: boolean): GitChangedFile {
  return { path, status: 'M', staged, added: 1, removed: 0 }
}

describe('diffScopeFilter', () => {
  const files = [
    makeFile('a.ts', true),
    makeFile('b.ts', true),
    makeFile('c.ts', false),
    makeFile('d.ts', false),
  ]

  it("returns only unstaged files for 'unstaged' scope", () => {
    const result = diffScopeFilter(files, 'unstaged')
    expect(result).toHaveLength(2)
    expect(result.every((f) => !f.staged)).toBe(true)
  })

  it("returns only staged files for 'staged' scope", () => {
    const result = diffScopeFilter(files, 'staged')
    expect(result).toHaveLength(2)
    expect(result.every((f) => f.staged)).toBe(true)
  })

  it("returns all files for 'branch' scope", () => {
    const result = diffScopeFilter(files, 'branch')
    expect(result).toHaveLength(4)
  })

  it('returns empty array for empty input', () => {
    expect(diffScopeFilter([], 'unstaged')).toEqual([])
    expect(diffScopeFilter([], 'staged')).toEqual([])
    expect(diffScopeFilter([], 'branch')).toEqual([])
  })
})
