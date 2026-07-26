import type { SidecarCommand, SidecarMessage } from './sidecar'

/**
 * The concurrency pool only needs a transport-neutral Pi worker. Local workers
 * use Electron utility processes; remote workers use an SSH RPC channel.
 */
export interface PiWorkerHost {
  readonly workerPid?: number
  start(): void | Promise<void>
  send(command: SidecarCommand): void
  request<T extends SidecarMessage>(
    command: SidecarCommand & { requestId: string },
    timeoutMs?: number
  ): Promise<T>
  stop(): Promise<void>
}
