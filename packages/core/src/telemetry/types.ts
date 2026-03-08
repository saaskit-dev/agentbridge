// Telemetry core type definitions
// See RFC-001 for design rationale

export interface TraceContext {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly sessionId?: string
  readonly machineId?: string
}

export interface LogEntry {
  timestamp: string
  level: Level
  layer: string
  component: string
  traceId?: string
  spanId?: string
  parentSpanId?: string
  sessionId?: string
  machineId?: string
  message: string
  data?: Record<string, unknown>
  error?: {
    message: string
    stack?: string
    code?: string
  }
  durationMs?: number
}

export type Level = 'debug' | 'info' | 'warn' | 'error'

export const LEVEL_VALUES: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export function levelValue(level: Level): number {
  return LEVEL_VALUES[level]
}

export interface WireTrace {
  tid: string
  sid: string
  pid?: string
  ses?: string
  mid?: string
}

export interface LogFilter {
  level?: Level | Level[]
  traceId?: string
  sessionId?: string
  component?: string
  since?: string
  until?: string
  search?: string
}
