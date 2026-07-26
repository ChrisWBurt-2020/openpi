/**
 * Electron utility processes may deliver a MessageEvent-like wrapper, while a
 * Node fork delivers the payload directly. Do not unwrap direct payloads just
 * because a successful workspace result itself has a `data` field.
 */
export function unwrapSidecarIncoming(message: unknown): unknown {
  if (!message || typeof message !== 'object') return message
  const record = message as { type?: unknown; data?: unknown }
  if (typeof record.type === 'string' && record.type !== 'message') return message
  return 'data' in record ? record.data : message
}
