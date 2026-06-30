import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { startArtifactWatcher } from '../electron/services/artifactWatcher'
import { IPC } from '../src/lib/ipc/_full'

describe('artifactWatcher', () => {
  it('emits TODO files', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-artifacts-'))
    const artifactsDir = path.join(cwd, '.pi', 'artifacts')
    fs.mkdirSync(artifactsDir, { recursive: true })
    fs.writeFileSync(path.join(artifactsDir, 'TODO.md'), '- [ ] open item\n- [x] done item\n')
    const send = vi.fn()
    const watcher = startArtifactWatcher({
      getMainWindow: () =>
        ({
          isDestroyed: () => false,
          webContents: { send },
        }) as never,
      getWorkspacePath: () => cwd,
    })
    watcher.stop()

    expect(send).toHaveBeenCalledWith(
      IPC.ARTIFACT_UPDATE,
      expect.objectContaining({
        artifacts: [],
        todoFiles: [
          expect.objectContaining({
            source: 'TODO.md',
            openCount: 1,
          }),
        ],
      }),
    )
    fs.rmSync(cwd, { recursive: true, force: true })
  })
})
