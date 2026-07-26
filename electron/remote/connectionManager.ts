import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { safeStorage } from 'electron'
import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2'
import type {
  ConnectionDraft,
  ConnectionProfile,
  ConnectionStatus,
  ConnectionTestResult,
  RemoteDirectory,
} from '../../src/lib/ipc'
import { recordDiagnostic, recordDiagnosticError } from '../services/diagnostics'
import type { SessionIndexStore } from '../session/sessionIndex'
import { providerEnvironment, sshConfig } from './auth'
import { RUNNER_CONNECTOR, RUNNER_DAEMON } from './runnerAssets'
import type { ConnectionState } from './types'
import { workspaceCandidate } from './workspacePath'
import type { WorkspaceRequest } from './workspaceProtocol'

const CONNECTION_TIMEOUT_MS = 15_000

interface LiveConnection {
  client: Client
  state: ConnectionState
  sftp: SFTPWrapper | null
  openingSftp: Promise<SFTPWrapper> | null
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
}

function normalizeRemotePath(value: string): string {
  if (value.includes('\0')) throw new Error('Remote path contains an invalid character')
  const normalized = path.posix.normalize(value)
  if (!normalized.startsWith('/')) throw new Error('Remote paths must be absolute')
  return normalized
}

function profileKey(
  profile: Pick<ConnectionProfile, 'host' | 'username' | 'port' | 'identityFile'>
): string {
  return `${profile.username.toLowerCase()}@${profile.host.toLowerCase()}:${profile.port}:${profile.identityFile ?? ''}`
}

export class RemoteConnectionManager {
  private readonly live = new Map<string, LiveConnection>()
  private readonly listeners = new Set<(state: ConnectionState) => void>()
  private readonly observedFingerprints = new Map<string, string>()

  constructor(private readonly store: SessionIndexStore) {}

  list(): ConnectionProfile[] {
    const unique = new Map<string, ConnectionProfile>()
    for (const profile of this.store.listRemoteConnections()) {
      const key = profileKey(profile)
      if (!unique.has(key)) unique.set(key, profile)
    }
    return [...unique.values()].map((profile) => this.withState(profile))
  }

  create(draft: ConnectionDraft): ConnectionProfile {
    const existing = this.store.listRemoteConnections().find(
      (profile) =>
        profileKey(profile) ===
        profileKey({
          host: draft.host.trim(),
          username: draft.username.trim(),
          port: draft.port,
          identityFile: draft.identityFile?.trim() || null,
        })
    )
    if (existing) return this.update(existing.id, draft)
    const profile: ConnectionProfile = {
      id: randomUUID(),
      label: draft.label.trim(),
      host: draft.host.trim(),
      username: draft.username.trim(),
      port: draft.port,
      identityFile: draft.identityFile?.trim() || null,
      hostKeyFingerprint: draft.hostKeyFingerprint?.trim() || null,
      status: 'disconnected',
      latencyMs: null,
      lastConnectedAt: null,
      lastError: null,
    }
    this.store.saveRemoteConnection(profile)
    return profile
  }

  update(id: string, draft: ConnectionDraft): ConnectionProfile {
    const existing = this.requireProfile(id)
    const profile: ConnectionProfile = {
      ...existing,
      ...draft,
      id,
      label: draft.label.trim(),
      host: draft.host.trim(),
      username: draft.username.trim(),
      identityFile: draft.identityFile?.trim() || null,
      hostKeyFingerprint: draft.hostKeyFingerprint?.trim() || null,
    }
    void this.disconnect(id)
    this.store.saveRemoteConnection(profile)
    return this.withState(profile)
  }

  async remove(id: string): Promise<void> {
    await this.disconnect(id)
    this.store.removeRemoteConnection(id)
  }

