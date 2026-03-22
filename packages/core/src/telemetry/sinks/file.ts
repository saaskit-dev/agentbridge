import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogEntry } from '../types.js';
import type { LogSink } from './types.js';

export interface FileSinkOptions {
  dir: string;
  prefix: string;
  maxFiles?: number;
  /** Sync mode for CLI/daemon (0), async mode for server (>0, flush interval ms) */
  bufferFlushMs?: number;
}

export class FileSink implements LogSink {
  readonly name = 'file';
  private filePath: string;
  private currentSize = 0;
  private readonly dir: string;
  private readonly prefix: string;
  private readonly maxFiles: number;
  private readonly bufferFlushMs: number;
  private writeBuffer: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushInProgress = false;
  private droppedCount = 0;

  constructor(opts: FileSinkOptions) {
    this.dir = opts.dir;
    this.prefix = opts.prefix;
    this.maxFiles = opts.maxFiles ?? 10;
    this.bufferFlushMs = opts.bufferFlushMs ?? 100;

    try {
      mkdirSync(this.dir, { recursive: true });
    } catch {
      /* may already exist */
    }

    this.filePath = this.getCurrentHourFilePath();
    this.currentSize = this.getExistingFileSize(this.filePath);

    // Cleanup old files on init
    this.cleanupOldFiles();

    if (this.bufferFlushMs > 0) {
      this.flushTimer = setInterval(() => this.flushBuffer(), this.bufferFlushMs);
      if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
        (this.flushTimer as NodeJS.Timeout).unref();
      }
    }
  }

  getFilePath(): string {
    return this.filePath;
  }

  write(entry: LogEntry): void {
    const line = JSON.stringify(entry) + '\n';

    if (this.bufferFlushMs === 0) {
      // Sync mode (CLI/Daemon)
      this.writeSync(line);
    } else {
      // Async mode (Server)
      this.writeBuffer.push(line);
    }
  }

  async flush(): Promise<void> {
    await this.flushBuffer();
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Sync drain on close
    if (this.writeBuffer.length > 0) {
      const batch = this.writeBuffer.join('');
      this.writeBuffer = [];
      try {
        appendFileSync(this.filePath, batch);
      } catch {
        /* best effort */
      }
    }
  }

  private writeSync(line: string): void {
    try {
      this.checkRotation();
      appendFileSync(this.filePath, line);
      this.currentSize += line.length;
    } catch {
      this.droppedCount++;
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.flushInProgress || this.writeBuffer.length === 0) return;
    this.flushInProgress = true;
    try {
      const batch = this.writeBuffer.join('');
      this.writeBuffer = [];
      try {
        this.checkRotation();
        await appendFile(this.filePath, batch);
        this.currentSize += batch.length;
      } catch {
        this.droppedCount += batch.split('\n').length - 1;
      }
    } finally {
      this.flushInProgress = false;
    }
  }

  private checkRotation(): void {
    const newPath = this.getCurrentHourFilePath();
    if (newPath === this.filePath) return;

    // Hour changed - rotate to new file
    this.filePath = newPath;
    this.currentSize = 0;

    // Cleanup old files
    this.cleanupOldFiles();
  }

  private cleanupOldFiles(): void {
    try {
      const files = readdirSync(this.dir)
        .filter(f => f.startsWith(this.prefix) && f.endsWith('.jsonl'))
        .map(f => {
          try {
            const path = join(this.dir, f);
            return { name: f, path, mtime: statSync(path).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((f): f is { name: string; path: string; mtime: number } => f !== null)
        .sort((a, b) => b.mtime - a.mtime); // newest first

      for (const file of files.slice(this.maxFiles)) {
        try {
          unlinkSync(file.path);
        } catch {
          /* best effort */
        }
      }
    } catch {
      /* cleanup is non-critical */
    }
  }

  private getCurrentHourFilePath(): string {
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}`;
    return join(this.dir, `${this.prefix}-${ts}.jsonl`);
  }

  private getExistingFileSize(path: string): number {
    try {
      if (existsSync(path)) {
        return statSync(path).size;
      }
    } catch {
      /* ignore */
    }
    return 0;
  }
}
