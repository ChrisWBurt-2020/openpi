import type { ClientChannel } from 'ssh2'
import type { SidecarCommand, SidecarMessage } from '../pi/sidecar'
import type { PiWorkerHost } from '../pi/workerHost'
import type { RemoteConnectionManager } from './connectionManager'
import { remoteRunControl } from './runControl'

interface PendingRequest {
  resolve: (response: RpcResponse) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

interface RpcResponse {
  id?: string
  type: 'response'
  command: string
  success: boolean
  data?: unknown
  error?: { message?: string }
}

interface RemotePiHostOptions {
  runnerId: string
  connectionId: string
  workspacePath: string
  manager: RemoteConnectionManager
  onMessage: (message: SidecarMessage) => void
  onCrash: () => void
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function responseError(response: RpcResponse): Error {
  return new Error(response.error?.message ?? `${response.command} was rejected by remote Pi`)
}

/** Strict LF-framed Pi RPC client carried over one authenticated SSH channel. */
export class RemotePiRpcHost implements PiWorkerHost {
  private channel: ClientChannel | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private started: Promise<void> | null = null
  private stopping = false
  private reconnecting = false
  private stdoutBuffer = ''
  private serial = 0

  constructor(private readonly options: RemotePiHostOptions) {}

  start(): void {
    this.stopping = false
    this.started = this.open()
  }

  send(command: SidecarCommand): void {
    void this.dispatch(command).catch((error: unknown) => {
      this.options.onMessage({
        type: 'session_error',
        message: error instanceof Error ? error.message : String(error),
        code: 'remote_pi_command_failed',
      })
    })
  }

  async request<T extends SidecarMessage>(
    command: SidecarCommand & { requestId: string },
    timeoutMs = 60_000
  ): Promise<T> {
    await this.awaitStarted()
    if (command.type === 'start_session') {
      return (await this.startSession(command)) as T
    }
    const response = await this.call(this.toRpc(command), command.requestId, timeoutMs)
    return this.toSidecarResponse(command, response) as T
  }

  async stop(): Promise<void> {
    this.stopping = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Remote Pi worker stopped'))
    }
    this.pending.clear()
    this.channel?.end()
    this.channel = null
  }

