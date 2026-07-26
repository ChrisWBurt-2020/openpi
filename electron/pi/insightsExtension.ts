import type { InlineExtension } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import {
  type InsightMode,
  type InsightPayload,
  insightFingerprint,
  insightPayloadSchema,
} from '../../src/lib/insights'

const MAX_PER_TURN: Record<Exclude<InsightMode, 'off'>, number> = {
  critical: 1,
  balanced: 2,
  mentor: 4,
}

const EVIDENCE = Type.Union([
  Type.Object({
    type: Type.Literal('file'),
    path: Type.String({ minLength: 1, maxLength: 500 }),
    startLine: Type.Optional(Type.Integer({ minimum: 1 })),
    endLine: Type.Optional(Type.Integer({ minimum: 1 })),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 280 })),
  }),
  Type.Object({
    type: Type.Literal('command'),
    command: Type.String({ minLength: 1, maxLength: 500 }),
    description: Type.String({ minLength: 1, maxLength: 280 }),
  }),
])

const INSIGHT_PARAMETERS = Type.Object({
  category: Type.Union([
    Type.Literal('architecture'),
    Type.Literal('pattern'),
    Type.Literal('tradeoff'),
    Type.Literal('risk'),
    Type.Literal('debugging'),
    Type.Literal('learning'),
  ]),
  title: Type.String({ minLength: 3, maxLength: 120 }),
  explanation: Type.String({ minLength: 8, maxLength: 900 }),
  whyItMatters: Type.Optional(Type.String({ minLength: 8, maxLength: 600 })),
  evidence: Type.Array(EVIDENCE, { minItems: 1, maxItems: 5 }),
  confidence: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
  basis: Type.Union([Type.Literal('observed'), Type.Literal('inferred')]),
  knowledgeCandidate: Type.Boolean(),
})

export function insightInstructions(mode: Exclude<InsightMode, 'off'>): string {
  return `
## Pi Signals — ${mode} cadence

Use the emit_insight tool to surface at most ${MAX_PER_TURN[mode]} brief, genuinely useful codebase-specific signals during this user task. Use it only after observing a file, search result, command/test output, or completed edit. Cite the evidence you actually saw, distinguish observed facts from inferences, and explain the practical implication without revealing private chain-of-thought. Prefer architecture, non-obvious patterns, trade-offs, risks, debugging discoveries, and learnings over generic programming advice. Do not repeat an earlier signal. Continue the task immediately after emitting a signal.
`
}

export function restoreInsightFingerprints(entries: unknown[]): Set<string> {
  const restored = new Set<string>()
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const message = (entry as { message?: unknown }).message
    if (!message || typeof message !== 'object') continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const item = part as { type?: unknown; name?: unknown; arguments?: unknown }
      if (item.type !== 'toolCall' || item.name !== 'emit_insight') continue
      const parsed = insightPayloadSchema.safeParse(item.arguments)
      if (parsed.success) restored.add(insightFingerprint(parsed.data))
    }
  }
  return restored
}

export function createInsightsExtension(getMode: () => InsightMode): InlineExtension {
  return {
    name: 'openpi-insights',
    factory: (pi) => {
      let fingerprints = new Set<string>()
      let emittedThisTurn = 0

      pi.on('session_start', (_event, ctx) => {
        fingerprints = restoreInsightFingerprints(ctx.sessionManager.getEntries())
      })
      pi.on('agent_start', () => {
        emittedThisTurn = 0
      })
      pi.on('before_agent_start', (event) => {
        const mode = getMode()
        if (mode === 'off') return
        return { systemPrompt: `${event.systemPrompt}\n${insightInstructions(mode)}` }
      })
      pi.registerTool({
        name: 'emit_insight',
        label: 'Emit Pi Signal',
        description:
          'Record an evidence-backed, user-visible codebase insight without changing files.',
        promptSnippet: 'Emit a concise evidence-backed Pi Signal for a notable codebase discovery.',
        promptGuidelines: [
          'Use emit_insight only for evidence-backed, non-routine codebase discoveries; never use it to expose private reasoning.',
        ],
        parameters: INSIGHT_PARAMETERS,
        async execute(_toolCallId, raw) {
          const mode = getMode()
          const parsed = insightPayloadSchema.safeParse(raw)
          if (!parsed.success || mode === 'off') {
            return { content: [{ type: 'text', text: 'Pi Signal skipped.' }], details: {} }
          }
          const insight: InsightPayload = parsed.data
          const fingerprint = insightFingerprint(insight)
          if (fingerprints.has(fingerprint) || emittedThisTurn >= MAX_PER_TURN[mode]) {
            return {
              content: [{ type: 'text', text: 'Pi Signal skipped as duplicate or over limit.' }],
              details: {},
            }
          }
          fingerprints.add(fingerprint)
          emittedThisTurn += 1
          return { content: [{ type: 'text', text: 'Pi Signal recorded.' }], details: {} }
        },
      })
    },
  }
}
