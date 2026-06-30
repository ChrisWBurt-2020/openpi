import { describe, expect, it } from 'vitest'
import { isLocalFilePath } from '../electron/services/workbenchContext'

describe('isLocalFilePath', () => {
  it('accepts macOS/Linux absolute paths', () => {
    expect(isLocalFilePath('/Users/x/file.ts')).toBe(true)
    expect(isLocalFilePath('/var/log/app.log')).toBe(true)
  })

  it('accepts Windows drive-letter paths', () => {
    expect(isLocalFilePath('C:\\Users\\x\\file.ts')).toBe(true)
    expect(isLocalFilePath('D:/code/file.ts')).toBe(true)
  })

  it('rejects virtual URLs and relative paths', () => {
    expect(isLocalFilePath('openpi-diff://review')).toBe(false)
    expect(isLocalFilePath('file:///Users/x')).toBe(false)
    expect(isLocalFilePath('relative/path')).toBe(false)
    expect(isLocalFilePath('')).toBe(false)
  })
})
