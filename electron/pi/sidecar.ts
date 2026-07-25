/**
 * piSidecar.ts — Pi SDK agent runtime running in a sidecar child process.
 *
 * Isolates all Pi SDK memory from the main process. Main stays ≤100 MB;
 * Pi SDK (sessions, models, resource loading) lives here and can grow freely.
 *
 * Communication: typed JSON messages over process.parentPort.
 * All heavy imports (Pi SDK, resource loader) happen inside this file only.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// pi-coding-agent does not re-export these auth types; they come straight from
// pi-ai, which ModelRuntime.login() is defined against (see model-runtime.d.ts).
import type { AuthEvent, AuthInteraction, AuthPrompt, AuthType } from '@earendil-works/pi-ai'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  readStoredCredential,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { expandPromptTemplateText } from '../../src/lib/sessionPrompt'
import { createOpenPiExtensionUIContext } from './extensionUiContext'
import { fulfillExtensionUiPending } from './extensionUiPending'
import { enforceIgnoreScriptsEnv } from './safePackageManager'
import {
  acquireSessionLock,
  refreshSessionLock,
  releaseSessionLock,
  type SessionLockAcquireResult,
} from './sessionLock'
import { defaultBackupDir, preflightSessionFile } from './sessionPreflight'
import { isStaleExtensionCtxEvent, isStaleExtensionCtxMessage } from './staleCtx'

// ─── Types ─────────────────────────────────────────────────────────────────────

import type { SessionReadyPayload, SidecarCommand, SidecarMessage } from './sidecarTypes'

export type { SessionReadyPayload, SidecarCommand, SidecarMessage }

// ─── State ─────────────────────────────────────────────────────────────────────

type SessionState = {
  session: Awaited<ReturnType<typeof createAgentSession>>['session']
  cwd: string
  workspaceTrusted: boolean
  unsubscribe: () => void
}

let state: SessionState | null = null
let _modelRuntime: ModelRuntime | null = null
let _modelRegistry: ModelRegistry | null = null
/** Advisory owner lock for the session file we currently have open (ADR-003). */
let _sessionLock: { lockPath: string; heartbeat: NodeJS.Timeout } | null = null
let _cachedResourceLoader: {
  cwd: string
  workspaceTrusted: boolean
  loader: InstanceType<typeof DefaultResourceLoader>
} | null = null
const _pendingOAuthPrompts = new Map<string, (v: string) => void>()

// ─── Port ─────────────────────────────────────────────────────────────────────

// Align with Pi 0.75.4 supply-chain hardening: skip lifecycle scripts on every
// npm/pnpm/yarn invocation the SDK performs. Safe to call at module load.
enforceIgnoreScriptsEnv()

type ParentPort = {
  postMessage(msg: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
}

function createParentPort(): ParentPort | null {
  const electronParentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
  if (electronParentPort) return electronParentPort

  if (typeof process.send !== 'function') return null
  return {
    postMessage(msg: unknown): void {
      process.send?.(msg)
    },
    on(_event: 'message', listener: (message: unknown) => void): void {
      process.on('message', listener)
    },
  }
}

const maybeParentPort = createParentPort()
if (!maybeParentPort) {
  process.stderr.write('[piSidecar] No parent port — must run as utilityProcess or Node fork\n')
  process.exit(1)
}
const parentPort: ParentPort = maybeParentPort

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(msg: SidecarMessage): void {
  parentPort.postMessage(msg)
}

function getAgentDir(): string {
  return path.join(os.homedir(), '.pi', 'agent')
}

/**
 * Pi 0.80.8 (Breaking Changes) replaced CreateAgentSessionOptions.authStorage +
 * modelRegistry with a single async `modelRuntime` option, and made AuthStorage
 * a private implementation detail (no longer exported). ModelRuntime now owns
 * credential storage + model catalogs together.
 *
 * This MUST stay a singleton for the sidecar's lifetime: extension-registered
 * providers (added via runtime.registerProvider() during createAgentSession →
 * bindCore) live on this instance. Recreating it drops them.
 */
async function getModelRuntime(): Promise<ModelRuntime> {
  if (_modelRuntime) return _modelRuntime
  const agentDir = getAgentDir()
  _modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, 'auth.json'),
    modelsPath: path.join(agentDir, 'models.json'),
  })
  return _modelRuntime
}

/**
 * ModelRegistry is now a thin synchronous compatibility facade over
 * ModelRuntime (see @earendil-works/pi-coding-agent's model-registry.d.ts —
 * "Synchronous compatibility facade exposed to extensions"). It holds no
 * state beyond a runtime reference, so rebuilding it is cheap; the runtime
 * itself is what must stay stable.
 */
async function getModelRegistry(): Promise<ModelRegistry> {
  _modelRegistry ??= new ModelRegistry(await getModelRuntime())
  return _modelRegistry
}

async function invalidateModelRegistry(): Promise<void> {
  // refresh() became async in 0.80.8 (models.json loading is async now).
  // Every caller must await this before making synchronous registry reads.
  await (await getModelRegistry()).refresh()
}