  private async open(): Promise<void> {
    const channel = await this.options.manager.openPiRpc(
      this.options.connectionId,
      this.options.workspacePath,
      this.options.runnerId
    )
    this.channel = channel
    channel.on('data', (chunk: Buffer) => this.receive(chunk.toString('utf8')))
    channel.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim()
      if (text)
        this.options.onMessage({
          type: 'output_append',
          line: { level: 'error', text, ts: Date.now() },
        })
    })
    channel.on('close', () => {
      this.channel = null
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout)
        pending.reject(new Error('Remote Pi RPC channel closed'))
      }
      this.pending.clear()
      if (!this.stopping) void this.reconnect()
    })
  }

  /**
   * A connector is disposable: losing the desktop SSH channel must not imply
   * that its supervised Pi child died. Reattach to the same runner id before
   * reporting a disconnected worker. The remote daemon replays its bounded
   * event buffer when the connector returns.
   */
  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.stopping) return
    this.reconnecting = true
    try {
      for (const delayMs of [1_000, 2_000, 5_000]) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        if (this.stopping) return
        try {
          await this.open()
          this.options.onMessage({
            type: 'output_append',
            line: {
              level: 'info',
              text: '[remote pi] reattached to persistent runner',
              ts: Date.now(),
            },
          })
          return
        } catch {
          // The final failure below is deliberately user-facing; intermediate
          // connection races are expected while SSH reconnects.
        }
      }
      this.options.onCrash()
    } finally {
      this.reconnecting = false
    }
  }

  private async awaitStarted(): Promise<void> {
    if (!this.started) this.start()
    await this.started
    if (!this.channel) throw new Error('Remote Pi RPC channel is unavailable')
  }

  private receive(chunk: string): void {
    this.stdoutBuffer += chunk
    const lines = this.stdoutBuffer.split('\n')
    this.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const text = line.endsWith('\r') ? line.slice(0, -1) : line
      if (!text.trim()) continue
      try {
        const message = JSON.parse(text) as RpcResponse | Record<string, unknown>
        if (message.type === 'response') this.handleResponse(message as RpcResponse)
        else {
          const event = asRecord(message)
          const control = remoteRunControl(event)
          if (control) this.options.onMessage({ type: 'run_control', event: control })
          this.options.onMessage({ type: 'session_event', event })
        }
      } catch {
        this.options.onMessage({
          type: 'output_append',
          line: {
            level: 'warn',
            text: `[remote pi] ignored malformed RPC record: ${text.slice(0, 200)}`,
            ts: Date.now(),
          },
        })
      }
    }
  }

  private handleResponse(response: RpcResponse): void {
    if (!response.id) return
    const pending = this.pending.get(response.id)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pending.delete(response.id)
    if (response.success) pending.resolve(response)
    else pending.reject(responseError(response))
  }

  private call(
    command: Record<string, unknown>,
    id: string,
    timeoutMs: number
  ): Promise<RpcResponse> {
    if (!this.channel) return Promise.reject(new Error('Remote Pi RPC channel is unavailable'))
    return new Promise<RpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Remote Pi request timed out: ${String(command.type)}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve,
        reject,
        timeout,
      })
      this.channel?.write(`${JSON.stringify({ ...command, id })}\n`)
    })
  }

  private async dispatch(command: SidecarCommand): Promise<void> {
    await this.awaitStarted()
    if (command.type === 'set_insight_mode') return
    if (command.type === 'stop') return void (await this.stop())
    if (command.type === 'start_session') return
    const requestId = `remote-${++this.serial}`
    if (command.type === 'prompt' && command.intent === 'run' && command.runContext) {
      await this.call(
        { type: 'prompt', message: runContextCommand(command.runContext) },
        `${requestId}-run-context`,
        60_000
      )
    }
    await this.call(this.toRpc(command), requestId, 60_000)
    if (
      command.type === 'prompt' &&
      command.text === '/openpi-run-continue' &&
      command.runContext?.continuationId
    ) {
      this.options.onMessage({
        type: 'run_control',
        event: {
          type: 'continuation_ack',
          context: command.runContext,
          continuationId: command.runContext.continuationId,
        },
      })
    }
  }

  private async startSession(
    command: Extract<SidecarCommand, { type: 'start_session' }>
  ): Promise<SidecarMessage> {
    const requestId = command.requestId ?? `remote-${++this.serial}`
    if (command.sessionFile)
      await this.call(
        { type: 'switch_session', sessionPath: command.sessionFile },
        `${requestId}-switch`,
        60_000
      )
    const response = await this.call({ type: 'get_state' }, requestId, 60_000)
    const state = asRecord(response.data)
    const model = asRecord(state.model)
    return {
      type: 'session_ready',
      requestId,
      payload: {
        cwd: this.options.workspacePath,
        sessionFile: typeof state.sessionFile === 'string' ? state.sessionFile : null,
        sessionId: typeof state.sessionId === 'string' ? state.sessionId : null,
        sessionName: typeof state.sessionName === 'string' ? state.sessionName : null,
        thinkingLevel: typeof state.thinkingLevel === 'string' ? state.thinkingLevel : null,
        model:
          typeof model.id === 'string' &&
          typeof model.name === 'string' &&
          typeof model.provider === 'string'
            ? {
                id: model.id,
                name: model.name,
                provider: model.provider,
                reasoning: Boolean(model.reasoning),
                contextWindow: Number(model.contextWindow) || 0,
              }
            : null,
        access: {
          mode: 'read-write',
          requestedSessionFile: command.sessionFile ?? null,
          reasons: [],
          messages: [],
        },
      },
    }
  }

  private toRpc(command: SidecarCommand): Record<string, unknown> {
    switch (command.type) {
      case 'prompt':
        return {
          type: 'prompt',
          message: command.contextPrefix
            ? `${command.contextPrefix}\n${command.text}`
            : command.text,
        }
      case 'steer':
        return {
          type: 'steer',
          message: command.contextPrefix
            ? `${command.contextPrefix}\n${command.text}`
            : command.text,
        }
      case 'follow_up':
        return {
          type: 'follow_up',
          message: command.contextPrefix
            ? `${command.contextPrefix}\n${command.text}`
            : command.text,
        }
      case 'abort':
        return { type: 'abort' }
      case 'set_model':
        return { type: 'set_model', provider: command.provider, modelId: command.modelId }
      case 'set_thinking':
        return { type: 'set_thinking_level', level: command.level }
      case 'execute_bash':
        return { type: 'bash', command: command.command }
      case 'set_session_name':
        return { type: 'set_session_name', name: command.name }
      case 'compact':
        return { type: 'compact', customInstructions: command.customInstructions }
      case 'get_stats':
        return { type: 'get_state' }
      case 'get_models':
        return { type: 'get_available_models' }
      case 'get_session_info':
        return { type: 'get_state' }
      default:
        throw new Error(`Remote Pi does not support ${command.type} yet`)
    }
  }

  private toSidecarResponse(command: SidecarCommand, response: RpcResponse): SidecarMessage {
    const data = asRecord(response.data)
    switch (command.type) {
      case 'execute_bash':
        return { type: 'bash_result', requestId: command.requestId, result: response.data }
      case 'get_models':
        return {
          type: 'models_result',
          requestId: command.requestId,
          models: Array.isArray(data.models) ? data.models : [],
        }
      case 'get_stats':
        return { type: 'stats_result', requestId: command.requestId, stats: data }
      case 'get_session_info':
        return { type: 'session_info_result', requestId: command.requestId, info: data as never }
      default:
        return { type: 'session_event', event: { type: 'remote_response', data } }
    }
  }
}

function runContextCommand(context: {
  id: string
  epoch: number
  contractVersion: number
  continuationId?: string
}): string {
  return `/openpi-run-context ${Buffer.from(JSON.stringify(context)).toString('base64url')}`
}
