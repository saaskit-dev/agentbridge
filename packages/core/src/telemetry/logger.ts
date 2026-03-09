import type { LogEntry, Level, TraceContext } from './types.js'
import { isCollectorReady, getCollector, _registerOnCollectorReady } from './collector.js'
import { Span } from './span.js'

let _globalContextProvider: (() => TraceContext | undefined) | undefined

/**
 * Set a global trace context provider that all Logger instances will fall back to
 * when no explicit context is provided via withContext().
 * Call this at process startup (e.g. in initCliTelemetry) to wire in getProcessTraceContext.
 */
export function setGlobalContextProvider(fn: (() => TraceContext | undefined) | undefined): void {
  _globalContextProvider = fn
}

export interface ScopedLogger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, err?: Error | unknown, data?: unknown): void
  readonly context: TraceContext
}

export class Logger {
  private static startupBuffer: LogEntry[] = []
  private static bufferRegistered = false

  constructor(private readonly component: string) {
    if (!Logger.bufferRegistered) {
      Logger.bufferRegistered = true
      _registerOnCollectorReady(() => {
        const collector = getCollector()
        for (const entry of Logger.startupBuffer) {
          collector.emit(entry)
        }
        Logger.startupBuffer = []
      })
    }
  }

  debug(message: string, data?: unknown): void {
    this.emit('debug', message, undefined, data)
  }

  info(message: string, data?: unknown): void {
    this.emit('info', message, undefined, data)
  }

  warn(message: string, data?: unknown): void {
    this.emit('warn', message, undefined, data)
  }

  error(message: string, err?: Error | unknown, data?: unknown): void {
    const errObj = err instanceof Error ? err : err !== undefined ? new Error(String(err)) : undefined
    this.emit('error', message, errObj, data)
  }

  withContext(ctx: TraceContext): ScopedLogger {
    return {
      debug: (message, data) => this.emit('debug', message, undefined, data, ctx),
      info: (message, data) => this.emit('info', message, undefined, data, ctx),
      warn: (message, data) => this.emit('warn', message, undefined, data, ctx),
      error: (message, err, data) => {
        const errObj = err instanceof Error ? err : err !== undefined ? new Error(String(err)) : undefined
        this.emit('error', message, errObj, data, ctx)
      },
      context: ctx,
    }
  }

  span(name: string, ctx?: TraceContext): Span {
    return new Span(name, this.component, ctx)
  }

  private static toData(data: unknown): Record<string, unknown> | undefined {
    if (data === undefined || data === null) return undefined
    if (typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>
    return { _value: data }
  }

  private emit(level: Level, message: string, err?: Error, data?: unknown, ctx?: TraceContext): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      layer: isCollectorReady() ? getCollector().currentLayer : 'unknown',
      component: this.component,
      message,
    }

    const resolvedCtx = ctx ?? _globalContextProvider?.()
    if (resolvedCtx) {
      entry.traceId = resolvedCtx.traceId
      entry.spanId = resolvedCtx.spanId
      if (resolvedCtx.parentSpanId) entry.parentSpanId = resolvedCtx.parentSpanId
      if (resolvedCtx.sessionId) entry.sessionId = resolvedCtx.sessionId
      if (resolvedCtx.machineId) entry.machineId = resolvedCtx.machineId
    }

    const resolvedData = Logger.toData(data)
    if (resolvedData) entry.data = resolvedData

    if (err) {
      entry.error = {
        message: err.message,
        stack: err.stack,
        code: (err as any).code,
      }
    }

    if (isCollectorReady()) {
      getCollector().emit(entry)
    } else {
      Logger.startupBuffer.push(entry)
    }
  }

  /** @internal Reset static state (for testing) */
  static _reset(): void {
    Logger.startupBuffer = []
    Logger.bufferRegistered = false
  }
}
