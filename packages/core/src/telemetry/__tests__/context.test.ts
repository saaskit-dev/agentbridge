import { describe, it, expect, afterEach } from 'vitest'
import { createTrace, continueTrace, resumeTrace, injectTrace, extractTrace, setIdGenerator } from '../context.js'

describe('createTrace', () => {
  it('generates unique traceId and spanId', () => {
    const ctx = createTrace()
    expect(ctx.traceId).toBeTruthy()
    expect(ctx.spanId).toBeTruthy()
    expect(ctx.spanId.length).toBe(12)
    expect(ctx.parentSpanId).toBeUndefined()
  })

  it('includes sessionId and machineId when provided', () => {
    const ctx = createTrace({ sessionId: 'sess-1', machineId: 'mach-1' })
    expect(ctx.sessionId).toBe('sess-1')
    expect(ctx.machineId).toBe('mach-1')
  })

  it('generates different IDs each time', () => {
    const a = createTrace()
    const b = createTrace()
    expect(a.traceId).not.toBe(b.traceId)
    expect(a.spanId).not.toBe(b.spanId)
  })
})

describe('continueTrace', () => {
  it('inherits traceId and sets parentSpanId', () => {
    const parent = createTrace({ sessionId: 'sess-1' })
    const child = continueTrace({
      traceId: parent.traceId,
      spanId: parent.spanId,
      sessionId: parent.sessionId,
    })

    expect(child.traceId).toBe(parent.traceId)
    expect(child.spanId).not.toBe(parent.spanId)
    expect(child.parentSpanId).toBe(parent.spanId)
    expect(child.sessionId).toBe('sess-1')
  })
})

describe('resumeTrace', () => {
  it('preserves traceId and generates a fresh spanId (RFC §19.3 HTTP batch sync)', () => {
    const traceId = 'V1StGXR8_Z5jdHi6B-myT'
    const ctx = resumeTrace(traceId)
    expect(ctx.traceId).toBe(traceId)
    expect(ctx.spanId).toBeTruthy()
    expect(ctx.parentSpanId).toBeUndefined()
  })

  it('includes sessionId when provided', () => {
    const ctx = resumeTrace('abc', { sessionId: 'sess-1' })
    expect(ctx.sessionId).toBe('sess-1')
  })

  it('generates different spanIds across calls', () => {
    const a = resumeTrace('same-trace')
    const b = resumeTrace('same-trace')
    expect(a.traceId).toBe(b.traceId)
    expect(a.spanId).not.toBe(b.spanId)
  })
})

describe('injectTrace / extractTrace', () => {
  it('round-trips trace context through a carrier', () => {
    const ctx = createTrace({ sessionId: 'sess-1', machineId: 'mach-1' })
    const carrier: Record<string, unknown> = {}
    injectTrace(ctx, carrier)

    expect(carrier._trace).toBeDefined()

    const extracted = extractTrace(carrier)
    expect(extracted).toBeDefined()
    expect(extracted!.traceId).toBe(ctx.traceId)
    expect(extracted!.spanId).toBe(ctx.spanId)
    expect(extracted!.sessionId).toBe('sess-1')
    expect(extracted!.machineId).toBe('mach-1')
  })

  it('returns undefined for missing _trace', () => {
    expect(extractTrace({})).toBeUndefined()
  })

  it('returns undefined for malformed _trace', () => {
    expect(extractTrace({ _trace: 'not-an-object' })).toBeUndefined()
    expect(extractTrace({ _trace: { tid: 123 } })).toBeUndefined()
  })

  it('omits undefined optional fields in wire format', () => {
    const ctx = createTrace()
    const carrier: Record<string, unknown> = {}
    injectTrace(ctx, carrier)
    const wire = carrier._trace as Record<string, unknown>
    expect(wire.pid).toBeUndefined()
    expect(wire.ses).toBeUndefined()
    expect(wire.mid).toBeUndefined()
  })
})

describe('setIdGenerator (RFC §21.3)', () => {
  afterEach(() => {
    // Restore default generator after each test
    setIdGenerator(() => crypto.randomUUID())
  })

  it('custom generator is used for traceId and spanId', () => {
    let callCount = 0
    setIdGenerator(() => {
      callCount++
      return `custom-id-${callCount}-${'x'.repeat(32)}`
    })

    const ctx = createTrace()
    expect(ctx.traceId).toMatch(/^custom-id-/)
    expect(ctx.spanId).toHaveLength(12)  // slice(0, 12) of generated id
    expect(callCount).toBeGreaterThanOrEqual(2)  // traceId + spanId both call the generator
  })

  it('initTelemetry generateId option wires through to context', async () => {
    const { initTelemetry, _resetTelemetry } = await import('../collector.js')
    const { Logger } = await import('../logger.js')
    _resetTelemetry()
    Logger._reset()

    let called = false
    initTelemetry({
      layer: 'test',
      sinks: [],
      generateId: () => {
        called = true
        return crypto.randomUUID()
      },
    })

    // Calling createTrace should use our custom generator
    const ctx = createTrace()
    expect(called).toBe(true)
    expect(ctx.traceId).toBeTruthy()

    _resetTelemetry()
    Logger._reset()
    // Restore default
    setIdGenerator(() => crypto.randomUUID())
  })
})
