import type { LogEntry, Level } from './types.js';
import { levelValue } from './types.js';
import { Sanitizer } from './sanitizer.js';
import { setIdGenerator } from './context.js';
import type { LogSink } from './sinks/types.js';

export interface InitTelemetryOptions {
  layer: string;
  minLevel?: Level;
  sinks: LogSink[];
  sanitize?: boolean;
  componentLevels?: Record<string, Level | 'off'>;
  generateId?: () => string;
}

export class LogCollector {
  private sinks: LogSink[] = [];
  private readonly sanitizer: Sanitizer;
  private readonly layer: string;
  private readonly minLevel: Level;
  private readonly sanitizeEnabled: boolean;
  private readonly componentLevels: Record<string, Level | 'off'>;

  constructor(opts: {
    layer: string;
    minLevel?: Level;
    sanitizer?: Sanitizer;
    sanitize?: boolean;
    componentLevels?: Record<string, Level | 'off'>;
  }) {
    this.layer = opts.layer;
    this.minLevel = opts.minLevel ?? 'debug';
    this.sanitizer = opts.sanitizer ?? new Sanitizer();
    this.sanitizeEnabled = opts.sanitize ?? true;
    this.componentLevels = opts.componentLevels ?? {};
  }

  get currentLayer(): string {
    return this.layer;
  }

  addSink(sink: LogSink): void {
    this.sinks.push(sink);
  }

  removeSink(sink: LogSink): void {
    const idx = this.sinks.indexOf(sink);
    if (idx !== -1) this.sinks.splice(idx, 1);
  }

  emit(entry: LogEntry): void {
    // Check component-level override
    const compLevel = this.componentLevels[entry.component];
    if (compLevel === 'off') return;
    if (compLevel && levelValue(entry.level) < levelValue(compLevel)) return;

    // Check global minimum level
    if (levelValue(entry.level) < levelValue(this.minLevel)) return;

    const toWrite = this.sanitizeEnabled ? this.sanitizer.process(entry) : entry;
    for (const sink of this.sinks) {
      try {
        sink.write(toWrite);
      } catch {
        /* sinks must not throw, but guard anyway */
      }
    }
  }

  async flush(): Promise<void> {
    await Promise.all(this.sinks.map(s => s.flush().catch(() => {})));
  }

  async close(): Promise<void> {
    await Promise.all(this.sinks.map(s => s.close().catch(() => {})));
    this.sinks = [];
  }

  getLogFilePath(): string | undefined {
    for (const sink of this.sinks) {
      if ('getFilePath' in sink && typeof (sink as any).getFilePath === 'function') {
        return (sink as any).getFilePath() as string;
      }
    }
    return undefined;
  }
}

// Global singleton
let _collector: LogCollector | undefined;
let _onCollectorReady: (() => void) | undefined;

export function initTelemetry(opts: InitTelemetryOptions): void {
  if (opts.generateId) {
    setIdGenerator(opts.generateId);
  }

  _collector = new LogCollector({
    layer: opts.layer,
    minLevel: opts.minLevel,
    sanitize: opts.sanitize,
    componentLevels: opts.componentLevels,
  });

  for (const sink of opts.sinks) {
    _collector.addSink(sink);
  }

  // Flush startup buffer
  if (_onCollectorReady) {
    _onCollectorReady();
  }
}

export function getCollector(): LogCollector {
  if (!_collector) {
    throw new Error('Telemetry not initialized. Call initTelemetry() first.');
  }
  return _collector;
}

export function isCollectorReady(): boolean {
  return _collector !== undefined;
}

/** @internal Used by Logger to register startup buffer flush callback */
export function _registerOnCollectorReady(fn: () => void): void {
  _onCollectorReady = fn;
}

/** @internal Reset global state (for testing) */
export function _resetTelemetry(): void {
  _collector = undefined;
  _onCollectorReady = undefined;
}