/**
 * Preset-answer AuthInteraction for set_provider_key.
 *
 * ModelRuntime.login(providerId, 'api_key', interaction) is now the only
 * persisted write path for an api-key credential (0.80.8 removed
 * AuthStorage.set()). The renderer already collected the key via its own
 * form before sending `set_provider_key`, so this interaction must not
 * round-trip back to the renderer for it — it just hands the key straight
 * back the first time ApiKeyAuth.login() calls prompt(), and no-ops on
 * everything else (checks/notifications the built-in api-key flow may emit).
 */
function buildPresetKeyAuthInteraction(apiKey: string): AuthInteraction {
  let answered = false
  return {
    async prompt(_prompt: AuthPrompt): Promise<string> {
      // Only the first prompt should get the real key; a well-behaved
      // api-key login() asks exactly once, but don't loop forever if it asks again.
      if (answered) return ''
      answered = true
      return apiKey
    },
    notify(_event: AuthEvent): void {
      // No renderer round-trip for the preset-key flow.
    },
  }
}

/**
 * Fully interactive AuthInteraction for login_provider (OAuth device-code /
 * browser flows, or an api-key flow that itself wants to prompt).
 *
 * Maps the new AuthInteraction callbacks onto the sidecar's existing
 * `provider_login_event` IPC channel and the `_pendingOAuthPrompts`
 * resolver map, so the renderer-side login UI (built against the old
 * onAuth/onProgress/onPrompt/onSelect/onDeviceCode shape) keeps working
 * without changes.
 */
function buildInteractiveAuthInteraction(requestId: string, providerId: string): AuthInteraction {
  return {
    async prompt(prompt: AuthPrompt): Promise<string> {
      if (prompt.type === 'select') {
        send({
          type: 'provider_login_event',
          requestId,
          event: {
            type: 'select',
            message: prompt.message,
            options: prompt.options.map((o) => ({ id: o.id, label: o.label })),
          },
        })
      } else {
        // 'text' | 'secret' | 'manual_code' all render as a single text prompt
        // in the existing renderer UI; it doesn't distinguish secret masking
        // today, which is a pre-existing limitation, not one this port adds.
        send({
          type: 'provider_login_event',
          requestId,
          event: { type: 'prompt', message: prompt.message, placeholder: prompt.placeholder },
        })
      }
      return new Promise<string>((resolve, reject) => {
        _pendingOAuthPrompts.set(providerId, (v) => resolve(v))
        prompt.signal?.addEventListener('abort', () => {
          _pendingOAuthPrompts.delete(providerId)
          reject(new Error('Prompt aborted'))
        })
      })
    },
    notify(event: AuthEvent): void {
      switch (event.type) {
        case 'auth_url':
          send({
            type: 'provider_login_event',
            requestId,
            event: { type: 'auth', url: event.url, instructions: event.instructions },
          })
          break
        case 'device_code':
          send({
            type: 'provider_login_event',
            requestId,
            event: {
              type: 'device_code',
              verificationUri: event.verificationUri,
              userCode: event.userCode,
              intervalSeconds: event.intervalSeconds,
              expiresInSeconds: event.expiresInSeconds,
            },
          })
          break
        case 'progress':
          send({
            type: 'provider_login_event',
            requestId,
            event: { type: 'progress', message: event.message },
          })
          break
        case 'info':
          // No dedicated 'info' bucket in the existing renderer event union;
          // surface it as progress rather than drop it silently.
          send({
            type: 'provider_login_event',
            requestId,
            event: { type: 'progress', message: event.message },
          })
          break
      }
    },
  }
}

function outputLine(level: 'info' | 'warn' | 'error', text: string): void {
  send({ type: 'output_append', line: { level, text, ts: Date.now() } })
}

function stripFrontmatter(content: string): string {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return trimmed
  const afterOpen = trimmed.slice(3)
  const closeIdx = afterOpen.indexOf('\n---')
  if (closeIdx === -1) return trimmed
  return afterOpen.slice(closeIdx + 4).trimStart()
}

