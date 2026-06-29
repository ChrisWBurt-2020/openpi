import { describe, expect, it } from 'vitest'
import {
  extractResultSection,
  parseMetadataFromBody,
  parseTaskBlocks,
} from '../electron/services/piTaskArtifacts'

describe('pi-task TASKS.md parsing', () => {
  it('parses ### blocks and status lines', () => {
    const content = `### abc123
status: active | updated: 2026-06-01T00:00:00.000Z

#### Metadata

\`\`\`json
{"agent_type":"scout","conversation_id":"research-ai"}
\`\`\`

#### Result

done
`
    const blocks = parseTaskBlocks(content)
    expect(blocks.size).toBe(1)
    const block = blocks.get('abc123')
    expect(block?.status).toBe('active')
    expect(block?.updatedAtMs).toBe(Date.parse('2026-06-01T00:00:00.000Z'))
  })

  it('parses status before pipe on combined status line', () => {
    const content = `### done1
status: done | updated: 2026-06-02T00:00:00.000Z

#### Result

ok
`
    const block = parseTaskBlocks(content).get('done1')
    expect(block?.status).toBe('done')
  })

  it('extracts metadata and result', () => {
    const body = `#### Metadata

\`\`\`json
{"agent_type":"worker","last_prompt":"Find auth flow"}
\`\`\`

#### Result

Auth is in src/auth.ts
`
    const meta = parseMetadataFromBody(body)
    expect(meta?.agent_type).toBe('worker')
    expect(meta?.last_prompt).toBe('Find auth flow')
    expect(extractResultSection(body)).toContain('src/auth.ts')
  })
})
