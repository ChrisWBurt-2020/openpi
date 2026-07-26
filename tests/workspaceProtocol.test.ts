import { describe, expect, it } from 'vitest'
import { workspaceCandidate } from '../electron/remote/workspacePath'
import { workspaceRequestSchema, workspaceResultSchema } from '../electron/remote/workspaceProtocol'

describe('SSH workspace protocol validation', () => {
  it('requires a path for filesystem operations', () => {
    expect(
      workspaceRequestSchema.safeParse({
        type: 'workspace_request',
        requestId: 'request-1',
        operation: 'read',
      }).success
    ).toBe(false)
  })

  it('requires a command for bash operations', () => {
    expect(
      workspaceRequestSchema.safeParse({
        type: 'workspace_request',
        requestId: 'request-2',
        operation: 'bash',
      }).success
    ).toBe(false)
  })

  it('accepts only discriminated success or failure responses', () => {
    expect(
      workspaceResultSchema.safeParse({
        type: 'workspace_result',
        requestId: 'request-3',
        ok: true,
        data: { isDirectory: true },
      }).success
    ).toBe(true)
    expect(
      workspaceResultSchema.safeParse({
        type: 'workspace_result',
        requestId: 'request-4',
        ok: false,
      }).success
    ).toBe(false)
  })

  it('maps a virtual path inside the selected remote root without SFTP', () => {
    expect(
      workspaceCandidate(
        '/home/debian/501-scorer',
        'C:\\virtual\\501-scorer',
        'C:\\virtual\\501-scorer\\src\\app.ts'
      )
    ).toBe('/home/debian/501-scorer/src/app.ts')
  })

  it('accepts a remote absolute path displayed in the SSH workspace prompt', () => {
    expect(
      workspaceCandidate(
        '/home/debian/501-scorer',
        'C:\\virtual\\501-scorer',
        '/home/debian/501-scorer/src/app.ts'
      )
    ).toBe('/home/debian/501-scorer/src/app.ts')
  })

  it('rejects a virtual path that escapes the selected remote root', () => {
    expect(() =>
      workspaceCandidate(
        '/home/debian/501-scorer',
        'C:\\virtual\\501-scorer',
        'C:\\virtual\\secrets.txt'
      )
    ).toThrow('escapes its selected root')
  })
})
