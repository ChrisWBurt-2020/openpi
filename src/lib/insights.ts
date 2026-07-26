import { z } from 'zod'

export const insightModeSchema = z.enum(['off', 'critical', 'balanced', 'mentor'])
export type InsightMode = z.infer<typeof insightModeSchema>

export const insightCategorySchema = z.enum([
  'architecture',
  'pattern',
  'tradeoff',
  'risk',
  'debugging',
  'learning',
])
export type InsightCategory = z.infer<typeof insightCategorySchema>

const fileEvidenceSchema = z.object({
  type: z.literal('file'),
  path: z.string().min(1).max(500),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  description: z.string().min(1).max(280).optional(),
})

const commandEvidenceSchema = z.object({
  type: z.literal('command'),
  command: z.string().min(1).max(500),
  description: z.string().min(1).max(280),
})

export const insightEvidenceSchema = z.discriminatedUnion('type', [
  fileEvidenceSchema,
  commandEvidenceSchema,
])
export type InsightEvidence = z.infer<typeof insightEvidenceSchema>

export const insightPayloadSchema = z
  .object({
    category: insightCategorySchema,
    title: z.string().trim().min(3).max(120),
    explanation: z.string().trim().min(8).max(900),
    whyItMatters: z.string().trim().min(8).max(600).optional(),
    evidence: z.array(insightEvidenceSchema).min(1).max(5),
    confidence: z.enum(['low', 'medium', 'high']),
    basis: z.enum(['observed', 'inferred']),
    knowledgeCandidate: z.boolean(),
  })
  .superRefine((value, ctx) => {
    for (const evidence of value.evidence) {
      if (
        evidence.type === 'file' &&
        evidence.endLine &&
        evidence.startLine &&
        evidence.endLine < evidence.startLine
      ) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'endLine must be >= startLine' })
      }
    }
  })
export type InsightPayload = z.infer<typeof insightPayloadSchema>

export const savedInsightSchema = z.intersection(
  insightPayloadSchema,
  z.object({
    id: z.string().min(1),
    workspacePath: z.string().min(1),
    sessionPath: z.string().nullable(),
    toolCallId: z.string().min(1),
    createdAt: z.string(),
  })
)
export type SavedInsight = z.infer<typeof savedInsightSchema>

export const saveInsightRequestSchema = z.object({
  workspacePath: z.string().min(1),
  sessionPath: z.string().nullable(),
  toolCallId: z.string().min(1),
  insight: insightPayloadSchema,
})

export const listSavedInsightsRequestSchema = z.object({ workspacePath: z.string().min(1) })
export const removeSavedInsightRequestSchema = z.object({ id: z.string().min(1) })
export const insightDismissedRequestSchema = z.object({
  sessionPath: z.string().min(1),
  toolCallId: z.string().min(1),
  dismissed: z.boolean(),
})
export const listInsightStateRequestSchema = z.object({ sessionPath: z.string().min(1) })

export function insightFingerprint(insight: InsightPayload): string {
  const evidence = insight.evidence
    .map((item) =>
      item.type === 'file'
        ? `f:${item.path.toLowerCase()}:${item.startLine ?? ''}:${item.endLine ?? ''}`
        : `c:${item.command.toLowerCase()}`
    )
    .join('|')
  return `${insight.category}:${insight.title.trim().toLowerCase()}:${evidence}`
}
