import { Check, ChevronLeft, FolderOpen, Globe2, Plus, Server, X } from 'lucide-solid'
import { createEffect, createSignal, For, Show } from 'solid-js'
import type {
  ConnectionProfile,
  ConnectionTestResult,
  ProjectExecutionMode,
  RemoteDirectory,
  RemoteRuntimeCheck,
} from '../lib/ipc'

type Step = 'choose' | 'connection' | 'verify' | 'directory'

interface ProjectPickerProps {
  open: boolean
  onClose: () => void
  onOpenLocal: () => Promise<void>
  onProjectAdded: () => Promise<void>
}

const DEFAULT_PORT = 22

export function ProjectPicker(props: ProjectPickerProps) {
  const [step, setStep] = createSignal<Step>('choose')
  const [connections, setConnections] = createSignal<ConnectionProfile[]>([])
  const [selected, setSelected] = createSignal<ConnectionProfile | null>(null)
  const [testResult, setTestResult] = createSignal<ConnectionTestResult | null>(null)
  const [runtime, setRuntime] = createSignal<RemoteRuntimeCheck | null>(null)
  const [directories, setDirectories] = createSignal<RemoteDirectory[]>([])
  const [directoryPath, setDirectoryPath] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [label, setLabel] = createSignal('')
  const [host, setHost] = createSignal('')
  const [username, setUsername] = createSignal('')
  const [port, setPort] = createSignal(DEFAULT_PORT)
  const [identityFile, setIdentityFile] = createSignal('')
  const [providerId, setProviderId] = createSignal('openrouter')
  const [providerKey, setProviderKey] = createSignal('')
  const [boundProvider, setBoundProvider] = createSignal<string | null>(null)
  const [executionMode, setExecutionMode] =
    createSignal<Extract<ProjectExecutionMode, 'ssh-workspace' | 'persistent-runner'>>(
      'ssh-workspace'
    )

  const reset = () => {
    setStep('choose')
    setSelected(null)
    setTestResult(null)
    setRuntime(null)
    setDirectories([])
    setDirectoryPath('')
    setError(null)
    setProviderKey('')
    setBoundProvider(null)
  }

  const loadConnections = async () => {
    const list = await window.openpi.connections.list()
    setConnections(list)
  }

  createEffect(() => {
    if (!props.open) return
    void loadConnections().catch((reason: unknown) => setError(String(reason)))
  })

  const close = () => {
    reset()
    props.onClose()
  }

  const chooseLocal = async () => {
    setBusy(true)
    try {
      await props.onOpenLocal()
      close()
    } finally {
      setBusy(false)
    }
  }

  const createConnection = async () => {
    setError(null)
    setBusy(true)
    try {
      const profile = await window.openpi.connections.create({
        label: label().trim() || host().trim(),
        host: host().trim(),
        username: username().trim(),
        port: port(),
        identityFile: identityFile().trim() || undefined,
      })
      setSelected(profile)
      setStep('verify')
      await verify(profile)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (profile = selected()) => {
    if (!profile) return
    setError(null)
    setBusy(true)
    try {
      const result = await window.openpi.connections.test(profile.id)
      setTestResult(result)
      if (result.ok && result.homePath) {
        if (executionMode() === 'persistent-runner') {
          const runtimeCheck = await window.openpi.remote.checkRuntime(profile.id)
          setRuntime(runtimeCheck)
          if (!runtimeCheck.ready) return
        } else {
          setRuntime(null)
        }
        setDirectoryPath(result.homePath)
        setDirectories(await window.openpi.remote.listDirectories(profile.id, result.homePath))
        setStep('directory')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const installRuntime = async () => {
    const profile = selected()
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      await window.openpi.remote.installRuntime(profile.id)
      await verify(profile)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const bindProviderKey = async () => {
    const profile = selected()
    const key = providerKey().trim()
    if (!profile || !key) return
    setBusy(true)
    setError(null)
    try {
      await window.openpi.connections.setProviderKey(profile.id, providerId(), key)
      setProviderKey('')
      setBoundProvider(providerId())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const trustFingerprint = async () => {
    const profile = selected()
    const result = testResult()
    if (!profile || !result?.fingerprint) return
    setBusy(true)
    try {
      const trusted = await window.openpi.connections.update(profile.id, {
        label: profile.label,
        host: profile.host,
        username: profile.username,
        port: profile.port,
        identityFile: profile.identityFile ?? undefined,
        hostKeyFingerprint: result.fingerprint,
      })
      setSelected(trusted)
      await verify(trusted)
    } finally {
      setBusy(false)
    }
  }

  const browse = async (path: string) => {
    const profile = selected()
    if (!profile) return
    setBusy(true)
    try {
      setDirectories(await window.openpi.remote.listDirectories(profile.id, path))
      setDirectoryPath(path)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const addProject = async () => {
    const profile = selected()
    if (!profile || !directoryPath()) return
    setBusy(true)
    try {
      await window.openpi.remote.addProject(profile.id, directoryPath(), executionMode())
      await props.onProjectAdded()
      close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={props.open}>
      <div class="project-picker-backdrop">
        <section class="project-picker" role="dialog" aria-modal="true" aria-label="Add project">
          <header class="project-picker-header">
            <div>
              <span class="project-picker-eyebrow">Projects</span>
              <h2>Add project</h2>
            </div>
            <button
              type="button"
              class="project-picker-close"
              onClick={close}
              aria-label="Close add project"
            >
              <X size={16} />
            </button>
          </header>

          <Show when={step() !== 'choose'}>
            <button
              type="button"
              class="project-picker-back"
              onClick={() => setStep('choose')}
              disabled={busy()}
            >
              <ChevronLeft size={14} /> Back
            </button>
          </Show>
          <Show when={error()}>{(message) => <p class="project-picker-error">{message()}</p>}</Show>

          <Show when={step() === 'choose'}>
            <div class="project-picker-choices">
              <button type="button" onClick={() => void chooseLocal()} disabled={busy()}>
                <FolderOpen size={22} />
                <span>
                  <strong>Local folder</strong>
                  <small>Choose a folder on this computer.</small>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExecutionMode('ssh-workspace')
                  setStep('connection')
                }}
                disabled={busy()}
              >
                <Globe2 size={22} />
                <span>
                  <strong>SSH Workspace</strong>
                  <small>Agent runs on this PC; files and commands run remotely.</small>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExecutionMode('persistent-runner')
                  setStep('connection')
                }}
                disabled={busy()}
              >
                <Server size={22} />
                <span>
                  <strong>Persistent Remote Runner</strong>
                  <small>Agent and model runtime run on the VPS.</small>
                </span>
              </button>
            </div>
          </Show>

          <Show when={step() === 'connection'}>
            <div class="project-picker-body">
              <Show when={connections().length > 0}>
                <p class="project-picker-saved-label">Saved connections</p>
                <div class="project-picker-connections">
                  <For each={connections()}>
                    {(connection) => (
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(connection)
                          setStep('verify')
                          void verify(connection)
                        }}
                      >
                        <Server size={15} />
                        <span>
                          {connection.label}
                          <small>
                            {connection.username}@{connection.host}
                          </small>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <p class="project-picker-divider">New connection</p>
              <label>
                Label
                <input
                  value={label()}
                  onInput={(event) => setLabel(event.currentTarget.value)}
                  placeholder="Production server"
                />
              </label>
              <label>
                Host
                <input
                  value={host()}
                  onInput={(event) => setHost(event.currentTarget.value)}
                  placeholder="example.com"
                />
              </label>
              <label>
                Username
                <input
                  value={username()}
                  onInput={(event) => setUsername(event.currentTarget.value)}
                  placeholder="deploy"
                />
              </label>
              <label>
                Port
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={port()}
                  onInput={(event) => setPort(Number(event.currentTarget.value) || DEFAULT_PORT)}
                />
              </label>
              <label>
                Identity file <small>(optional when using SSH agent)</small>
                <input
                  value={identityFile()}
                  onInput={(event) => setIdentityFile(event.currentTarget.value)}
                  placeholder="~/.ssh/id_ed25519"
                />
              </label>
              <button
                type="button"
                class="project-picker-primary"
                onClick={() => void createConnection()}
                disabled={busy() || !host().trim() || !username().trim()}
              >
                <Plus size={15} /> Verify connection
              </button>
            </div>
          </Show>

          <Show when={step() === 'verify'}>
            <div class="project-picker-body">
              <h3>Verify remote host</h3>
              <Show when={testResult()}>
                {(result) => (
                  <div class="project-picker-checks">
                    <p>
                      {result().message ??
                        (result().ok ? 'SSH and SFTP are ready.' : 'Connection needs attention.')}
                    </p>
                    <span>Linux: {result().checks.linux ? 'ready' : 'unavailable'}</span>
                    <span>Node: {result().checks.nodeVersion ?? 'not found'}</span>
                    <span>Pi: {result().checks.piVersion ?? 'not found'}</span>
                    <Show when={result().fingerprint && !result().ok}>
                      <button
                        type="button"
                        class="project-picker-primary"
                        onClick={() => void trustFingerprint()}
                        disabled={busy()}
                      >
                        <Check size={15} /> Trust {result().fingerprint}
                      </button>
                    </Show>
                  </div>
                )}
              </Show>
              <Show when={runtime()}>
                {(check) => (
                  <div class="project-picker-runtime">
                    <strong>
                      {check().ready ? 'Remote runtime ready' : 'Remote runtime setup required'}
                    </strong>
                    <span>
                      Helper: {check().helperReady ? 'ready' : 'missing'} · Home:{' '}
                      {check().writableHome ? 'writable' : 'read-only'}
                    </span>
                    <Show when={!check().ready}>
                      <p>
                        OpenPi installs Pi privately in <code>~/.openpi/runtime/0.82.1</code> and
                        never uses sudo.
                      </p>
                      <Show when={!check().nodeReady}>
                        <p>
                          Node ≥22.19 is required. Upgrade Node on this host first, then retry
                          verification.
                        </p>
                      </Show>
                      <button
                        type="button"
                        class="project-picker-primary"
                        onClick={() => void installRuntime()}
                        disabled={
                          busy() || !check().linux || !check().writableHome || !check().nodeReady
                        }
                      >
                        Install approved runtime
                      </button>
                    </Show>
                  </div>
                )}
              </Show>
              <Show
                when={executionMode() === 'persistent-runner' && selected() && runtime()?.ready}
              >
                <div class="project-picker-runtime">
                  <strong>Cloud model access</strong>
                  <span>
                    Bind an API key to this SSH connection. The key stays encrypted on this computer
                    and is sent only to remote Pi through the SSH channel.
                  </span>
                  <label>
                    Provider
                    <select
                      value={providerId()}
                      onChange={(event) => setProviderId(event.currentTarget.value)}
                    >
                      <option value="openrouter">OpenRouter — broad model catalog</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="minimax">MiniMax</option>
                    </select>
                  </label>
                  <label>
                    API key
                    <input
                      type="password"
                      value={providerKey()}
                      onInput={(event) => setProviderKey(event.currentTarget.value)}
                      placeholder="Paste key to bind"
                      autocomplete="off"
                    />
                  </label>
                  <button
                    type="button"
                    class="project-picker-primary"
                    onClick={() => void bindProviderKey()}
                    disabled={busy() || !providerKey().trim()}
                  >
                    Bind provider key
                  </button>
                  <Show when={boundProvider()}>
                    {(provider) => (
                      <span>{provider()} key bound. New remote chats will load its models.</span>
                    )}
                  </Show>
                </div>
              </Show>
              <button
                type="button"
                class="project-picker-primary"
                onClick={() => void verify()}
                disabled={busy()}
              >
                Retry verification
              </button>
            </div>
          </Show>

          <Show when={step() === 'directory'}>
            <div class="project-picker-body">
              <h3>Select remote project</h3>
              <label>
                Path
                <input
                  value={directoryPath()}
                  onInput={(event) => setDirectoryPath(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void browse(directoryPath())
                  }}
                />
              </label>
              <div class="project-picker-directories">
                <For each={directories()}>
                  {(directory) => (
                    <button type="button" onClick={() => void browse(directory.path)}>
                      <FolderOpen size={15} />
                      {directory.name}
                    </button>
                  )}
                </For>
              </div>
              <button
                type="button"
                class="project-picker-primary"
                onClick={() => void addProject()}
                disabled={busy() || !runtime()?.ready}
              >
                <Check size={15} /> Add remote project
              </button>
            </div>
          </Show>
        </section>
      </div>
    </Show>
  )
}
