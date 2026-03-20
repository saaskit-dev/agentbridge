import type { LogEntry, Level, TraceContext } from './types.js'
import { isCollectorReady, getCollector } from './collector.js'
import { createTrace, continueTrace } from './context.js'

export class Span {
  readonly traceId: string
  readonly name: string

  private readonly component: string
  private readonly startTime: number
  private ended = false
  private readonly ctx: TraceContext

  constructor(name: string, component: string, parentCtx?: TraceContext) {
    this.name = name
    this.component = component
    this.startTime = Date.now()

    if (parentCtx) {
      this.ctx = continueTrace({
        traceId: parentCtx.traceId,
        sessionId: parentCtx.sessionId,
        machineId: parentCtx.machineId,
      })
    } else {
      this.ctx = createTrace()
    }

    this.traceId = this.ctx.traceId

    this.emit('debug', `[span:start] ${name}`)
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (!this.ended) this.emit('debug', message, undefined, data)
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (!this.ended) this.emit('info', message, undefined, data)
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (!this.ended) this.emit('warn', message, undefined, data)
  }

  error(message: string, err?: Error, data?: Record<string, unknown>): void {
    if (!this.ended) this.emit('error', message, err, data)
  }

  end(data?: Record<string, unknown>): void {
    if (this.ended) return
    this.ended = true
    const durationMs = Date.now() - this.startTime
    this.emit('info', `[span:end] ${this.name}`, undefined, data, durationMs)
  }

  toContext(): TraceContext {
    return this.ctx
  }

  private emit(level: Level, message: string, err?: Error, data?: Record<string, unknown>, durationMs?: number): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      layer: isCollectorReady() ? getCollector().currentLayer : 'unknown',
      component: this.component,
      traceId: this.traceId,
      sessionId: this.ctx.sessionId,
      machineId: this.ctx.machineId,
      message,
    }

    if (data) entry.data = data
    if (durationMs != null) entry.durationMs = durationMs

    if (err) {
      entry.error = {
        message: err.message,
        stack: err.stack,
        code: (err as any).code,
      }
    }

    if (isCollectorReady()) {
      getCollector().emit(entry)
    }
    // Span entries before collector init are dropped (spans shouldn't exist that early)
  }
}
