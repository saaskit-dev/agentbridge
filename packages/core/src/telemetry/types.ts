// Telemetry core type definitions
// See RFC-001 for design rationale

export interface TraceContext {
  readonly traceId: string
  readonly sessionId?: string
  readonly machineId?: string
  readonly userId?: string
}

export interface LogEntry {
  timestamp: string
  level: Level
  layer: string
  component: string
  traceId?: string
  sessionId?: string
  machineId?: string
  userId?: string
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
