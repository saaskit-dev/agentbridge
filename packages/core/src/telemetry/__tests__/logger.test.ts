import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Logger, setGlobalContextProvider } from '../logger.js';
import { initTelemetry, _resetTelemetry } from '../collector.js';
import { createTrace } from '../context.js';
import { Span } from '../span.js';
import type { LogEntry } from '../types.js';
import type { LogSink } from '../sinks/types.js';

function makeSink(): LogSink & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    name: 'test',
    entries,
    write(entry: LogEntry) {
      entries.push(entry);
    },
    async flush() {},
    async close() {},
  };
}

describe('Logger', () => {
  let sink: ReturnType<typeof makeSink>;

  beforeEach(() => {
    _resetTelemetry();
    Logger._reset();
    sink = makeSink();
    initTelemetry({ layer: 'test', sinks: [sink], sanitize: false });
  });

  it('logs at all four levels', () => {
    const log = new Logger('comp');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(sink.entries.map(e => e.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('sets component name on every entry', () => {
    const log = new Logger('my-component');
    log.info('hello');
    expect(sink.entries[0].component).toBe('my-component');
  });

  it('sets layer from collector', () => {
    const log = new Logger('x');
    log.info('hello');
    expect(sink.entries[0].layer).toBe('test');
  });

  it('includes data when provided', () => {
    const log = new Logger('x');
    log.info('msg', { foo: 'bar', count: 42 });
    expect(sink.entries[0].data).toEqual({ foo: 'bar', count: 42 });
  });

  it('includes error details', () => {
    const log = new Logger('x');
    const err = new Error('boom');
    log.error('failed', err, { context: 'test' });

    const entry = sink.entries[0];
    expect(entry.error!.message).toBe('boom');
    expect(entry.error!.stack).toContain('boom');
    expect(entry.data).toEqual({ context: 'test' });
  });

  it('generates ISO 8601 timestamps', () => {
    const log = new Logger('x');
    log.info('hello');
    expect(sink.entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('Logger.span()', () => {
  let sink: ReturnType<typeof makeSink>;

  beforeEach(() => {
    _resetTelemetry();
    Logger._reset();
    sink = makeSink();
    initTelemetry({ layer: 'test', sinks: [sink], sanitize: false });
  });

  it('returns a Span instance with correct component', () => {
    const log = new Logger('my-service');
    const span = log.span('db-query');
    expect(span).toBeInstanceOf(Span);
    expect(span.name).toBe('db-query');
  });

  it('emits [span:start] at debug level on creation', () => {
    const log = new Logger('svc');
    log.span('fetch');
    const start = sink.entries.find(e => e.message.includes('[span:start]'));
    expect(start).toBeDefined();
    expect(start!.level).toBe('debug');
  });

  it('emits [span:end] at info level with durationMs on end()', () => {
    const log = new Logger('svc');
    const span = log.span('op');
    span.end();
    const end = sink.entries.find(e => e.message.includes('[span:end]'));
    expect(end).toBeDefined();
    expect(end!.level).toBe('info');
    expect(typeof end!.durationMs).toBe('number');
  });

  it('propagates parent trace context when provided', () => {
    const log = new Logger('svc');
    const ctx = createTrace({ sessionId: 'sess-42' });
    const span = log.span('child-op', ctx);
    expect(span.traceId).toBe(ctx.traceId);
  });

  it('does not emit a second [span:end] if end() called twice', () => {
    const log = new Logger('svc');
    const span = log.span('op');
    span.end();
    span.end();
    const ends = sink.entries.filter(e => e.message.includes('[span:end]'));
    expect(ends).toHaveLength(1);
  });
});

describe('ScopedLogger (withContext)', () => {
  let sink: ReturnType<typeof makeSink>;

  beforeEach(() => {
    _resetTelemetry();
    Logger._reset();
    sink = makeSink();
    initTelemetry({ layer: 'server', sinks: [sink], sanitize: false });
  });

  it('attaches trace context to all entries', () => {
    const log = new Logger('socket');
    const ctx = createTrace({ sessionId: 'sess-1' });
    const scoped = log.withContext(ctx);

    scoped.info('received message');
    scoped.warn('slow response');

    for (const entry of sink.entries) {
      expect(entry.traceId).toBe(ctx.traceId);
      expect(entry.sessionId).toBe('sess-1');
    }
  });

  it('exposes context for downstream passing', () => {
    const log = new Logger('x');
    const ctx = createTrace();
    const scoped = log.withContext(ctx);
    expect(scoped.context).toBe(ctx);
  });
});

describe('setGlobalContextProvider', () => {
  let sink: ReturnType<typeof makeSink>;

  beforeEach(() => {
    _resetTelemetry();
    Logger._reset();
    sink = makeSink();
    initTelemetry({ layer: 'cli', sinks: [sink], sanitize: false });
  });

  afterEach(() => {
    // Clear the global provider after each test to avoid leaking state
    setGlobalContextProvider(undefined);
  });

  it('automatically attaches trace context from global provider to all log calls', () => {
    const ctx = createTrace({ sessionId: 'turn-123' });
    setGlobalContextProvider(() => ctx);

    const log = new Logger('daemon/loop');
    log.info('starting message processing');
    log.debug('tool call received');

    for (const entry of sink.entries) {
      expect(entry.traceId).toBe(ctx.traceId);
      expect(entry.sessionId).toBe('turn-123');
    }
  });

  it('explicit withContext() takes priority over global provider', () => {
    const globalCtx = createTrace({ sessionId: 'global' });
    const explicitCtx = createTrace({ sessionId: 'explicit' });
    setGlobalContextProvider(() => globalCtx);

    const log = new Logger('x');
    const scoped = log.withContext(explicitCtx);
    scoped.info('msg');

    expect(sink.entries[0].sessionId).toBe('explicit');
    expect(sink.entries[0].traceId).toBe(explicitCtx.traceId);
  });

  it('no trace on entries when provider returns undefined', () => {
    setGlobalContextProvider(() => undefined);

    const log = new Logger('x');
    log.info('msg');

    expect(sink.entries[0].traceId).toBeUndefined();
  });

  it('provider can be cleared by passing undefined', () => {
    const ctx = createTrace();
    setGlobalContextProvider(() => ctx);
    setGlobalContextProvider(undefined);

    const log = new Logger('x');
    log.info('msg');

    expect(sink.entries[0].traceId).toBeUndefined();
  });
});

describe('Logger startup buffer', () => {
  beforeEach(() => {
    _resetTelemetry();
    Logger._reset();
  });

  it('buffers entries before initTelemetry', () => {
    const log = new Logger('early');
    log.info('first');
    log.warn('second');

    const sink = makeSink();
    initTelemetry({ layer: 'cli', sinks: [sink], sanitize: false });

    expect(sink.entries).toHaveLength(2);
    expect(sink.entries[0].message).toBe('first');
    expect(sink.entries[1].message).toBe('second');
  });

  it('logs directly after initTelemetry', () => {
    const sink = makeSink();
    initTelemetry({ layer: 'cli', sinks: [sink], sanitize: false });

    const log = new Logger('late');
    log.info('after init');

    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0].message).toBe('after init');
  });

  it('buffered entries have layer=unknown', () => {
    const log = new Logger('x');
    log.info('before');

    const sink = makeSink();
    initTelemetry({ layer: 'test', sinks: [sink], sanitize: false });

    expect(sink.entries[0].layer).toBe('unknown');
  });
});
