import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverCustomizations } from '../electron/services/customizations'

/**
 * Reported: Settings showed "0 available" for every resource type, while
 * ~/.pi/agent held real skills and prompts.
 *
 * discoverCustomizations() returned an empty inventory whenever no workspace
 * was open. But GLOBAL resources live in agentDir and exist regardless of
 * which folder is open — reporting zero of something the user installed is
 * worse than reporting it without project scope.
 */

let agentDir: string

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-agentdir-'))
  const skillDir = path.join(agentDir, 'skills', 'demo-skill')
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    ['---', 'name: demo-skill', 'description: A global skill.', '---', '', 'Body.'].join('\n'),
    'utf-8'
  )
  fs.mkdirSync(path.join(agentDir, 'prompts'), { recursive: true })
  fs.writeFileSync(
    path.join(agentDir, 'prompts', 'demo-prompt.md'),
    ['---', 'description: A global prompt.', '---', '', 'Do the thing.'].join('\n'),
    'utf-8'
  )
})

afterEach(() => {
  try {
    fs.rmSync(agentDir, { recursive: true, force: true })
  } catch {
    /* leave it for the OS */
  }
})

describe('discovering customizations with no workspace open', () => {
  it('MUST still list global skills and prompts', async () => {
    const inventory = await discoverCustomizations({
      cwd: null,
      agentDir,
      workspaceTrusted: false,
    })

    const names = inventory.items.map((i) => i.name)
    expect(names).toContain('demo-skill')
    expect(names).toContain('demo-prompt')
  })

  it('still reports cwd as null, so the UI can say project scope is unavailable', async () => {
    const inventory = await discoverCustomizations({
      cwd: null,
      agentDir,
      workspaceTrusted: false,
    })
    expect(inventory.cwd).toBeNull()
  })

  it('finds the same global resources when a workspace IS open', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-ws-'))
    try {
      const inventory = await discoverCustomizations({
        cwd: workspace,
        agentDir,
        workspaceTrusted: true,
      })
      const names = inventory.items.map((i) => i.name)
      expect(names).toContain('demo-skill')
      expect(names).toContain('demo-prompt')
    } finally {
      try {
        fs.rmSync(workspace, { recursive: true, force: true })
      } catch {
        /* leave it for the OS */
      }
    }
  })
})
