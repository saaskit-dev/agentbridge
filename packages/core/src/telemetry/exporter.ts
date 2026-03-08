import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import type { LogEntry } from './types.js'
import { Sanitizer } from './sanitizer.js'

export interface ExportOptions {
  logDirs: string[]
  outputPath: string
  traceId?: string
  sessionId?: string
  since?: string
  environment?: Record<string, unknown>
}

export interface ExportResult {
  entriesCount: number
  outputPath: string
}

export function exportDiagnostic(opts: ExportOptions): ExportResult {
  const sanitizer = new Sanitizer()
  const allEntries: LogEntry[] = []

  // Read JSONL files from all log directories
  for (const dir of opts.logDirs) {
    try {
      const files = readdirSync(dir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => join(dir, f))

      for (const file of files) {
        try {
          const content = readFileSync(file, 'utf-8')
          for (const line of content.split('\n')) {
            if (!line.trim()) continue
            try {
              const entry = JSON.parse(line) as LogEntry
              allEntries.push(entry)
            } catch { /* skip malformed lines */ }
          }
        } catch { /* skip unreadable files */ }
      }
    } catch { /* skip unreadable dirs */ }
  }

  // Filter
  let filtered = allEntries
  if (opts.traceId) {
    filtered = filtered.filter(e => e.traceId === opts.traceId)
  }
  if (opts.sessionId) {
    filtered = filtered.filter(e => e.sessionId === opts.sessionId)
  }
  if (opts.since) {
    filtered = filtered.filter(e => e.timestamp >= opts.since!)
  }

  // Sort by timestamp
  filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  // Sanitize
  const sanitized = filtered.map(e => sanitizer.process(e))

  // Build zip contents
  const zipFiles: ZipFile[] = [
    {
      name: 'logs.jsonl',
      data: Buffer.from(sanitized.map(e => JSON.stringify(e)).join('\n'), 'utf-8'),
    },
    {
      name: 'environment.json',
      data: Buffer.from(JSON.stringify(opts.environment ?? {}, null, 2), 'utf-8'),
    },
  ]

  // Write zip
  const outputPath = opts.outputPath.endsWith('.zip') ? opts.outputPath : opts.outputPath + '.zip'
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, buildZip(zipFiles))

  return {
    entriesCount: sanitized.length,
    outputPath,
  }
}

// --- Minimal ZIP builder (no external dependencies) ---

interface ZipFile {
  name: string
  data: Buffer
}

function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function buildZip(files: ZipFile[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf-8')
    const compressed = deflateRawSync(file.data)
    const crc = crc32(file.data)

    // Local file header (30 bytes + filename)
    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)                 // signature
    local.writeUInt16LE(20, 4)                          // version needed (2.0)
    local.writeUInt16LE(0, 6)                           // flags
    local.writeUInt16LE(8, 8)                           // compression: deflate
    local.writeUInt16LE(0, 10)                          // mod time
    local.writeUInt16LE(0, 12)                          // mod date
    local.writeUInt32LE(crc, 14)                        // crc-32
    local.writeUInt32LE(compressed.length, 18)          // compressed size
    local.writeUInt32LE(file.data.length, 22)           // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26)           // filename length
    local.writeUInt16LE(0, 28)                          // extra field length
    nameBytes.copy(local, 30)

    localParts.push(local, compressed)

    // Central directory header (46 bytes + filename)
    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)                // signature
    central.writeUInt16LE(20, 4)                        // version made by
    central.writeUInt16LE(20, 6)                        // version needed
    central.writeUInt16LE(0, 8)                         // flags
    central.writeUInt16LE(8, 10)                        // compression: deflate
    central.writeUInt16LE(0, 12)                        // mod time
    central.writeUInt16LE(0, 14)                        // mod date
    central.writeUInt32LE(crc, 16)                      // crc-32
    central.writeUInt32LE(compressed.length, 20)        // compressed size
    central.writeUInt32LE(file.data.length, 24)         // uncompressed size
    central.writeUInt16LE(nameBytes.length, 28)         // filename length
    central.writeUInt16LE(0, 30)                        // extra field length
    central.writeUInt16LE(0, 32)                        // file comment length
    central.writeUInt16LE(0, 34)                        // disk number start
    central.writeUInt16LE(0, 36)                        // internal file attributes
    central.writeUInt32LE(0, 38)                        // external file attributes
    central.writeUInt32LE(offset, 42)                   // local header offset
    nameBytes.copy(central, 46)

    centralParts.push(central)
    offset += local.length + compressed.length
  }

  const centralDir = Buffer.concat(centralParts)

  // End of central directory (22 bytes)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)                    // signature
  eocd.writeUInt16LE(0, 4)                              // disk number
  eocd.writeUInt16LE(0, 6)                              // disk with central dir
  eocd.writeUInt16LE(files.length, 8)                   // entries on this disk
  eocd.writeUInt16LE(files.length, 10)                  // total entries
  eocd.writeUInt32LE(centralDir.length, 12)             // central dir size
  eocd.writeUInt32LE(offset, 16)                        // central dir offset
  eocd.writeUInt16LE(0, 20)                             // comment length

  return Buffer.concat([...localParts, centralDir, eocd])
}
