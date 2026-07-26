import { z } from 'zod'

/** Main/sidecar protocol for SSH Workspace tool execution. No Electron or SSH
 * objects cross this boundary; all authority remains in Electron main. */
export const workspaceOperationSchema = z.enum([
  'read',
  'write',
  'access',
  'stat',
  'readdir',
  'find',
  'tree',
  'bash',
])
export type WorkspaceOperation = z.infer<typeof workspaceOperationSchema>

export const workspaceRequestSchema = z
  .object({
    type: z.literal('workspace_request'),
    requestId: z.string().min(1).max(160),
    operation: workspaceOperationSchema,
    path: z.string().min(1).max(16_384).optional(),
    content: z.string().max(8_000_000).optional(),
    pattern: z.string().max(1_000).optional(),
    cwd: z.string().min(1).max(16_384).optional(),
    command: z.string().max(100_000).optional(),
    timeout: z.number().positive().max(3_600).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      ['read', 'write', 'access', 'stat', 'readdir', 'find', 'tree'].includes(value.operation) &&
      !value.path
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Workspace operation requires a path' })
    }
    if (value.operation === 'bash' && !value.command) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Remote bash requires a command' })
    }
  })
export type WorkspaceRequest = z.infer<typeof workspaceRequestSchema>

export const workspaceResultSchema = z.discriminatedUnion('ok', [
  z.object({
    type: z.literal('workspace_result'),
    requestId: z.string().min(1).max(160),
    ok: z.literal(true),
    data: z.unknown(),
  }),
  z.object({
    type: z.literal('workspace_result'),
    requestId: z.string().min(1).max(160),
    ok: z.literal(false),
    error: z.string().min(1).max(2_000),
  }),
])
export type WorkspaceResult = z.infer<typeof workspaceResultSchema>

export const workspaceStreamSchema = z.object({
  type: z.literal('workspace_stream'),
  requestId: z.string().min(1).max(160),
  data: z.string(),
})
export type WorkspaceStream = z.infer<typeof workspaceStreamSchema>

export interface RemoteWorkspaceDescriptor {
  connectionId: string
  root: string
  virtualCwd: string
}
