import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import type {
  RemoteWorkspaceDescriptor,
  WorkspaceRequest,
  WorkspaceResult,
  WorkspaceStream,
} from '../remote/workspaceProtocol'
import { workspaceResultSchema, workspaceStreamSchema } from '../remote/workspaceProtocol'

interface TransportClient {
  request(request: Omit<WorkspaceRequest, 'type' | 'requestId'>): Promise<unknown>
  onStream(listener: (message: WorkspaceStream) => void): void
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  throw new Error('Remote workspace returned an invalid text response')
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function isApprovedLocalResource(filePath: string): boolean {
  if (!path.isAbsolute(filePath)) return false
  const resolved = path.resolve(filePath)
  const home = os.homedir()
  const roots = [
    path.join(home, '.pi', 'agent', 'skills'),
    path.join(home, '.pi', 'agent', 'prompts'),
    path.join(home, '.codex', 'skills'),
  ]
  return roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))
}

/**
 * Trusted, first-party extension that replaces Pi's filesystem/shell operations
 * for an SSH Workspace. The operations deliberately have no local fallback.
 */
export function createWorkspaceExtension(
  getWorkspace: () => RemoteWorkspaceDescriptor | null,
  transport: TransportClient
) {
  return (pi: ExtensionAPI): void => {
    // The factory is installed in every local sidecar so trusted global
    // resources stay consistent; it only overrides tools for an SSH session.
    if (!getWorkspace()) return
    const workspace = (): RemoteWorkspaceDescriptor => {
      const value = getWorkspace()
      if (!value) throw new Error('SSH workspace transport is unavailable')
      return value
    }

    const cwd = (): string => workspace().virtualCwd
    const readOps = () => ({
      readFile: async (filePath: string) => {
        if (isApprovedLocalResource(filePath)) return fs.readFile(filePath)
        return Buffer.from(text(await transport.request({ operation: 'read', path: filePath })))
      },
      access: async (filePath: string) => {
        if (isApprovedLocalResource(filePath)) return fs.access(filePath)
        await transport.request({ operation: 'access', path: filePath })
      },
    })
    const writeOps = () => ({
      writeFile: async (filePath: string, content: string) => {
        await transport.request({ operation: 'write', path: filePath, content })
      },
      mkdir: async (directory: string) => {
        await transport.request({
          operation: 'write',
          path: directory,
          content: '',
          pattern: 'mkdir',
        })
      },
    })

    const localRead = createReadTool(cwd())
    const localWrite = createWriteTool(cwd())
    const localEdit = createEditTool(cwd())
    const localBash = createBashTool(cwd())
    const localLs = createLsTool(cwd())
    const localFind = createFindTool(cwd())

    pi.registerTool({
      ...localRead,
      execute: (id, params, signal, onUpdate) =>
        createReadTool(cwd(), { operations: readOps() }).execute(id, params, signal, onUpdate),
    })
    pi.registerTool({
      ...localWrite,
      execute: (id, params, signal, onUpdate) =>
        createWriteTool(cwd(), { operations: writeOps() }).execute(id, params, signal, onUpdate),
    })
    pi.registerTool({
      ...localEdit,
      execute: (id, params, signal, onUpdate) =>
        createEditTool(cwd(), {
          operations: { ...readOps(), ...writeOps() },
        }).execute(id, params, signal, onUpdate),
    })
    pi.registerTool({
      ...localBash,
      execute: (id, params, signal, onUpdate) =>
        createBashTool(cwd(), {
          operations: {
            exec: async (command, operationCwd, options) => {
              const response = await transport.request({
                operation: 'bash',
                command,
                cwd: operationCwd,
                timeout: options.timeout,
              })
              const result = record(response)
              if (typeof result.output === 'string' && result.output) {
                options.onData(Buffer.from(result.output))
              }
              return { exitCode: typeof result.exitCode === 'number' ? result.exitCode : null }
            },
          },
        }).execute(id, params, signal, onUpdate),
    })
    pi.registerTool({
      ...localLs,
      execute: (id, params, signal, onUpdate) =>
        createLsTool(cwd(), {
          operations: {
            exists: (filePath) =>
              transport
                .request({ operation: 'access', path: filePath })
                .then(() => true)
                .catch(() => false),
            stat: async (filePath) => {
              const result = record(await transport.request({ operation: 'stat', path: filePath }))
              const directory = result.isDirectory === true
              return { isDirectory: () => directory }
            },
            readdir: async (directory) => {
              const value = await transport.request({ operation: 'readdir', path: directory })
              return Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string')
                : []
            },
          },
        }).execute(id, params, signal, onUpdate),
    })
    pi.registerTool({
      ...localFind,
      execute: (id, params, signal, onUpdate) =>
        createFindTool(cwd(), {
          operations: {
            exists: (filePath) =>
              transport
                .request({ operation: 'access', path: filePath })
                .then(() => true)
                .catch(() => false),
            glob: async (pattern, searchCwd) => {
              const value = await transport.request({ operation: 'find', path: searchCwd, pattern })
              return Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string')
                : []
            },
          },
        }).execute(id, params, signal, onUpdate),
    })

    pi.on('before_agent_start', (event) => {
      const current = workspace()
      const original = `Current working directory: ${current.virtualCwd}`
      const remote = `Current working directory: ${current.root} (SSH workspace; tools execute on the remote host)`
      return {
        systemPrompt: event.systemPrompt.includes(original)
          ? event.systemPrompt.replace(original, remote)
          : `${event.systemPrompt}\n\n${remote}`,
      }
    })
  }
}

export class WorkspaceTransportClient {
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }
  >()
  private readonly listeners = new Set<(message: WorkspaceStream) => void>()
  private serial = 0

  constructor(private readonly send: (message: WorkspaceRequest) => void) {}

  request(request: Omit<WorkspaceRequest, 'type' | 'requestId'>): Promise<unknown> {
    const requestId = `workspace-${++this.serial}`
    return new Promise((resolve, reject) => {
      const timeoutMs =
        request.operation === 'bash' && typeof request.timeout === 'number'
          ? (request.timeout + 5) * 1_000
          : 15_000
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(
          new Error(`SSH workspace ${request.operation} timed out after ${timeoutMs / 1_000}s`)
        )
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timeout })
      this.send({ ...request, type: 'workspace_request', requestId })
    })
  }

  onStream(listener: (message: WorkspaceStream) => void): void {
    this.listeners.add(listener)
  }

  receive(message: WorkspaceResult | WorkspaceStream): void {
    const stream = workspaceStreamSchema.safeParse(message)
    if (stream.success) {
      for (const listener of this.listeners) listener(stream.data)
      return
    }
    const result = workspaceResultSchema.safeParse(message)
    if (!result.success) return
    const pending = this.pending.get(result.data.requestId)
    if (!pending) return
    this.pending.delete(result.data.requestId)
    clearTimeout(pending.timeout)
    if (result.data.ok) pending.resolve(result.data.data)
    else pending.reject(new Error(result.data.error))
  }

  rejectAll(reason: string): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(reason))
      this.pending.delete(requestId)
    }
  }
}
