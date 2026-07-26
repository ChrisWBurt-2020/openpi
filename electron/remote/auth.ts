import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { safeStorage } from 'electron'
import type { ConnectConfig } from 'ssh2'
import type { ConnectionProfile } from '../../src/lib/ipc'
import type { SessionIndexStore } from '../session/sessionIndex'

export function sshConfig(
  profile: ConnectionProfile,
  observeFingerprint: (fingerprint: string) => void,
  acceptHost: (fingerprint: string) => boolean = (fingerprint) =>
    profile.hostKeyFingerprint === fingerprint
): ConnectConfig {
  const privateKey = profile.identityFile ? fs.readFileSync(profile.identityFile) : undefined
  return {
    host: profile.host,
    username: profile.username,
    port: profile.port,
    privateKey,
    agent: privateKey ? undefined : process.env.SSH_AUTH_SOCK,
    readyTimeout: 15_000,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 3,
    hostVerifier: (key: Buffer) => {
      const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
      observeFingerprint(fingerprint)
      return acceptHost(fingerprint)
    },
    algorithms: {
      serverHostKey: ['ssh-ed25519', 'rsa-sha2-512', 'rsa-sha2-256', 'ecdsa-sha2-nistp256'],
    },
  }
}

export function providerEnvironment(
  store: SessionIndexStore,
  connectionId: string
): NodeJS.ProcessEnv {
  if (!safeStorage.isEncryptionAvailable()) return {}
  const environment: NodeJS.ProcessEnv = {}
  for (const credential of store.getRemoteConnectionCredentials(connectionId)) {
    const variable = providerVariable(credential.providerId)
    if (variable)
      environment[variable] = safeStorage.decryptString(
        Buffer.from(credential.encryptedKey, 'base64')
      )
  }
  return environment
}

function providerVariable(providerId: string): string | null {
  const variables: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    minimax: 'MINIMAX_API_KEY',
  }
  return variables[providerId] ?? null
}
