const STALE_EXTENSION_CTX_RE =
  /(?:this extension ctx is stale|captured pi or command ctx|stale after session replacement|stale after session reload|ctx is stale after)/i

function messageFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  const candidates = [
    record.message,
    record.error,
    record.errorMessage,
    record.finalError,
    record.reason,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return ''
}

export function isStaleExtensionCtxMessage(value: unknown): boolean {
  return STALE_EXTENSION_CTX_RE.test(messageFromUnknown(value))
}

export function isStaleExtensionCtxEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  const record = event as Record<string, unknown>
  if (record.type !== 'extension_error') return false
  return isStaleExtensionCtxMessage(event)
}
