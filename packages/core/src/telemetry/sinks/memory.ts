import type { LogEntry, LogFilter } from '../types.js';
import type { LogSink } from './types.js';

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface MemorySinkOptions {
  maxEntries?: number;
  persistence?: {
    storage: AsyncStorageLike;
    key?: string;
    maxPersistedEntries?: number;
    flushIntervalMs?: number;
  };
}

export class MemorySink implements LogSink {
  readonly name = 'memory';
  private entries: LogEntry[] = [];
  private readonly maxEntries: number;
  private readonly listeners = new Set<(entry: LogEntry) => void>();
  private readonly persistence?: MemorySinkOptions['persistence'];
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private persistenceLoaded = false;

  constructor(opts?: MemorySinkOptions) {
    this.maxEntries = opts?.maxEntries ?? 10_000;
    this.persistence = opts?.persistence;

    if (this.persistence) {
      const intervalMs = this.persistence.flushIntervalMs ?? 5_000;
      this.persistTimer = setInterval(() => this.persistToDisk(), intervalMs);
      if (
        this.persistTimer &&
        typeof this.persistTimer === 'object' &&
        'unref' in this.persistTimer
      ) {
        (this.persistTimer as NodeJS.Timeout).unref();
      }
    }
  }

  write(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    this.dirty = true;
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        /* listener must not throw */
      }
    }
  }

  async flush(): Promise<void> {
    await this.persistToDisk();
  }

  async close(): Promise<void> {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persistToDisk();
    this.listeners.clear();
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  query(filter: LogFilter): LogEntry[] {
    return this.entries.filter(entry => {
      if (filter.traceId && entry.traceId !== filter.traceId) return false;
      if (filter.sessionId && entry.sessionId !== filter.sessionId) return false;
      if (filter.component && entry.component !== filter.component) return false;

      if (filter.level) {
        const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
        if (!levels.includes(entry.level)) return false;
      }

      if (filter.since && entry.timestamp < filter.since) return false;
      if (filter.until && entry.timestamp > filter.until) return false;

      if (filter.search && !entry.message.toLowerCase().includes(filter.search.toLowerCase())) {
        return false;
      }

      return true;
    });
  }

  onChange(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  exportJsonl(): string {
    return this.entries.map(e => JSON.stringify(e)).join('\n');
  }

  clear(): void {
    this.entries = [];
    this.dirty = true;
  }

  async loadPersistedEntries(): Promise<void> {
    if (!this.persistence || this.persistenceLoaded) return;
    this.persistenceLoaded = true;
    try {
      const key = this.persistence.key ?? '@telemetry/logs';
      const raw = await this.persistence.storage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as LogEntry[];
      if (Array.isArray(parsed)) {
        this.entries = [...parsed, ...this.entries];
        if (this.entries.length > this.maxEntries) {
          this.entries.splice(0, this.entries.length - this.maxEntries);
        }
      }
    } catch {
      /* corrupted data, ignore */
    }
  }

  private async persistToDisk(): Promise<void> {
    if (!this.persistence || !this.dirty) return;
    this.dirty = false;
    try {
      const key = this.persistence.key ?? '@telemetry/logs';
      const max = this.persistence.maxPersistedEntries ?? 2_000;
      const toPersist = this.entries.slice(-max);
      await this.persistence.storage.setItem(key, JSON.stringify(toPersist));
    } catch {
      /* persistence failure is non-fatal */
    }
  }
}
