import type { LogEntry, LogSink } from '@saaskit-dev/agentbridge/telemetry';
import { appendDesktopAppLogs } from '@/utils/tauri';

const DEFAULT_FLUSH_INTERVAL_MS = 750;
const MAX_BUFFERED_LINES = 200;

export class DesktopFileSink implements LogSink {
  readonly name = 'desktop-file';

  private readonly flushIntervalMs: number;
  private readonly maxBufferedLines: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushInProgress = false;
  private writeBuffer: string[] = [];

  constructor(opts?: { flushIntervalMs?: number; maxBufferedLines?: number }) {
    this.flushIntervalMs = opts?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBufferedLines = opts?.maxBufferedLines ?? MAX_BUFFERED_LINES;

    if (typeof setInterval === 'function') {
      this.flushTimer = setInterval(() => {
        void this.flush().catch(() => undefined);
      }, this.flushIntervalMs);
    }
  }

  write(entry: LogEntry): void {
    this.writeBuffer.push(JSON.stringify(entry));

    if (this.writeBuffer.length >= this.maxBufferedLines) {
      void this.flush().catch(() => undefined);
    }
  }

  async flush(): Promise<void> {
    if (this.flushInProgress || this.writeBuffer.length === 0) {
      return;
    }

    this.flushInProgress = true;
    try {
      const lines = this.writeBuffer;
      this.writeBuffer = [];
      await appendDesktopAppLogs(lines);
    } catch {
      // Local log persistence must stay best-effort and never break app telemetry.
    } finally {
      this.flushInProgress = false;
    }
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();
  }
}
