/** Main/sidecar protocol for SSH Workspace tool execution. No Electron or SSH
 * objects cross this boundary; all authority remains in Electron main. */
export type WorkspaceOperation = 'read' | 'write' | 'access' | 'stat' | 'readdir' | 'find' | 'bash'

export interface WorkspaceRequest {
  type: 'workspace_request'
  requestId: string
  operation: WorkspaceOperation
  path?: string
  content?: string
  pattern?: string
  cwd?: string
  command?: string
  timeout?: number
}

export interface WorkspaceResult {
  type: 'workspace_result'
  requestId: string
  ok: boolean
  data?: unknown
  error?: string
}

export interface WorkspaceStream {
  type: 'workspace_stream'
  requestId: string
  data: string
}

export interface RemoteWorkspaceDescriptor {
  connectionId: string
  root: string
  virtualCwd: string
}