function expandSkillCommandForContext(
  text: string,
  session: Awaited<ReturnType<typeof createAgentSession>>['session']
): { text: string; expanded: boolean } {
  if (!text.startsWith('/skill:')) return { text, expanded: false }
  const spaceIndex = text.indexOf(' ')
  const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex)
  const args = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim()
  const skill = session.resourceLoader
    .getSkills()
    .skills.find((candidate) => candidate.name === skillName)
  if (!skill) return { text, expanded: false }
  const body = stripFrontmatter(fs.readFileSync(skill.filePath, 'utf-8')).trim()
  const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`
  return { text: args ? `${skillBlock}\n\n${args}` : skillBlock, expanded: true }
}

function slashInvocationName(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const name = trimmed.slice(1).split(/\s+/, 1)[0]?.trim()
  return name || null
}

function isKnownSessionSlashCommand(
  session: Awaited<ReturnType<typeof createAgentSession>>['session'],
  invocationName: string
): boolean {
  if (invocationName.startsWith('skill:')) {
    const skillName = invocationName.slice('skill:'.length)
    return session.resourceLoader.getSkills().skills.some((skill) => skill.name === skillName)
  }
  return (
    session.extensionRunner
      .getRegisteredCommands()
      .some((command) => command.invocationName === invocationName) ||
    session.promptTemplates.some((template) => template.name === invocationName)
  )
}

function sendUnsupportedSlashCommand(invocationName: string): void {
  send({
    type: 'session_event',
    event: {
      type: 'message_start',
      message: {
        role: 'custom',
        content: `/${invocationName} is not available in OpenPi. Extension commands and prompt templates are supported; TUI-only commands are hidden from the picker until they have desktop handlers.`,
        details: { level: 'warn' },
        timestamp: Date.now(),
      },
    },
  })
}

/**
 * Build the final prompt text sent to Pi SDK.
 * Always runs expansion (skill commands, then prompt templates) regardless of contextPrefix.
 */
function buildSidecarPromptText(
  text: string,
  contextPrefix: string | undefined,
  session: Awaited<ReturnType<typeof createAgentSession>>['session']
): string {
  const trimmed = text.trim()
  const prefix = contextPrefix?.trim()

  // 1. Try skill command expansion
  const skillExpanded = expandSkillCommandForContext(trimmed, session)
  if (skillExpanded.expanded) {
    return prefix ? `${prefix}\n\n${skillExpanded.text}` : skillExpanded.text
  }

  // 3. Try prompt template expansion (user-installed .md templates)
  const templateExpanded = expandPromptTemplateText(trimmed, session.promptTemplates)
  if (templateExpanded.expanded) {
    return prefix ? `${prefix}\n\n${templateExpanded.text}` : templateExpanded.text
  }

  // 4. Fall through: wrap raw text with context prefix if present
  return prefix ? `${prefix}\n\n${trimmed}` : trimmed
}

async function getResourceLoader(cwd: string, workspaceTrusted: boolean) {
  const agentDir = getAgentDir()
  if (
    _cachedResourceLoader &&
    _cachedResourceLoader.cwd === cwd &&
    _cachedResourceLoader.workspaceTrusted === workspaceTrusted
  ) {
    return _cachedResourceLoader.loader
  }

  const fileSettingsManager = SettingsManager.create(cwd, agentDir)
  const settingsManager = workspaceTrusted
    ? fileSettingsManager
    : SettingsManager.inMemory(fileSettingsManager.getGlobalSettings())
  // When the workspace is not yet trusted, project-local extensions (.pi/extensions)
  // are blocked by noExtensions=true — they're unknown third-party code.
  // Global extensions (~/.pi/agent/extensions) are the user's own trusted code and
  // MUST always load regardless of workspace trust (e.g. copilot-provider.ts registers
  // the github-copilot provider; blocking it causes "No API key found" errors).
  //
  // We pass agentDir (not agentDir/extensions) as the additional path. The SDK's
  // collectPackageResources treats the path as a "package root" and scans for an
  // extensions/ subdirectory inside it — exactly what we need. If we passed
  // agentDir/extensions directly it would look for extensions/extensions/ (wrong),
  // fall back to adding the directory itself, and loadExtension would fail trying
  // to jiti.import() a directory.
  const noExtensions = !workspaceTrusted
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions,
    additionalExtensionPaths: noExtensions ? [agentDir] : [],
  })
  try {
    await loader.reload()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    outputLine(
      'warn',
      `[packages] One or more Pi packages failed to install and were skipped: ${msg}`
    )
  }
  _cachedResourceLoader = { cwd, workspaceTrusted, loader }
  return loader
}

// ─── Session management ────────────────────────────────────────────────────────

/**
 * Emit session_shutdown to extensions before disposing a session.
 * This lets extensions (e.g. pi-sub-bar) clean up timers and release
 * captured ctx references. Without this, timers fire with stale ctx
 * and crash the sidecar.
 */
async function emitSessionShutdown(
  session: Awaited<ReturnType<typeof createAgentSession>>['session'],
  reason: 'quit' | 'reload' | 'new' | 'resume' | 'fork'
): Promise<void> {
  try {
    // Pi 0.79.3 exposes `session.extensionRunner` as a public typed getter.
    // `emit` iterates registered handlers; no-op when none are subscribed.
    // TODO(upgrade/pi-0.79.3 follow-up): register a `pi.on('project_trust', ...)` handler
    // in `.pi/extensions/openpi-bridge.ts` that defers to our workspace-trust gate.
    // That requires a synchronous channel from the extension process to the sidecar.
    await session.extensionRunner.emit({ type: 'session_shutdown', reason })
  } catch {
    // Never let extension errors block session disposal
  }
}

/** Heartbeat cadence. Must be well under sessionLock's DEFAULT_STALE_MS. */
const SESSION_LOCK_HEARTBEAT_MS = 30_000

function dropSessionLock(): void {
  if (!_sessionLock) return
  clearInterval(_sessionLock.heartbeat)
  releaseSessionLock(_sessionLock.lockPath)
  _sessionLock = null
}

/**
 * Take the advisory owner lock for a session file and start its heartbeat.
 *
 * Advisory only: terminal Pi doesn't participate, so a failure here is
 * reported to the user rather than enforced. Returning the result lets the
 * caller decide (open read-only / clone / take over) — currently we warn and
 * continue, which is honest about what this mechanism can actually do.
 */
function claimSessionLock(sessionFile: string): SessionLockAcquireResult {
  dropSessionLock()
  const result = acquireSessionLock(sessionFile, { app: 'openpi' })
  if (result.acquired) {
    const heartbeat = setInterval(() => {
      refreshSessionLock(result.lockPath)
    }, SESSION_LOCK_HEARTBEAT_MS)
    // Never hold the sidecar's event loop open just for a heartbeat.
    heartbeat.unref?.()
    _sessionLock = { lockPath: result.lockPath, heartbeat }
  }
  return result
}

async function startSession(
  cwd: string,
  opts: {
    sessionFile?: string
    forkEntryId?: string
    requestId?: string
    workspaceTrusted?: boolean
  } = {}
): Promise<void> {
  // Dispose previous session — emit session_shutdown first so extensions
  // (e.g. pi-task polling) clear timers and drop captured `pi` before ctx invalidates.
  if (state) {
    state.unsubscribe()
    const shutdownReason: 'new' | 'resume' | 'fork' = opts.forkEntryId
      ? 'fork'
      : opts.sessionFile
        ? 'resume'
        : 'new'
    await emitSessionShutdown(state.session, shutdownReason)
    state.session.dispose()
    state = null
  }

  const agentDir = getAgentDir()
  const modelRuntime = await getModelRuntime()
  const fileSettingsManager = SettingsManager.create(cwd, agentDir)
  const workspaceTrusted = opts.workspaceTrusted ?? false
  const settingsManager = workspaceTrusted
    ? fileSettingsManager
    : SettingsManager.inMemory(fileSettingsManager.getGlobalSettings())
  // ADR-003: never open a shared session file blind. Check the format version
  // (snapshotting before Pi's in-place migration) and take the advisory owner
  // lock, surfacing both outcomes to the user instead of racing silently.
  if (opts.sessionFile) {
    const preflight = preflightSessionFile(opts.sessionFile, {
      backupDir: defaultBackupDir(agentDir),
    })
    if (preflight.reason !== 'current') {
      outputLine(preflight.decision === 'read-only' ? 'warn' : 'info', preflight.message)
    }

    const lock = claimSessionLock(opts.sessionFile)
    if (!lock.acquired) {
      outputLine('warn', lock.message)
    }
  } else {
    dropSessionLock()
  }

  let sessionManager = opts.sessionFile
    ? SessionManager.open(opts.sessionFile, undefined, cwd)
    : SessionManager.create(cwd)

  if (opts.sessionFile && opts.forkEntryId) {
    const branchedSessionFile = sessionManager.createBranchedSession(opts.forkEntryId)
    if (branchedSessionFile) {
      sessionManager = SessionManager.open(branchedSessionFile, undefined, cwd)
    }
  }

  const resourceLoader = await getResourceLoader(cwd, workspaceTrusted)

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager,
    modelRuntime,
    settingsManager,
    resourceLoader,
  })

  const extensionUiSinks = {
    sessionEvent: (event: Record<string, unknown>) => {
      send({ type: 'session_event', event })
    },
    postExtensionUiRequest: (
      request: import('../../src/lib/extensionUiTypes').ExtensionUiRequest
    ) => {
      send({ type: 'extension_ui_request', request })
    },
  }

  try {
    await session.bindExtensions({
      uiContext: createOpenPiExtensionUIContext(extensionUiSinks),
      mode: 'rpc',
      commandContextActions: {
        waitForIdle: () => session.agent.waitForIdle(),
        newSession: async () => ({ cancelled: true }),
        fork: async () => ({ cancelled: true }),
        navigateTree: async () => ({ cancelled: true }),
        switchSession: async () => ({ cancelled: true }),
        reload: async () => {
          await session.reload()
        },
      },
      onError: (err) => {
        // Suppress the benign "stale extension ctx" errors from pi-task.
        // pi-task's background polling captures `pi` (ExtensionAPI); when
        // our reload path does a full session replacement, in-flight async
        // work briefly calls `pi.sendMessage` on the now-stale ctx. The
        // SDK throws messages starting with "This extension ctx is stale
        // after session replacement or reload..." which surface as noisy
        // extension_error events. They are harmless — the new session is
        // already running. Filter them so the user only sees real errors.
        const msg = err.error
        if (isStaleExtensionCtxMessage(msg)) return
        outputLine('error', `[extension] ${err.extensionPath} (${err.event}): ${msg}`)
      },
    })
  } catch (err) {
    outputLine(
      'error',
      `[openpi] bindExtensions failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (isStaleExtensionCtxEvent(event)) return

    send({ type: 'session_event', event: event as Record<string, unknown> })

    const ev = event as {
      type: string
      success?: boolean
      finalError?: string
      errorMessage?: string
      message?: string
    }

    if (ev.type === 'agent_end') {
      send({ type: 'session_index_updated' })
    }

    if (ev.type === 'extension_error') {
      const extErr = ev as { extensionPath?: string; event?: string; error?: string }
      outputLine(
        'error',
        `[extension] ${extErr.extensionPath ?? 'unknown'} (${extErr.event ?? 'error'}): ${extErr.error ?? 'extension error'}`
      )
    }

    if (ev.type === 'auto_retry_end' && ev.success === false) {
      outputLine('warn', `[retry] ${ev.finalError ?? 'Auto-retry failed'}`)
    }

    if (ev.type === 'compaction_end' && ev.errorMessage) {
      outputLine('error', `[compaction] ${ev.errorMessage}`)
    }
  })

  state = { session, cwd, workspaceTrusted, unsubscribe }

  const model = session.model as
    | { id: string; name: string; provider: string; reasoning?: boolean; contextWindow?: number }
    | undefined

  const payload: SessionReadyPayload = {
    cwd,
    sessionFile: session.sessionFile ?? null,
    sessionId: session.sessionId ?? null,
    sessionName: opts.sessionFile ? null : null, // main process resolves display name from SQLite
    model: model
      ? {
          id: model.id,
          name: model.name,
          provider: model.provider,
          reasoning: model.reasoning ?? false,
          contextWindow: model.contextWindow ?? 0,
        }
      : null,
    thinkingLevel: (session.thinkingLevel as string | undefined) ?? null,
  }

  send({ type: 'session_ready', requestId: opts.requestId, payload })
}

