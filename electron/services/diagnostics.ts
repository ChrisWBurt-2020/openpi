import { randomUUID } from 'node:crypto'

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error'

export interface DiagnosticEvent {
  id: string
  at: string
  level: DiagnosticLevel
  area: string
  action: string
  message: string
  correlationId?: string
  data?: Record<string, unknown>
}

const MAX_EVENTS = 300
const events: DiagnosticEvent[] = []
let lastFatal: DiagnosticEvent | null = null

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[truncated]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 297)}...` : value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1))
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => !/(token|secret|password|authorization|cookie|api.?key)/i.test(key))
        .slice(0, 30)
        .map(([key, item]) => [key, safeValue(item, depth + 1)])
    )
  }
  return String(value)
}

export function recordDiagnostic(
  input: Omit<DiagnosticEvent, 'id' | 'at' | 'data'> & {
    data?: Record<string, unknown>
  }
): DiagnosticEvent {
  const event: DiagnosticEvent = {
    id: input.correlationId ?? randomUUID(),
    at: new Date().toISOString(),
    level: input.level,
    area: input.area,
    action: input.action,
    message: input.message,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.data ? { data: safeValue(input.data) as Record<string, unknown> } : {}),
  }
  events.push(event)
  if (events.length > MAX_EVENTS) events.shift()
  if (event.level === 'error') lastFatal = event
  return event
}

export function recordDiagnosticError(
  area: string,
  action: string,
  error: unknown,
  data?: Record<string, unknown>
): DiagnosticEvent {
  const normalized = error instanceof Error ? error : new Error(String(error))
  return recordDiagnostic({
    level: 'error',
    area,
    action,
    message: normalized.message,
    data: { ...data, stack: normalized.stack ?? null },
  })
}

export function recentDiagnostics(): DiagnosticEvent[] {
  return [...events]
}

export function latestDiagnosticError(): DiagnosticEvent | null {
  return lastFatal
}
