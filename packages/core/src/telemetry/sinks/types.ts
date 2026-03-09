import type { LogEntry } from '../types.js'

export interface LogSink {
  readonly name: string
  write(entry: LogEntry): void
  flush(): Promise<void>
  close(): Promise<void>
}
