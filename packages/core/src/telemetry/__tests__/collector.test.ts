import { describe, it, expect, beforeEach } from 'vitest';
import { LogCollector, initTelemetry, getCollector, _resetTelemetry } from '../collector.js';
import type { LogEntry } from '../types.js';
import type { LogSink } from '../sinks/types.js';
import { Logger } from '../logger.js';

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

function makeEntry(overrides?: Partial<LogEntry>): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level: 'info',
    layer: 'test',
    component: 'test',
    message: 'test',
    ...overrides,
  };
}

describe('LogCollector', () => {
  beforeEach(() => {
    _resetTelemetry();
    Logger._reset();
  });

  it('dispatches entries to all registered sinks', () => {
    const sink1 = makeSink();
    const sink2 = makeSink();
    const collector = new LogCollector({ layer: 'test' });
    collector.addSink(sink1);
    collector.addSink(sink2);

    collector.emit(makeEntry({ message: 'hello' }));

    expect(sink1.entries).toHaveLength(1);
    expect(sink2.entries).toHaveLength(1);
    expect(sink1.entries[0].message).toBe('hello');
  });

  it('filters entries below minLevel', () => {
    const sink = makeSink();
    const collector = new LogCollector({ layer: 'test', minLevel: 'warn' });
    collector.addSink(sink);

    collector.emit(makeEntry({ level: 'debug' }));
    collector.emit(makeEntry({ level: 'info' }));
    collector.emit(makeEntry({ level: 'warn' }));
    collector.emit(makeEntry({ level: 'error' }));

    expect(sink.entries).toHaveLength(2);
    expect(sink.entries[0].level).toBe('warn');
    expect(sink.entries[1].level).toBe('error');
  });

  it('supports componentLevels overrides', () => {
    const sink = makeSink();
    const collector = new LogCollector({
      layer: 'test',
      minLevel: 'debug',
      componentLevels: {
        noisy: 'warn',
        silent: 'off',
      },
    });
    collector.addSink(sink);

    collector.emit(makeEntry({ component: 'noisy', level: 'info' }));
    collector.emit(makeEntry({ component: 'noisy', level: 'warn' }));
    collector.emit(makeEntry({ component: 'silent', level: 'error' }));
    collector.emit(makeEntry({ component: 'normal', level: 'debug' }));

    expect(sink.entries).toHaveLength(2);
    expect(sink.entries[0].component).toBe('noisy');
    expect(sink.entries[0].level).toBe('warn');
    expect(sink.entries[1].component).toBe('normal');
  });

  it('sanitizes entries by default', () => {
    const sink = makeSink();
    const collector = new LogCollector({ layer: 'test' });
    collector.addSink(sink);

    collector.emit(makeEntry({ data: { token: 'secret' } }));

    expect(sink.entries[0].data!.token).toBe('[REDACTED]');
  });

  it('skips sanitization when sanitize=false', () => {
    const sink = makeSink();
    const collector = new LogCollector({ layer: 'test', sanitize: false });
    collector.addSink(sink);

    collector.emit(makeEntry({ data: { token: 'secret' } }));

    expect(sink.entries[0].data!.token).toBe('secret');
  });

  it('removeSink stops dispatching to that sink', () => {
    const sink = makeSink();
    const collector = new LogCollector({ layer: 'test' });
    collector.addSink(sink);
    collector.emit(makeEntry());
    expect(sink.entries).toHaveLength(1);

    collector.removeSink(sink);
    collector.emit(makeEntry());
    expect(sink.entries).toHaveLength(1);
  });

  it('does not throw when a sink throws', () => {
    const badSink: LogSink = {
      name: 'bad',
      write() {
        throw new Error('boom');
      },
      async flush() {},
      async close() {},
    };
    const goodSink = makeSink();
    const collector = new LogCollector({ layer: 'test' });
    collector.addSink(badSink);
    collector.addSink(goodSink);

    expect(() => collector.emit(makeEntry())).not.toThrow();
    expect(goodSink.entries).toHaveLength(1);
  });
});

describe('LogCollector.getLogFilePath()', () => {
  it('returns file path from a FileSink-like sink (duck typing)', () => {
    const fileLikeSink: LogSink & { getFilePath(): string } = {
      name: 'file',
      write(_: LogEntry) {},
      async flush() {},
      async close() {},
      getFilePath: () => '/tmp/test-logs/cli.jsonl',
    };
    const collector = new LogCollector({ layer: 'test' });
    collector.addSink(fileLikeSink);
    expect(collector.getLogFilePath()).toBe('/tmp/test-logs/cli.jsonl');
  });

  it('returns undefined when no sink has getFilePath', () => {
    const collector = new LogCollector({ layer: 'test' });
    collector.addSink(makeSink());
    expect(collector.getLogFilePath()).toBeUndefined();
  });

  it('returns path from first matching sink when multiple sinks exist', () => {
    const first: LogSink & { getFilePath(): string } = {
      name: 'file1',
      write(_: LogEntry) {},
      async flush() {},
      async close() {},
      getFilePath: () => '/tmp/first.jsonl',
    };
    const second: LogSink & { getFilePath(): string } = {
      name: 'file2',
      write(_: LogEntry) {},
      async flush() {},
      async close() {},
      getFilePath: () => '/tmp/second.jsonl',
    };
    const collector = new LogCollector({ layer: 'test' });
    collector.addSink(first);
    collector.addSink(second);
    expect(collector.getLogFilePath()).toBe('/tmp/first.jsonl');
  });

  it('returns undefined after the FileSink-like sink is removed', () => {
    const fileLikeSink: LogSink & { getFilePath(): string } = {
      name: 'file',
      write(_: LogEntry) {},
      async flush() {},
      async close() {},
      getFilePath: () => '/tmp/test.jsonl',
    };
    const collector = new LogCollector({ layer: 'test' });
    collector.addSink(fileLikeSink);
    expect(collector.getLogFilePath()).toBe('/tmp/test.jsonl');
    collector.removeSink(fileLikeSink);
    expect(collector.getLogFilePath()).toBeUndefined();
  });
});

describe('initTelemetry / getCollector', () => {
  beforeEach(() => {
    _resetTelemetry();
    Logger._reset();
  });

  it('throws before initialization', () => {
    expect(() => getCollector()).toThrow('Telemetry not initialized');
  });

  it('returns collector after initialization', () => {
    const sink = makeSink();
    initTelemetry({ layer: 'cli', sinks: [sink] });

    const collector = getCollector();
    expect(collector.currentLayer).toBe('cli');
  });

  it('flushes Logger startup buffer on init', () => {
    const sink = makeSink();

    // Log before init
    const log = new Logger('early');
    log.info('before init');

    expect(sink.entries).toHaveLength(0);

    // Init flushes the buffer
    initTelemetry({ layer: 'test', sinks: [sink] });

    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0].message).toBe('before init');
    expect(sink.entries[0].component).toBe('early');
  });
});
