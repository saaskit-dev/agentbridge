import { describe, it, expect, beforeEach } from 'vitest'
import { Span } from '../span.js'
import { initTelemetry, _resetTelemetry } from '../collector.js'
import { createTrace } from '../context.js'
import { Logger } from '../logger.js'
import type { LogEntry } from '../types.js'
import type { LogSink } from '../sinks/types.js'

function makeSink(): LogSink & { entries: LogEntry[] } {
  const entries: LogEntry[] = []
  return {
    name: 'test',
    entries,
    write(entry: LogEntry) { entries.push(entry) },
    async flush() {},
    async close() {},
  }
}

describe('Span', () => {
  let sink: ReturnType<typeof makeSink>

  beforeEach(() => {
    _resetTelemetry()
    Logger._reset()
    sink = makeSink()
    initTelemetry({ layer: 'cli', sinks: [sink], sanitize: false })
  })

  it('creates a new trace when no parent context', () => {
    const span = new Span('operation', 'test')
    expect(span.traceId).toBeTruthy()
    expect(span.name).toBe('operation')
  })

  it('continues parent trace when context provided', () => {
    const parent = createTrace({ sessionId: 'sess-1' })
    const span = new Span('child-op', 'test', parent)

    expect(span.traceId).toBe(parent.traceId)
  })

  it('logs span start on creation', () => {
    new Span('my-op', 'comp')
    expect(sink.entries).toHaveLength(1)
    expect(sink.entries[0].message).toContain('[span:start] my-op')
    expect(sink.entries[0].component).toBe('comp')
  })

  it('logs with trace context', () => {
    const span = new Span('op', 'comp')
    span.info('doing work', { step: 1 })

    const entry = sink.entries.find(e => e.message === 'doing work')!
    expect(entry.traceId).toBe(span.traceId)
    expect(entry.data).toEqual({ step: 1 })
  })

  it('records durationMs on end', async () => {
    const span = new Span('timed', 'comp')

    // Small delay
    await new Promise(r => setTimeout(r, 10))
    span.end({ result: 'ok' })

    const endEntry = sink.entries.find(e => e.message.includes('[span:end]'))!
    expect(endEntry.durationMs).toBeGreaterThanOrEqual(0)
    expect(endEntry.data).toEqual({ result: 'ok' })
  })

  it('end() logs at info level for production visibility (RFC §4.3)', () => {
    // end() must be 'info' not 'debug' so span timing is visible with minLevel:'info' in production
    const span = new Span('timed', 'comp')
    span.end()
    const endEntry = sink.entries.find(e => e.message.includes('[span:end]'))!
    expect(endEntry.level).toBe('info')
  })

  it('becomes no-op after end()', () => {
    const span = new Span('op', 'comp')
    span.end()
    const afterEnd = sink.entries.length
    span.info('should be ignored')
    span.error('also ignored')
    expect(sink.entries.length).toBe(afterEnd)
  })

  it('end() is idempotent', () => {
    const span = new Span('op', 'comp')
    span.end()
    const count = sink.entries.length
    span.end()
    expect(sink.entries.length).toBe(count)
  })

  it('toContext() returns a valid TraceContext', () => {
    const parent = createTrace({ sessionId: 's1', machineId: 'm1' })
    const span = new Span('op', 'comp', parent)
    const ctx = span.toContext()

    expect(ctx.traceId).toBe(span.traceId)
    expect(ctx.sessionId).toBe('s1')
    expect(ctx.machineId).toBe('m1')
  })

  it('Logger.span() creates a Span', () => {
    const log = new Logger('my-comp')
    const span = log.span('my-operation')
    expect(span).toBeInstanceOf(Span)
    expect(span.name).toBe('my-operation')

    // Check it logs with the right component
    span.info('inside span')
    const entry = sink.entries.find(e => e.message === 'inside span')!
    expect(entry.component).toBe('my-comp')
  })
})