  onState(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async test(id: string): Promise<ConnectionTestResult> {
    const profile = this.requireProfile(id)
    if (!profile.hostKeyFingerprint) {
      const fingerprint = await this.probeFingerprint(profile)
      return {
        ok: false,
        status: 'disconnected',
        fingerprint,
        homePath: null,
        message: 'Review and trust this SSH host fingerprint before OpenPi connects.',
        checks: { linux: false, sftp: false, nodeVersion: null, piVersion: null },
      }
    }
    try {
      const client = await this.connect(id)
      const [homePath, os, nodeVersion, piVersion, sftp] = await Promise.all([
        this.exec(client, 'printf %s "$HOME"'),
        this.exec(client, 'uname -s'),
        this.exec(client, 'node --version').catch(() => ''),
        this.exec(
          client,
          'if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi; "$HOME/.openpi/runtime/0.82.1/node_modules/.bin/pi" --version'
        ).catch(() => ''),
        this.openSftp(id, client)
          .then(() => true)
          .catch(() => false),
      ])
      const state = this.getState(id)
      return {
        ok: os.trim() === 'Linux' && sftp,
        status: state.status,
        fingerprint:
          this.observedFingerprints.get(id) ?? this.requireProfile(id).hostKeyFingerprint,
        homePath: homePath.trim() || null,
        message: os.trim() === 'Linux' ? null : 'This host is not Linux.',
        checks: {
          linux: os.trim() === 'Linux',
          sftp,
          nodeVersion: nodeVersion.trim() || null,
          piVersion: piVersion.trim() || null,
        },
      }
    } catch (error) {
      const state = this.getState(id)
      return {
        ok: false,
        status: state.status,
        fingerprint:
          this.observedFingerprints.get(id) ?? this.requireProfile(id).hostKeyFingerprint,
        homePath: null,
        message: messageForError(error),
        checks: { linux: false, sftp: false, nodeVersion: null, piVersion: null },
      }
    }
  }

  private probeFingerprint(profile: ConnectionProfile): Promise<string> {
    return new Promise((resolve, reject) => {
      let observed: string | null = null
      const client = new Client()
      const timeout = setTimeout(() => {
        client.end()
        reject(new Error('SSH host fingerprint probe timed out'))
      }, CONNECTION_TIMEOUT_MS)
      client.once('ready', () => {
        clearTimeout(timeout)
        client.end()
        if (observed) resolve(observed)
        else reject(new Error('SSH host did not present a fingerprint'))
      })
      client.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      try {
        client.connect(
          sshConfig(
            profile,
            (value) => (observed = value),
            () => true
          )
        )
      } catch (error) {
        clearTimeout(timeout)
        reject(error)
      }
    })
  }

  async listDirectories(id: string, targetPath?: string): Promise<RemoteDirectory[]> {
    const client = await this.connect(id)
    const home = targetPath
      ? normalizeRemotePath(targetPath)
      : (await this.exec(client, 'printf %s "$HOME"')).trim()
    const sftp = await this.openSftp(id, client)
    const entries = await new Promise<Array<{ filename: string; attrs: { mode?: number } }>>(
      (resolve, reject) =>
        sftp.readdir(home, (error, files) => (error ? reject(error) : resolve(files)))
    )
    return entries
      .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
      .map((entry) => {
        const entryPath = path.posix.join(home, entry.filename)
        return {
          name: entry.filename,
          path: entryPath,
          isDirectory: Boolean(entry.attrs.mode && (entry.attrs.mode & 0o170000) === 0o040000),
          isGitRepository: false,
        }
      })
      .filter((entry) => entry.isDirectory)
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  async resolveProjectPath(id: string, targetPath: string): Promise<string> {
    const client = await this.connect(id)
    const requested = normalizeRemotePath(targetPath)
    const sftp = await this.openSftp(id, client)
    return new Promise<string>((resolve, reject) =>
      sftp.realpath(requested, (error, resolved) => {
        if (error) return reject(new Error(`Remote directory is inaccessible: ${error.message}`))
        if (!resolved?.startsWith('/')) return reject(new Error('Remote directory is invalid'))
        resolve(normalizeRemotePath(resolved))
      })
    )
  }

  async openPiRpc(
    connectionId: string,
    workspacePath: string,
    runnerId = `runner-${randomUUID()}`
  ): Promise<ClientChannel> {
    const client = await this.connect(connectionId)
    const workspace = await this.resolveProjectPath(connectionId, workspacePath)
    const env = providerEnvironment(this.store, connectionId)
    await this.ensureRunnerDaemon(client)
    return new Promise<ClientChannel>((resolve, reject) => {
      // Both command and quoting are static. The chosen path and credentials travel
      // in SSH environment requests, never in a shell string, process arguments, or logs.
      client.exec(
        'if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi; exec node "$HOME/.openpi/runtime/0.82.1/runner-connect.mjs"',
        {
          env: { ...env, OPENPI_WORKSPACE: workspace, OPENPI_RUNNER_ID: runnerId },
        },
        (error, channel) => (error ? reject(error) : resolve(channel))
      )
    })
  }

  /** Execute a validated SSH Workspace operation on the existing multiplexed connection. */
  async workspaceOperation(
    connectionId: string,
    root: string,
    virtualCwd: string,
    request: WorkspaceRequest
  ): Promise<unknown> {
    const client = await this.connect(connectionId)
    const startedAt = Date.now()
    recordDiagnostic({
      level: 'debug',
      area: 'ssh-workspace',
      action: 'operation_started',
      message: request.operation,
      correlationId: request.requestId,
      data: { connectionId, operation: request.operation, hasPath: Boolean(request.path) },
    })
    let sftp: SFTPWrapper | null = null
    const requireSftp = async (): Promise<SFTPWrapper> => {
      if (sftp) return sftp
      sftp = await this.openSftp(connectionId, client)
      return sftp
    }
    const toRemote = async (value: string, write = false): Promise<string> => {
      const candidate = workspaceCandidate(root, virtualCwd, value)
      const activeSftp = await requireSftp()
      const checkPath = write ? path.posix.dirname(candidate) : candidate
      const resolved = write
        ? await this.sftpNearestExistingParent(activeSftp, checkPath)
        : await this.sftpRealpath(activeSftp, checkPath)
      if (resolved !== root && !resolved.startsWith(`${root}/`)) {
        throw new Error('Remote workspace path resolves outside its selected root')
      }
      return candidate
    }

    try {
      return await this.withWorkspaceDeadline(connectionId, client, request, async () => {
        switch (request.operation) {
          case 'read': {
            const target = await toRemote(this.requireWorkspacePath(request))
            return (await this.sftpReadFile(await requireSftp(), target)).toString('utf8')
          }
          case 'access': {
            const target = await toRemote(this.requireWorkspacePath(request))
            await this.sftpStat(await requireSftp(), target)
            return null
          }
          case 'stat': {
            const target = await toRemote(this.requireWorkspacePath(request))
            const stats = await this.sftpStat(await requireSftp(), target)
            return { isDirectory: Boolean(stats.mode && (stats.mode & 0o170000) === 0o040000) }
          }
          case 'readdir': {
            const target = await toRemote(this.requireWorkspacePath(request))
            const entries = await this.sftpReadDir(await requireSftp(), target)
            return entries.filter((entry) => entry !== '.' && entry !== '..')
          }
          case 'write': {
            const target = await toRemote(this.requireWorkspacePath(request), true)
            if (request.pattern === 'mkdir') {
              await this.sftpMkdirp(await requireSftp(), target, root)
              return null
            }
            if (typeof request.content !== 'string')
              throw new Error('Remote write requires content')
            await this.sftpWriteFile(await requireSftp(), target, request.content)
            return null
          }
          case 'find': {
            const target = workspaceCandidate(root, virtualCwd, this.requireWorkspacePath(request))
            const output = await this.execWorkspaceFind(
              client,
              root,
              target,
              request.pattern ?? '*'
            )
            return output
              .split(/\r?\n/)
              .filter(Boolean)
              .map((entry) => path.join(request.path ?? virtualCwd, entry.replace(/^\.\//, '')))
          }
          case 'tree': {
            const target = workspaceCandidate(root, virtualCwd, this.requireWorkspacePath(request))
            const output = await this.execWorkspaceTree(client, root, target)
            return output
              .split(/\r?\n/)
              .filter(Boolean)
              .map((entry) => path.join(request.path ?? virtualCwd, entry.replace(/^\.\//, '')))
          }
          case 'bash': {
            const operationCwd = workspaceCandidate(root, virtualCwd, request.cwd ?? virtualCwd)
            if (!request.command) throw new Error('Remote bash requires a command')
            return this.execWorkspaceShell(
              client,
              root,
              operationCwd,
              request.command,
              request.timeout
            )
          }
          default: {
            const exhaustive: never = request.operation
            throw new Error(`Unsupported SSH workspace operation: ${exhaustive}`)
          }
        }
      })
    } catch (error) {
      recordDiagnosticError('ssh-workspace', 'operation_failed', error, {
        requestId: request.requestId,
        connectionId,
        operation: request.operation,
        durationMs: Date.now() - startedAt,
      })
      throw error
    } finally {
      recordDiagnostic({
        level: 'debug',
        area: 'ssh-workspace',
        action: 'operation_finished',
        message: request.operation,
        correlationId: request.requestId,
        data: { durationMs: Date.now() - startedAt },
      })
    }
  }

  async checkRuntime(id: string): Promise<import('../../src/lib/ipc').RemoteRuntimeCheck> {
    const client = await this.connect(id)
    const [os, nodeVersion, piVersion, helperReady, writableHome] = await Promise.all([
      this.exec(client, 'uname -s'),
      this.exec(
        client,
        'if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi; node --version'
      ).catch(() => ''),
      this.exec(
        client,
        'if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi; "$HOME/.openpi/runtime/0.82.1/node_modules/.bin/pi" --version'
      ).catch(() => ''),
      this.exec(
        client,
        'test -r "$HOME/.openpi/runtime/0.82.1/runnerd.mjs" && test -r "$HOME/.openpi/runtime/0.82.1/runner-connect.mjs"'
      )
        .then(() => true)
        .catch(() => false),
      this.exec(client, 'test -w "$HOME"')
        .then(() => true)
        .catch(() => false),
    ])
    const linux = os.trim() === 'Linux'
    const nodeReady = atLeastVersion(nodeVersion, 22, 19)
    const piReady = piVersion.includes('0.82.1')
    const ready = linux && nodeReady && piReady && helperReady && writableHome
    return {
      linux,
      nodeReady,
      piReady,
      nodeVersion: nodeVersion.trim() || null,
      piVersion: piVersion.trim() || null,
      helperReady,
      writableHome,
      ready,
      message: ready
        ? null
        : 'Remote Pi needs the approved runtime setup before this project can open.',
    }
  }

  async installRuntime(id: string): Promise<void> {
    const client = await this.connect(id)
    const daemon = Buffer.from(RUNNER_DAEMON, 'utf8').toString('base64')
    const connector = Buffer.from(RUNNER_CONNECTOR, 'utf8').toString('base64')
    await this.exec(
      client,
      `if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi; mkdir -p "$HOME/.openpi/runtime/0.82.1" && npm install --prefix "$HOME/.openpi/runtime/0.82.1" @earendil-works/pi-coding-agent@0.82.1 && printf %s '${daemon}' | base64 -d > "$HOME/.openpi/runtime/0.82.1/runnerd.mjs" && printf %s '${connector}' | base64 -d > "$HOME/.openpi/runtime/0.82.1/runner-connect.mjs" && chmod 700 "$HOME/.openpi/runtime/0.82.1/runnerd.mjs" "$HOME/.openpi/runtime/0.82.1/runner-connect.mjs"`
    )
  }

  private async ensureRunnerDaemon(client: Client): Promise<void> {
    await this.exec(
      client,
      'if [ -S "$HOME/.openpi/run/runner.sock" ]; then exit 0; fi; if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi; nohup node "$HOME/.openpi/runtime/0.82.1/runnerd.mjs" >/dev/null 2>&1 </dev/null & for i in 1 2 3 4 5; do [ -S "$HOME/.openpi/run/runner.sock" ] && exit 0; sleep 1; done; exit 1'
    )
  }

  async setProviderKey(connectionId: string, providerId: string, apiKey: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('OS credential encryption is unavailable')
    this.requireProfile(connectionId)
    const encrypted = safeStorage.encryptString(apiKey).toString('base64')
    this.store.setRemoteConnectionCredential(connectionId, providerId, encrypted)
  }

  removeProviderKey(connectionId: string, providerId: string): void {
    this.store.removeRemoteConnectionCredential(connectionId, providerId)
  }

  async disconnect(id: string): Promise<void> {
    const live = this.live.get(id)
    if (!live) return
    this.live.delete(id)
    live.sftp?.end()
    live.client.end()
    this.setState(id, 'disconnected', null, null)
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map((id) => this.disconnect(id)))
  }

  async connect(id: string): Promise<Client> {
    const existing = this.live.get(id)
    if (existing?.state.status === 'connected') return existing.client
    const profile = this.requireProfile(id)
    this.setState(id, 'connecting', null, null)
    const startedAt = Date.now()
    const client = new Client()
    const config = sshConfig(profile, (value) => this.observedFingerprints.set(profile.id, value))
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('SSH connection timed out')),
        CONNECTION_TIMEOUT_MS
      )
      client.once('ready', () => {
        clearTimeout(timeout)
        resolve()
      })
      client.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      client.connect(config)
    }).catch((error) => {
      client.end()
      this.setState(id, 'error', null, messageForError(error))
      throw error
    })
    this.live.set(id, {
      client,
      sftp: null,
      openingSftp: null,
      state: {
        connectionId: id,
        status: 'connected',
        latencyMs: Date.now() - startedAt,
        error: null,
      },
    })
    client.once('close', () => {
      if (this.live.get(id)?.client === client) {
        this.live.delete(id)
        this.setState(id, 'disconnected', null, null)
      }
    })
    this.store.touchRemoteConnection(id)
    this.setState(id, 'connected', Date.now() - startedAt, null)
    return client
  }

  private exec(client: Client, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec(command, (error, stream) => {
        if (error) return reject(error)
        let stdout = ''
        let stderr = ''
        stream.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
        stream.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
        stream.on('close', (code: number | null) => {
          if (code === 0) resolve(stdout)
          else
            reject(
              new Error(stderr.trim() || `Remote command exited with code ${code ?? 'unknown'}`)
            )
        })
      })
    })
  }

  private requireWorkspacePath(request: WorkspaceRequest): string {
    if (!request.path) throw new Error('Remote workspace operation requires a path')
    return request.path
  }

  private sftpReadFile(sftp: SFTPWrapper, target: string): Promise<Buffer> {
    return new Promise((resolve, reject) =>
      sftp.readFile(target, (error, data) => (error ? reject(error) : resolve(data)))
    )
  }

  private sftpWriteFile(sftp: SFTPWrapper, target: string, content: string): Promise<void> {
    return new Promise((resolve, reject) =>
      sftp.writeFile(target, Buffer.from(content, 'utf8'), (error) =>
        error ? reject(error) : resolve()
      )
    )
  }

  private sftpStat(sftp: SFTPWrapper, target: string): Promise<{ mode?: number }> {
    return new Promise((resolve, reject) =>
      sftp.stat(target, (error, stats) => (error ? reject(error) : resolve(stats)))
    )
  }

  private sftpReadDir(sftp: SFTPWrapper, target: string): Promise<string[]> {
    return new Promise((resolve, reject) =>
      sftp.readdir(target, (error, entries) =>
        error ? reject(error) : resolve(entries.map((entry) => entry.filename))
      )
    )
  }

  private sftpRealpath(sftp: SFTPWrapper, target: string): Promise<string> {
    return new Promise((resolve, reject) =>
      sftp.realpath(target, (error, resolved) =>
        error || !resolved
          ? reject(error ?? new Error('Remote path is inaccessible'))
          : resolve(normalizeRemotePath(resolved))
      )
    )
  }

  private async sftpNearestExistingParent(sftp: SFTPWrapper, target: string): Promise<string> {
    let current = target
    while (true) {
      try {
        return await this.sftpRealpath(sftp, current)
      } catch {
        const parent = path.posix.dirname(current)
        if (parent === current) throw new Error('Remote path has no accessible parent')
        current = parent
      }
    }
  }

  private async sftpMkdirp(sftp: SFTPWrapper, target: string, root: string): Promise<void> {
    const parts = target.slice(root.length).split('/').filter(Boolean)
    let current = root
    for (const part of parts) {
      current = path.posix.join(current, part)
      try {
        await new Promise<void>((resolve, reject) =>
          sftp.mkdir(current, (error) => (error ? reject(error) : resolve()))
        )
      } catch (error) {
        await this.sftpStat(sftp, current).catch(() => {
          throw error
        })
      }
    }
  }

  private execWorkspaceShell(
    client: Client,
    root: string,
    cwd: string,
    command: string,
    timeoutSeconds?: number
  ): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      client.exec('sh -s', (error, stream) => {
        if (error) return reject(error)
        let output = ''
        let timedOut = false
        const timer =
          timeoutSeconds && timeoutSeconds > 0
            ? setTimeout(() => {
                timedOut = true
                stream.signal('TERM')
              }, timeoutSeconds * 1000)
            : null
        stream.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
        stream.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')))
        stream.on('close', (code: number | null) => {
          if (timer) clearTimeout(timer)
          if (timedOut) reject(new Error(`Remote command timed out after ${timeoutSeconds}s`))
          else resolve({ exitCode: code, output })
        })
        const selectedRoot = Buffer.from(root, 'utf8').toString('base64')
        const workspace = Buffer.from(cwd, 'utf8').toString('base64')
        const encodedCommand = Buffer.from(command, 'utf8').toString('base64')
        stream.end(
          `root=$(printf '%s' '${selectedRoot}' | base64 -d) || exit 125\n` +
            `workspace=$(printf '%s' '${workspace}' | base64 -d) || exit 125\n` +
            `command=$(printf '%s' '${encodedCommand}' | base64 -d) || exit 125\n` +
            'resolved_root=$(cd -- "$root" && pwd -P) || exit 126\n' +
            'resolved_workspace=$(cd -- "$workspace" && pwd -P) || exit 126\n' +
            'case "$resolved_workspace" in\n' +
            '  "$resolved_root"|"$resolved_root"/*) ;;\n' +
            '  *) printf "%s\\n" "Remote workspace path resolves outside its selected root" >&2; exit 126 ;;\n' +
            'esac\n' +
            'cd -- "$resolved_workspace" || exit 126\n' +
            'exec sh -c "$command"\n'
        )
      })
    })
  }

  /**
   * A sidecar must always receive a terminal response. ssh2 can retain a
   * seemingly connected Client whose channel-open callback never fires after a
   * network transition. Bound the main-side operation too, then discard that
   * client so the next user request establishes a fresh multiplexed transport.
   */
  private withWorkspaceDeadline<T>(
    connectionId: string,
    client: Client,
    request: WorkspaceRequest,
    operation: () => Promise<T>
  ): Promise<T> {
    const timeoutMs =
      request.operation === 'bash' && typeof request.timeout === 'number'
        ? (request.timeout + 2) * 1_000
        : CONNECTION_TIMEOUT_MS - 1_000
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        callback()
      }
      const timeout = setTimeout(() => {
        finish(() => {
          this.resetTimedOutConnection(connectionId, client)
          reject(
            new Error(
              `SSH workspace ${request.operation} timed out after ${timeoutMs / 1_000}s; the connection was reset`
            )
          )
        })
      }, timeoutMs)
      void operation().then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error))
      )
    })
  }

  private resetTimedOutConnection(connectionId: string, client: Client): void {
    const live = this.live.get(connectionId)
    if (!live || live.client !== client) return
    this.live.delete(connectionId)
    live.sftp?.end()
    client.destroy()
    this.setState(connectionId, 'reconnecting', null, 'SSH workspace operation timed out')
    recordDiagnostic({
      level: 'warn',
      area: 'ssh-workspace',
      action: 'connection_reset',
      message: 'Reset stalled SSH transport after a workspace operation timeout.',
      data: { connectionId },
    })
  }

  private execWorkspaceFind(
    client: Client,
    root: string,
    cwd: string,
    pattern: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec('sh -s', (error, stream) => {
        if (error) return reject(error)
        let stdout = ''
        let stderr = ''
        stream.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
        stream.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
        stream.on('close', (code: number | null) => {
          if (code === 0) resolve(stdout)
          else
            reject(new Error(stderr.trim() || `Remote find exited with code ${code ?? 'unknown'}`))
        })
        const selectedRoot = Buffer.from(root, 'utf8').toString('base64')
        const workspace = Buffer.from(cwd, 'utf8').toString('base64')
        const encodedPattern = Buffer.from(pattern, 'utf8').toString('base64')
        stream.end(
          `root=$(printf '%s' '${selectedRoot}' | base64 -d) || exit 125\n` +
            `workspace=$(printf '%s' '${workspace}' | base64 -d) || exit 125\n` +
            `pattern=$(printf '%s' '${encodedPattern}' | base64 -d) || exit 125\n` +
            'resolved_root=$(cd -- "$root" && pwd -P) || exit 126\n' +
            'resolved_workspace=$(cd -- "$workspace" && pwd -P) || exit 126\n' +
            'case "$resolved_workspace" in\n' +
            '  "$resolved_root"|"$resolved_root"/*) ;;\n' +
            '  *) printf "%s\\n" "Remote workspace path resolves outside its selected root" >&2; exit 126 ;;\n' +
            'esac\n' +
            'cd -- "$resolved_workspace" || exit 126\n' +
            'find . -type f -name "$pattern" -print\n'
        )
      })
    })
  }

  private execWorkspaceTree(client: Client, root: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec('sh -s', (error, stream) => {
        if (error) return reject(error)
        let stdout = ''
        let stderr = ''
        stream.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
        stream.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
        stream.on('close', (code: number | null) => {
          if (code === 0) resolve(stdout)
          else
            reject(new Error(stderr.trim() || `Remote tree exited with code ${code ?? 'unknown'}`))
        })
        const selectedRoot = Buffer.from(root, 'utf8').toString('base64')
        const workspace = Buffer.from(cwd, 'utf8').toString('base64')
        stream.end(
          `root=$(printf '%s' '${selectedRoot}' | base64 -d) || exit 125\n` +
            `workspace=$(printf '%s' '${workspace}' | base64 -d) || exit 125\n` +
            'resolved_root=$(cd -- "$root" && pwd -P) || exit 126\n' +
            'resolved_workspace=$(cd -- "$workspace" && pwd -P) || exit 126\n' +
            'case "$resolved_workspace" in\n' +
            '  "$resolved_root"|"$resolved_root"/*) ;;\n' +
            '  *) printf "%s\\n" "Remote workspace path resolves outside its selected root" >&2; exit 126 ;;\n' +
            'esac\n' +
            'cd -- "$resolved_workspace" || exit 126\n' +
            "find . \\( -path './.git' -o -path './node_modules' -o -path './dist' -o -path './build' -o -path './out' -o -path './__pycache__' -o -path './.venv' -o -path './venv' -o -path './target' -o -path './.cache' -o -path './coverage' \\) -prune -o -type f -print | head -n 5000\n"
        )
      })
    })
  }

  private openSftp(connectionId: string, client: Client): Promise<SFTPWrapper> {
    const live = this.live.get(connectionId)
    if (!live || live.client !== client) {
      return new Promise((resolve, reject) =>
        client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp)))
      )
    }
    if (live.sftp) return Promise.resolve(live.sftp)
    if (live.openingSftp) return live.openingSftp
    const opening = new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((error, sftp) => {
        if (error) {
          reject(error)
          return
        }
        sftp.once('close', () => {
          const current = this.live.get(connectionId)
          if (current?.sftp === sftp) current.sftp = null
        })
        resolve(sftp)
      })
    })
    live.openingSftp = opening
    return opening
      .then((sftp) => {
        const current = this.live.get(connectionId)
        if (current?.client === client) current.sftp = sftp
        return sftp
      })
      .finally(() => {
        const current = this.live.get(connectionId)
        if (current?.client === client) current.openingSftp = null
      })
  }

  private requireProfile(id: string): ConnectionProfile {
    const profile = this.store.listRemoteConnections().find((item) => item.id === id)
    if (!profile) throw new Error('Remote connection was not found')
    return profile
  }

  private getState(id: string): ConnectionState {
    return (
      this.live.get(id)?.state ?? {
        connectionId: id,
        status: 'disconnected',
        latencyMs: null,
        error: null,
      }
    )
  }

  private withState(profile: ConnectionProfile): ConnectionProfile {
    const state = this.getState(profile.id)
    return { ...profile, status: state.status, latencyMs: state.latencyMs, lastError: state.error }
  }

  private setState(
    id: string,
    status: ConnectionStatus,
    latencyMs: number | null,
    error: string | null
  ): void {
    const state = { connectionId: id, status, latencyMs, error }
    const live = this.live.get(id)
    if (live) live.state = state
    for (const listener of this.listeners) listener(state)
  }
}

function atLeastVersion(value: string, major: number, minor: number): boolean {
  const match = /v?(\d+)\.(\d+)/.exec(value)
  if (!match) return false
  const parsedMajor = Number(match[1])
  const parsedMinor = Number(match[2])
  return parsedMajor > major || (parsedMajor === major && parsedMinor >= minor)
}
