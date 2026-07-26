import type { ConnectionProfile, ConnectionState, RemoteRuntimeCheck } from '../../src/lib/ipc'

export type { ConnectionState, RemoteRuntimeCheck }

export interface RemoteConnectionSnapshot extends ConnectionProfile {
  state: ConnectionState
}
