import { describe, expect, it } from 'vitest'
import { ThreadCwdRegistry } from '../electron/session/threadCwd'

describe('ThreadCwdRegistry', () => {
  it('returns root when no worktree path is set', () => {
    const r = new ThreadCwdRegistry()
    r.register('t1', { root: '/project' })
    r.setActive('t1')
    expect(r.resolve()).toBe('/project')
  })

  it('returns worktree path when set', () => {
    const r = new ThreadCwdRegistry()
    r.register('t1', { root: '/project', worktreePath: '/project/.worktrees/feature' })
    r.setActive('t1')
    expect(r.resolve()).toBe('/project/.worktrees/feature')
  })

  it('resolveRoot always returns project root', () => {
    const r = new ThreadCwdRegistry()
    r.register('t1', { root: '/project', worktreePath: '/project/.worktrees/feature' })
    r.setActive('t1')
    expect(r.resolveRoot()).toBe('/project')
  })

  it('resolveSafe returns null instead of throwing', () => {
    const r = new ThreadCwdRegistry()
    expect(r.resolveSafe()).toBeNull()
    expect(r.resolveSafe('nonexistent')).toBeNull()
  })

  it('throws on resolve with no active thread and no threadId', () => {
    const r = new ThreadCwdRegistry()
    expect(() => r.resolve()).toThrow('no active thread')
  })

  it('throws on resolve with unknown threadId', () => {
    const r = new ThreadCwdRegistry()
    expect(() => r.resolve('ghost')).toThrow('no entry for thread "ghost"')
  })

  it('supports multiple threads independently', () => {
    const r = new ThreadCwdRegistry()
    r.register('t1', { root: '/a' })
    r.register('t2', { root: '/b' })
    expect(r.resolve('t1')).toBe('/a')
    expect(r.resolve('t2')).toBe('/b')
  })

  it('active thread resolves without explicit threadId', () => {
    const r = new ThreadCwdRegistry()
    r.register('t1', { root: '/project' })
    r.setActive('t1')
    expect(r.resolve()).toBe('/project')
    r.setActive('t2')
    expect(() => r.resolve()).toThrow('no entry')
  })

  it('unregister removes thread and clears active if match', () => {
    const r = new ThreadCwdRegistry()
    r.register('t1', { root: '/a' })
    r.setActive('t1')
    r.unregister('t1')
    expect(r.getActive()).toBeNull()
    expect(r.has('t1')).toBe(false)
    expect(() => r.resolve()).toThrow('no active thread')
  })

  it('unregister does not clear active for a different thread', () => {
    const r = new ThreadCwdRegistry()
    r.register('t1', { root: '/a' })
    r.register('t2', { root: '/b' })
    r.setActive('t1')
    r.unregister('t2')
    expect(r.getActive()).toBe('t1')
    expect(r.resolve()).toBe('/a')
  })

  it('update overwrites existing fields', () => {
    const r = new ThreadCwdRegistry()
    r.register('t1', { root: '/project' })
    r.update('t1', { worktreePath: '/project/.wt' })
    expect(r.resolve('t1')).toBe('/project/.wt')
  })

  it('update creates new entry when missing if root is provided', () => {
    const r = new ThreadCwdRegistry()
    r.update('t1', { root: '/project' })
    expect(r.resolve('t1')).toBe('/project')
  })

  it('update throws on missing thread without root', () => {
    const r = new ThreadCwdRegistry()
    expect(() => r.update('t1', { worktreePath: '/x' })).toThrow(/ThreadCwdRegistry\.update/)
  })

  it('clearActive unsets active thread', () => {
    const r = new ThreadCwdRegistry()
    r.register('t1', { root: '/a' })
    r.setActive('t1')
    r.clearActive()
    expect(r.getActive()).toBeNull()
  })

  it('size reports registration count', () => {
    const r = new ThreadCwdRegistry()
    expect(r.size).toBe(0)
    r.register('t1', { root: '/a' })
    expect(r.size).toBe(1)
    r.register('t2', { root: '/b' })
    expect(r.size).toBe(2)
    r.unregister('t1')
    expect(r.size).toBe(1)
  })

  it('get returns undefined for unknown thread', () => {
    const r = new ThreadCwdRegistry()
    expect(r.get('ghost')).toBeUndefined()
  })

  it('get returns the raw entry', () => {
    const r = new ThreadCwdRegistry()
    r.register('t1', { root: '/p', worktreePath: '/p/wt' })
    const entry = r.get('t1')
    expect(entry).toBeDefined()
    expect(entry!.root).toBe('/p')
    expect(entry!.worktreePath).toBe('/p/wt')
  })
})