// ─── Command handler ────────────────────────────────────────────────────────────

parentPort.on('message', (message) => {
  const cmd = (
    message && typeof message === 'object' && 'data' in message
      ? (message as { data: unknown }).data
      : message
  ) as SidecarCommand
  void handleCommand(cmd).catch((err) => {
    send({
      type: 'error',
      requestId: cmd && typeof cmd === 'object' && 'requestId' in cmd ? cmd.requestId : undefined,
      message: err instanceof Error ? err.message : String(err),
    })
  })
})

async function handleCommand(cmd: SidecarCommand): Promise<void> {
  switch (cmd.type) {
    case 'start_session': {
      try {
        await startSession(cmd.cwd, {
          sessionFile: cmd.sessionFile,
          forkEntryId: cmd.forkEntryId,
          requestId: cmd.requestId,
          workspaceTrusted: cmd.workspaceTrusted,
        })
      } catch (err) {
        send({
          type: 'session_error',
          requestId: cmd.requestId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
      break
    }

    case 'prompt': {
      if (!state) return
      const trimmed = cmd.text.trim()
      const invocationName = slashInvocationName(trimmed)
      if (invocationName) {
        if (!isKnownSessionSlashCommand(state.session, invocationName)) {
          sendUnsupportedSlashCommand(invocationName)
          break
        }
        await state.session.prompt(trimmed)
      } else {
        const promptText = buildSidecarPromptText(cmd.text, cmd.contextPrefix, state.session)
        await state.session.prompt(promptText)
      }
      break
    }

    case 'steer': {
      if (!state) return
      const steerText = buildSidecarPromptText(cmd.text, cmd.contextPrefix, state.session)
      await state.session.steer(steerText)
      break
    }

    case 'follow_up': {
      if (!state) return
      const followUpText = buildSidecarPromptText(cmd.text, cmd.contextPrefix, state.session)
      await state.session.followUp(followUpText)
      break
    }

    case 'list_prompt_templates': {
      const cwd = cmd.cwd ?? state?.cwd ?? process.cwd()
      const workspaceTrusted = cmd.workspaceTrusted ?? false
      const loader = await getResourceLoader(cwd, workspaceTrusted)
      const prompts = loader.getPrompts().prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        argHint: prompt.argumentHint,
      }))
      send({ type: 'prompt_templates_result', requestId: cmd.requestId, prompts })
      break
    }

    case 'list_slash_commands': {
      if (!state) {
        send({ type: 'slash_commands_result', requestId: cmd.requestId, commands: [] })
        break
      }
      const session = state.session
      const commands: Array<{
        name: string
        description: string
        argHint?: string
        source: 'builtin' | 'extension' | 'prompt' | 'skill'
      }> = []

      for (const command of session.extensionRunner.getRegisteredCommands()) {
        commands.push({
          name: command.invocationName,
          description: command.description ?? '',
          source: 'extension',
        })
      }
      for (const template of session.promptTemplates) {
        commands.push({
          name: template.name,
          description: template.description ?? '',
          argHint: template.argumentHint,
          source: 'prompt',
        })
      }

      send({ type: 'slash_commands_result', requestId: cmd.requestId, commands })
      break
    }

    case 'list_skills': {
      const cwd = cmd.cwd ?? state?.cwd ?? process.cwd()
      const workspaceTrusted = cmd.workspaceTrusted ?? false
      const loader = await getResourceLoader(cwd, workspaceTrusted)
      const skills = loader.getSkills().skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        path: skill.baseDir,
        scope: skill.sourceInfo.scope === 'project' ? 'project' : 'user',
        tags: [],
      }))
      send({ type: 'skills_result', requestId: cmd.requestId, skills })
      break
    }

    case 'read_skill_file': {
      const cwd = cmd.cwd ?? state?.cwd ?? process.cwd()
      const workspaceTrusted = cmd.workspaceTrusted ?? false
      const loader = await getResourceLoader(cwd, workspaceTrusted)
      const requested = path.resolve(cmd.path)
      const skill = loader
        .getSkills()
        .skills.find((candidate) => path.resolve(candidate.filePath) === requested)
      if (!skill) {
        send({ type: 'skill_file_result', requestId: cmd.requestId, content: null })
        break
      }
      try {
        send({
          type: 'skill_file_result',
          requestId: cmd.requestId,
          content: fs.readFileSync(skill.filePath, 'utf-8'),
        })
      } catch {
        send({ type: 'skill_file_result', requestId: cmd.requestId, content: null })
      }
      break
    }

    case 'abort': {
      if (!state) return
      await state.session.abort()
      break
    }

    case 'execute_bash': {
      if (!state) {
        send({ type: 'bash_result', requestId: cmd.requestId, result: null })
        return
      }
      const result = await state.session.executeBash(cmd.command, undefined, {
        excludeFromContext: cmd.excludeFromContext,
      })
      send({ type: 'bash_result', requestId: cmd.requestId, result })
      break
    }

    case 'set_model': {
      if (!state) return
      const model = (await getModelRegistry()).find(cmd.provider, cmd.modelId)
      if (!model) return
      await state.session.setModel(model)
      break
    }

    case 'set_thinking': {
      if (!state) return
      state.session.setThinkingLevel(
        cmd.level as Parameters<typeof state.session.setThinkingLevel>[0]
      )
      break
    }

    case 'set_session_name': {
      if (!state) return
      state.session.setSessionName(cmd.name)
      break
    }

    case 'get_session_info': {
      if (!state) {
        send({
          type: 'session_info_result',
          requestId: cmd.requestId,
          info: {
            sessionFile: null,
            sessionId: null,
            sessionName: null,
            model: null,
            thinkingLevel: null,
            messageCount: 0,
            contextUsagePercent: null,
            contextTokens: null,
            contextWindow: null,
          },
        })
        break
      }
      const session = state.session
      const stats = session.getSessionStats()
      const ctx = stats.contextUsage ?? session.getContextUsage()
      const model = session.model as
        | {
            id: string
            name: string
            provider: string
            reasoning?: boolean
            contextWindow?: number
          }
        | undefined
      const messages = (session.agent as { state?: { messages?: unknown[] } }).state?.messages ?? []
      send({
        type: 'session_info_result',
        requestId: cmd.requestId,
        info: {
          sessionFile: stats.sessionFile ?? session.sessionFile ?? null,
          sessionId: stats.sessionId ?? session.sessionId ?? null,
          sessionName: session.sessionName ?? null,
          model: model
            ? {
                id: model.id,
                name: model.name,
                provider: model.provider,
                reasoning: model.reasoning ?? false,
                contextWindow: model.contextWindow ?? 0,
              }
            : null,
          thinkingLevel: (session.thinkingLevel as string | undefined) ?? null,
          messageCount: messages.length,
          contextUsagePercent: ctx?.percent ?? null,
          contextTokens: ctx?.tokens ?? null,
          contextWindow: ctx?.contextWindow ?? null,
        },
      })
      break
    }

    case 'compact': {
      if (!state) {
        send({
          type: 'error',
          requestId: cmd.requestId,
          message: 'No active session',
        })
        break
      }
      // Pi SDK's session.compact() emits `compaction_start` and
      // `compaction_end` events. The session event bridge already
      // forwards them to the renderer, so the UI updates naturally.
      try {
        await state.session.compact(cmd.customInstructions)
      } catch (err) {
        send({
          type: 'error',
          requestId: cmd.requestId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
      break
    }

    case 'reload_session': {
      if (!state) {
        send({
          type: 'error',
          requestId: cmd.requestId,
          message: 'No active session',
        })
        break
      }
      // /reload triggers an SDK session.reload() which invalidates all
      // extension ctxs. pi-task captures `pi` (ExtensionAPI) in its background
      // polling closure, so in-flight async work calls `pi.sendMessage` on
      // a stale ctx and throws "this extension ctx is stale...".
      //
      // The safe path is a full session replacement: dispose the current
      // session (atomically destroying its extension runner + timers) and
      // create a new one with the same session file. All old extension state
      // goes away cleanly; new state is re-initialized.
      try {
        const previous = state
        state = null
        previous.unsubscribe()
        await emitSessionShutdown(previous.session, 'reload')
        previous.session.dispose()
        await startSession(previous.cwd, {
          sessionFile: previous.session.sessionFile ?? undefined,
          requestId: cmd.requestId,
          workspaceTrusted: previous.workspaceTrusted,
        })
      } catch (err) {
        send({
          type: 'error',
          requestId: cmd.requestId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
      break
    }

    case 'copy_last_assistant_text': {
      if (!state) {
        send({
          type: 'error',
          requestId: cmd.requestId,
          message: 'No active session',
        })
        break
      }
      const text = state.session.getLastAssistantText() ?? null
      send({
        type: 'last_assistant_text_result',
        requestId: cmd.requestId,
        text,
      })
      break
    }

    case 'fork_session': {
      if (!state) return

      // Resolve the fork entry ID.
      //
      // During live streaming, sessionEvents.ts assigns synthetic display IDs
      // ("u-{timestampMs}" for user messages, "a-{timestampMs}" for assistant)
      // because the Pi SDK's message_start event does not include the real
      // session entry ID. These synthetic IDs are NOT valid Pi session entry IDs
      // and cause "Entry not found" errors inside createBranchedSession().
      //
      // Resolution strategy: extract the encoded Unix timestamp from the synthetic
      // ID and find the matching session entry via sessionManager.getEntries().
      // By the time the user can click Fork, message_end has fired and
      // sessionManager.appendMessage() has persisted the entry — so getEntries()
      // will contain the real entry with the correct timestamp.
      let forkEntryId = cmd.entryId
      const syntheticMatch = /^[ua]-(-?\d+)$/.exec(cmd.entryId)
      if (syntheticMatch) {
        const timestampMs = Number(syntheticMatch[1])
        const entries = state.session.sessionManager.getEntries()
        const match = entries.find((e) => {
          if (e.type !== 'message') return false
          const msg = e.message as { timestamp?: number }
          return typeof msg.timestamp === 'number' && msg.timestamp === timestampMs
        })
        if (!match) {
          throw new Error(
            `Cannot fork: no session entry found with timestamp ${timestampMs} (id: ${cmd.entryId}). The message may still be streaming.`
          )
        }
        forkEntryId = match.id
      }

      await startSession(state.cwd, {
        sessionFile: state.session.sessionFile ?? undefined,
        forkEntryId,
        requestId: cmd.requestId,
      })
      break
    }

    case 'get_stats': {
      if (!state) {
        send({
          type: 'stats_result',
          requestId: cmd.requestId,
          stats: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cost: 0,
            contextUsagePercent: null,
            contextTokens: null,
            contextWindow: null,
            sessionFile: null,
            sessionId: null,
            isStreaming: false,
          },
        })
        return
      }
      // Use the Pi SDK's authoritative pre-computed stats —
      // do NOT manually sum from agent.state.messages (wrong data source).
      const sdkStats = state.session.getSessionStats()
      // contextUsage gives current context window fill (what Pi TUI shows),
      // NOT the cumulative session totals from getSessionStats().tokens.
      const ctxUsage = sdkStats.contextUsage ?? state.session.getContextUsage()
      send({
        type: 'stats_result',
        requestId: cmd.requestId,
        stats: {
          inputTokens: sdkStats.tokens.input,
          outputTokens: sdkStats.tokens.output,
          cacheReadTokens: sdkStats.tokens.cacheRead,
          cacheWriteTokens: sdkStats.tokens.cacheWrite,
          cost: sdkStats.cost,
          contextUsagePercent: ctxUsage?.percent ?? null,
          contextTokens: ctxUsage?.tokens ?? null,
          contextWindow: ctxUsage?.contextWindow ?? null,
          sessionFile: sdkStats.sessionFile ?? state.session.sessionFile ?? null,
          sessionId: sdkStats.sessionId ?? state.session.sessionId ?? null,
          isStreaming:
            (state.session.agent as unknown as { state?: { isStreaming?: boolean } }).state
              ?.isStreaming ?? false,
        },
      })
      break
    }

    case 'get_models': {
      const models = await (await getModelRegistry()).getAvailable()
      const mapped = (
        models as Array<{
          id: string
          name: string
          provider: string
          reasoning?: boolean
          contextWindow?: number
        }>
      ).map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        reasoning: m.reasoning ?? false,
        contextWindow: m.contextWindow ?? 0,
      }))
      send({ type: 'models_result', requestId: cmd.requestId, models: mapped })
      break
    }

    case 'get_settings': {
      const agentDir = getAgentDir()
      const settingsManager = state
        ? SettingsManager.create(state.cwd, agentDir)
        : SettingsManager.create(agentDir, agentDir)
      const global = settingsManager.getGlobalSettings()
      const project = state ? settingsManager.getProjectSettings() : {}
      const effective = { ...global, ...project }
      send({
        type: 'settings_result',
        requestId: cmd.requestId,
        result: { global, project, effective },
      })
      break
    }

    case 'save_settings': {
      const agentDir = getAgentDir()
      const settingsPath =
        cmd.scope === 'global'
          ? path.join(agentDir, 'settings.json')
          : path.join(state?.cwd ?? agentDir, '.pi', 'settings.json')
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
      fs.writeFileSync(settingsPath, `${JSON.stringify(cmd.settings, null, 2)}\n`, 'utf-8')
      // Reload resource loader cache after settings change
      _cachedResourceLoader = null
      break
    }

    case 'get_default_project_trust': {
      if (!state) {
        send({
          type: 'default_project_trust_result',
          requestId: cmd.requestId,
          defaultProjectTrust: 'ask',
        })
        break
      }
      const agentDir = getAgentDir()
      const settingsManager = SettingsManager.create(state.cwd, agentDir)
      const value = settingsManager.getDefaultProjectTrust()
      send({
        type: 'default_project_trust_result',
        requestId: cmd.requestId,
        defaultProjectTrust: value,
      })
      break
    }

    case 'set_default_project_trust': {
      if (!state) return
      const agentDir = getAgentDir()
      const settingsManager = SettingsManager.create(state.cwd, agentDir)
      settingsManager.setDefaultProjectTrust(cmd.defaultProjectTrust)
      break
    }

    case 'get_providers': {
      const registry = await getModelRegistry()
      const allModels = registry.getAll() as Array<{ provider: string }>
      const providerModelCounts = new Map<string, number>()
      for (const m of allModels) {
        providerModelCounts.set(m.provider, (providerModelCounts.get(m.provider) ?? 0) + 1)
      }
      const authPath = path.join(getAgentDir(), 'auth.json')
      const providers = []
      for (const [providerId, count] of providerModelCounts) {
        const status = registry.getProviderAuthStatus(providerId)
        const displayName = registry.getProviderDisplayName(providerId)
        // readStoredCredential is the retained one-off *synchronous* read helper
        // now that AuthStorage itself is a private implementation detail (0.80.8+).
        const cred = readStoredCredential(providerId, authPath)
        const credentialType =
          cred?.type === 'oauth'
            ? 'oauth'
            : cred?.type === 'api_key'
              ? 'api_key'
              : status.source === 'environment'
                ? 'env'
                : undefined
        providers.push({
          id: providerId,
          displayName,
          configured: status.configured,
          modelCount: count,
          source: status.source,
          credentialType,
        })
      }
      send({ type: 'providers_result', requestId: cmd.requestId, providers })
      break
    }

    case 'set_provider_key': {
      // AuthStorage.set() is gone in 0.80.8; ModelRuntime.login(providerId,
      // 'api_key', interaction) is the persisted write path now. The key is
      // already known (renderer collected it), so hand it back via a
      // preset-answer interaction rather than round-tripping a prompt.
      const runtime = await getModelRuntime()
      await runtime.login(cmd.provider, 'api_key', buildPresetKeyAuthInteraction(cmd.apiKey))
      await invalidateModelRegistry()
      break
    }

    case 'remove_provider_key': {
      // logout() is the persisted removal path. (removeRuntimeApiKey() is
      // explicitly non-persisted per model-runtime.d.ts — runtime-only override.)
      await (await getModelRuntime()).logout(cmd.provider)
      await invalidateModelRegistry()
      break
    }

    case 'invalidate_models': {
      await invalidateModelRegistry()
      break
    }

    case 'login_provider': {
      try {
        const runtime = await getModelRuntime()
        // sidecarTypes.ts's login_provider command doesn't carry an AuthType
        // (pre-dates the 0.80.8 login() signature). Auto-detect from the
        // provider's registered auth methods, preferring OAuth when a
        // provider offers both — matches prior UX where OAuth was the primary
        // "login" action and api-key was a separate "set key" field.
        const provider = runtime.getProvider(cmd.providerId)
        const authType: AuthType = provider?.auth.oauth ? 'oauth' : 'api_key'
        await runtime.login(
          cmd.providerId,
          authType,
          buildInteractiveAuthInteraction(cmd.requestId, cmd.providerId)
        )
        await invalidateModelRegistry()
        send({ type: 'provider_login_event', requestId: cmd.requestId, event: { type: 'success' } })
      } catch (err) {
        send({
          type: 'provider_login_event',
          requestId: cmd.requestId,
          event: { type: 'error', message: err instanceof Error ? err.message : String(err) },
        })
      }
      break
    }

    case 'logout_provider': {
      await (await getModelRuntime()).logout(cmd.providerId)
      await invalidateModelRegistry()
      break
    }

    case 'resolve_provider_prompt': {
      const resolver = _pendingOAuthPrompts.get(cmd.providerId)
      if (resolver) {
        resolver(cmd.value)
        _pendingOAuthPrompts.delete(cmd.providerId)
      }
      break
    }

    case 'extension_ui_response': {
      fulfillExtensionUiPending({
        id: cmd.id,
        cancelled: cmd.cancelled,
        confirmed: cmd.confirmed,
        value: cmd.value,
      })
      break
    }

    case 'stop': {
      if (state) {
        state.unsubscribe()
        await emitSessionShutdown(state.session, 'quit')
        state.session.dispose()
        state = null
      }
      // Release the advisory owner lock on clean shutdown so the next opener
      // doesn't have to wait out the staleness window (ADR-003).
      dropSessionLock()
      send({ type: 'stopped' })
      setTimeout(() => process.exit(0), 100)
      break
    }
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────────

send({ type: 'ready' })
