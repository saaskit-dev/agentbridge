import type { TraceContext, WireTrace } from './types.js'

export type IdGenerator = () => string

let _generateId: IdGenerator = () => crypto.randomUUID()

export function setIdGenerator(fn: IdGenerator): void {
  _generateId = fn
}

function generateTraceId(): string {
  return _generateId()
}

function generateSpanId(): string {
  return _generateId().replace(/-/g, '').slice(0, 12)
}

export function createTrace(opts?: {
  sessionId?: string
  machineId?: string
  userId?: string
}): TraceContext {
  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    sessionId: opts?.sessionId,
    machineId: opts?.machineId,
    userId: opts?.userId,
  }
}

export function continueTrace(upstream: {
  traceId: string
  spanId: string
  sessionId?: string
  machineId?: string
  userId?: string
}): TraceContext {
  return {
    traceId: upstream.traceId,
    spanId: generateSpanId(),
    parentSpanId: upstream.spanId,
    sessionId: upstream.sessionId,
    machineId: upstream.machineId,
    userId: upstream.userId,
  }
}

/**
 * Resume a trace by traceId only (HTTP batch sync path — RFC §19.3).
 * No parent span is available; creates a fresh span within the existing trace.
 */
export function resumeTrace(traceId: string, opts?: { sessionId?: string }): TraceContext {
  return {
    traceId,
    spanId: generateSpanId(),
    sessionId: opts?.sessionId,
  }
}

export function injectTrace(ctx: TraceContext, carrier: Record<string, unknown>): void {
  const wire: WireTrace = {
    tid: ctx.traceId,
    sid: ctx.spanId,
  }
  if (ctx.parentSpanId) wire.pid = ctx.parentSpanId
  if (ctx.sessionId) wire.ses = ctx.sessionId
  if (ctx.machineId) wire.mid = ctx.machineId
  carrier._trace = wire
}

export function extractTrace(carrier: Record<string, unknown>): TraceContext | undefined {
  const wire = carrier._trace as WireTrace | undefined
  if (!wire || typeof wire.tid !== 'string' || typeof wire.sid !== 'string') {
    return undefined
  }
  return {
    traceId: wire.tid,
    spanId: wire.sid,
    parentSpanId: wire.pid,
    sessionId: wire.ses,
    machineId: wire.mid,
  }
}
