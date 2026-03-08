import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LogEntry } from '../types.js'
import type { LogSink } from './types.js'

export interface FileSinkOptions {
  dir: string
  prefix: string
  maxFileSize?: number
  maxFiles?: number
  bufferFlushMs?: number
}

export class FileSink implements LogSink {
  readonly name = 'file'
  private filePath: string
  private currentSize = 0
  private readonly dir: string
  private readonly prefix: string
  private readonly maxFileSize: number
  private readonly maxFiles: number
  private readonly bufferFlushMs: number
  private writeBuffer: string[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private flushInProgress = false
  private droppedCount = 0
  private fileCounter = 0

  constructor(opts: FileSinkOptions) {
    this.dir = opts.dir
    this.prefix = opts.prefix
    this.maxFileSize = opts.maxFileSize ?? 50 * 1024 * 1024
    this.maxFiles = opts.maxFiles ?? 10
    this.bufferFlushMs = opts.bufferFlushMs ?? 100

    try { mkdirSync(this.dir, { recursive: true }) } catch { /* may already exist */ }

    this.filePath = this.createFilePath()
    this.currentSize = 0

    if (this.bufferFlushMs > 0) {
      this.flushTimer = setInterval(() => this.flushBuffer(), this.bufferFlushMs)
      if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
        ;(this.flushTimer as NodeJS.Timeout).unref()
      }
    }
  }

  getFilePath(): string {
    return this.filePath
  }

  write(entry: LogEntry): void {
    const line = JSON.stringify(entry) + '\n'

    if (this.bufferFlushMs === 0) {
      // Sync mode (CLI/Daemon)
      this.writeSync(line)
    } else {
      // Async mode (Server)
      this.writeBuffer.push(line)
    }
  }

  async flush(): Promise<void> {
    await this.flushBuffer()
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    // Sync drain on close
    if (this.writeBuffer.length > 0) {
      const batch = this.writeBuffer.join('')
      this.writeBuffer = []
      try { appendFileSync(this.filePath, batch) } catch { /* best effort */ }
    }
  }

  private writeSync(line: string): void {
    try {
      this.checkRotation(line.length)
      appendFileSync(this.filePath, line)
      this.currentSize += line.length
    } catch {
      this.droppedCount++
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.flushInProgress || this.writeBuffer.length === 0) return
    this.flushInProgress = true
    try {
      const batch = this.writeBuffer.join('')
      this.writeBuffer = []
      try {
        this.checkRotation(batch.length)
        await appendFile(this.filePath, batch)
        this.currentSize += batch.length
      } catch {
        this.droppedCount += batch.split('\n').length - 1
      }
    } finally {
      this.flushInProgress = false
    }
  }

  private checkRotation(incomingSize: number): void {
    if (this.currentSize + incomingSize <= this.maxFileSize) return

    // Rotate: create new file
    this.filePath = this.createFilePath()
    this.currentSize = 0

    // Cleanup old files
    this.cleanupOldFiles()
  }

  private cleanupOldFiles(): void {
    try {
      const files = readdirSync(this.dir)
        .filter(f => f.startsWith(this.prefix) && f.endsWith('.jsonl'))
        .map(f => {
          // Guard each statSync: file may be concurrently deleted by another process.
          // Without this, a single failed stat aborts the entire cleanup.
          try {
            const path = join(this.dir, f)
            return { name: f, path, mtime: statSync(path).mtimeMs }
          } catch {
            return null
          }
        })
        .filter((f): f is { name: string; path: string; mtime: number } => f !== null)
        .sort((a, b) => b.mtime - a.mtime) // newest first

      for (const file of files.slice(this.maxFiles)) {
        try { unlinkSync(file.path) } catch { /* best effort */ }
      }
    } catch { /* cleanup is non-critical */ }
  }

  private createFilePath(): string {
    const now = new Date()
    const ts = now.toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '-')
      .replace('Z', '')
    const pid = typeof process !== 'undefined' ? process.pid : 0
    // Counter ensures unique filename even when two rotations happen within the same millisecond
    const counter = this.fileCounter++
    const suffix = counter === 0 ? '' : `-${counter}`
    return join(this.dir, `${this.prefix}-${ts}-${pid}${suffix}.jsonl`)
  }
}
