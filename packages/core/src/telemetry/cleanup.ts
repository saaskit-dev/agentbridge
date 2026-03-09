import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export interface CleanupOptions {
  dir: string
  maxAgeDays?: number
  maxTotalSizeMB?: number
}

export function cleanupOldLogs(opts: CleanupOptions): void {
  const maxAgeDays = opts.maxAgeDays ?? 7
  const maxTotalSizeMB = opts.maxTotalSizeMB ?? 500
  const maxTotalSize = maxTotalSizeMB * 1024 * 1024
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
  const now = Date.now()

  try {
    const files = readdirSync(opts.dir)
      .filter(f => f.endsWith('.jsonl') || f.endsWith('.log'))
      .map(f => {
        // Wrap statSync individually: a file may be deleted by another process
        // between readdirSync and statSync. Without this guard, the entire cleanup
        // would abort silently (caught by the outer try-catch) and no files would
        // be cleaned up at all.
        try {
          const path = join(opts.dir, f)
          const stat = statSync(path)
          return { path, size: stat.size, mtimeMs: stat.mtimeMs }
        } catch {
          return null
        }
      })
      .filter((f): f is { path: string; size: number; mtimeMs: number } => f !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs) // newest first

    let totalSize = 0

    for (const file of files) {
      const age = now - file.mtimeMs

      // Delete if too old
      if (age > maxAgeMs) {
        try { unlinkSync(file.path) } catch { /* best effort */ }
        continue
      }

      totalSize += file.size

      // Delete oldest files that push total over the size cap.
      // Because we iterate newest-first, the current file is the oldest retained so far.
      // After deleting, subtract its size so subsequent files are judged against the
      // correct remaining-disk-usage (prevents over-aggressive deletion).
      if (totalSize > maxTotalSize) {
        try {
          unlinkSync(file.path)
          totalSize -= file.size
        } catch { /* best effort */ }
      }
    }
  } catch { /* cleanup is non-critical */ }
}
