import type { LogEntry, Level } from '../types.js'
import type { LogSink } from './types.js'

const LEVEL_LABELS: Record<Level, string> = {
  debug: 'DBG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERR',
}

const COLORS: Record<Level, string> = {
  debug: '\x1b[90m',   // gray
  info: '\x1b[36m',    // cyan
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
}
const RESET = '\x1b[0m'

export class ConsoleSink implements LogSink {
  readonly name = 'console'
  private readonly color: boolean
  private readonly compact: boolean

  constructor(opts?: { color?: boolean; compact?: boolean }) {
    this.color = opts?.color ?? true
    this.compact = opts?.compact ?? true
  }

  write(entry: LogEntry): void {
    try {
      const output = this.compact ? this.formatCompact(entry) : this.formatFull(entry)
      if (entry.level === 'error') {
        console.error(output)
      } else if (entry.level === 'warn') {
        console.warn(output)
      } else {
        console.log(output)
      }
    } catch { /* never throw */ }
  }

  async flush(): Promise<void> {}
  async close(): Promise<void> {}

  private formatCompact(entry: LogEntry): string {
    const time = entry.timestamp.slice(11, 23) // HH:mm:ss.SSS
    const label = LEVEL_LABELS[entry.level].padEnd(4)
    const comp = entry.component.padEnd(6).slice(0, 6)
    const msg = entry.message

    let extra = ''
    if (entry.traceId) extra += ` trace=${entry.traceId.slice(0, 8)}`
    if (entry.sessionId) extra += ` session=${entry.sessionId.slice(0, 8)}`
    if (entry.durationMs != null) extra += ` ${entry.durationMs}ms`
    if (entry.data) {
      for (const [k, v] of Object.entries(entry.data)) {
        extra += ` ${k}=${String(v)}`
      }
    }
    if (entry.error) {
      extra += ` error="${entry.error.message}"`
    }

    const line = `${time} [${label}] ${comp} | ${msg}${extra}`
    if (this.color) {
      return `${COLORS[entry.level]}${line}${RESET}`
    }
    return line
  }

  private formatFull(entry: LogEntry): string {
    return JSON.stringify(entry, null, 2)
  }
}
