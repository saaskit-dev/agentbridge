import type { LogEntry, Level } from '../types.js';
import { levelValue } from '../types.js';
import { Sanitizer } from '../sanitizer.js';
import type { LogSink } from './types.js';
import type { RemoteBackend, DeviceMetadata } from './backends/types.js';

export interface RemoteSinkOptions {
  backend: RemoteBackend;
  batchSize?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  minLevel?: Level;
  metadata: DeviceMetadata;
  /**
   * Optional extra sanitizer applied after the built-in sanitizer (RFC §6.3).
   * Use for more aggressive redaction before data leaves the device, e.g.:
   *   new Sanitizer({ extraSensitiveKeys: ['sessionId'], maxStringLength: 200 })
   */
  extraSanitizer?: Sanitizer;
}

export class RemoteSink implements LogSink {
  readonly name = 'remote';
  private readonly sanitizer = new Sanitizer();
  private readonly extraSanitizer: Sanitizer | undefined;
  private readonly backend: RemoteBackend;
  private readonly batchSize: number;
  private readonly maxBufferSize: number;
  private readonly minLevel: Level;
  private readonly metadata: DeviceMetadata;
  private buffer: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(opts: RemoteSinkOptions) {
    this.backend = opts.backend;
    this.batchSize = opts.batchSize ?? 50;
    this.maxBufferSize = opts.maxBufferSize ?? 500;
    this.minLevel = opts.minLevel ?? 'debug';
    this.metadata = opts.metadata;
    this.extraSanitizer = opts.extraSanitizer;

    const intervalMs = opts.flushIntervalMs ?? 30_000;
    this.flushTimer = setInterval(() => {
      void this.doFlush().catch(() => undefined);
    }, intervalMs);
    if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      (this.flushTimer as NodeJS.Timeout).unref();
    }
  }

  write(entry: LogEntry): void {
    if (levelValue(entry.level) < levelValue(this.minLevel)) return;

    // Always sanitize before buffering (RFC §19.5) — RemoteSink ALWAYS sanitizes
    let sanitized = this.sanitizer.process(entry);
    // Apply extra sanitizer if provided (RFC §6.3) — additional aggressive redaction
    if (this.extraSanitizer) {
      sanitized = this.extraSanitizer.process(sanitized);
    }
    this.buffer.push(sanitized);

    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.splice(0, this.buffer.length - this.maxBufferSize);
    }

    if (this.buffer.length >= this.batchSize) {
      void this.doFlush().catch(() => undefined);
    }
  }

  async flush(): Promise<void> {
    await this.doFlush();
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Drain all remaining batches on shutdown
    while (this.buffer.length > 0) {
      const before = this.buffer.length;
      await this.doFlush();
      // If doFlush made no progress (backend not ready / network error), stop
      if (this.buffer.length >= before) break;
    }
  }

  private async doFlush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.buffer.length > 0) {
        const batch = this.buffer.splice(0, this.batchSize);

        const request = this.backend.buildRequest(batch, this.metadata);
        if (!request) {
          // Backend not ready (e.g. no auth token), put entries back
          this.buffer.unshift(...batch);
          return;
        }

        try {
          const res = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
          });
          if (!res.ok) {
            // Server error — put entries back for next retry cycle
            this.buffer.unshift(...batch);
            return;
          }
        } catch {
          // Network error — put entries back for next retry cycle
          this.buffer.unshift(...batch);
          return;
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
