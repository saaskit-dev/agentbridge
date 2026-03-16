import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { MemorySink } from '../sinks/memory.js'
import { ConsoleSink } from '../sinks/console.js'
import { RemoteSink } from '../sinks/remote.js'
import { FileSink } from '../sinks/file.js'
import { AxiomBackend } from '../sinks/backends/axiom.js'
import { NewRelicBackend } from '../sinks/backends/newrelic.js'
import { ServerRelayBackend } from '../sinks/backends/serverRelay.js'
import { cleanupOldLogs } from '../cleanup.js'
import type { LogEntry } from '../types.js'
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeEntry(overrides?: Partial<LogEntry>): LogEntry {
  return {
    timestamp: '2026-03-06T14:00:00.000Z',
    level: 'info',
    layer: 'test',
    component: 'test',
    message: 'test message',
    ...overrides,
  }
}

describe('MemorySink', () => {
  it('stores entries and retrieves them', () => {
    const sink = new MemorySink()
    sink.write(makeEntry({ message: 'one' }))
    sink.write(makeEntry({ message: 'two' }))

    const entries = sink.getEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0].message).toBe('one')
  })

  it('respects maxEntries', () => {
    const sink = new MemorySink({ maxEntries: 3 })
    for (let i = 0; i < 5; i++) {
      sink.write(makeEntry({ message: `msg-${i}` }))
    }
    const entries = sink.getEntries()
    expect(entries).toHaveLength(3)
    expect(entries[0].message).toBe('msg-2')
  })

  it('query filters by traceId', () => {
    const sink = new MemorySink()
    sink.write(makeEntry({ traceId: 'aaa', message: 'match' }))
    sink.write(makeEntry({ traceId: 'bbb', message: 'no-match' }))

    const result = sink.query({ traceId: 'aaa' })
    expect(result).toHaveLength(1)
    expect(result[0].message).toBe('match')
  })

  it('query filters by level', () => {
    const sink = new MemorySink()
    sink.write(makeEntry({ level: 'debug' }))
    sink.write(makeEntry({ level: 'error' }))
    sink.write(makeEntry({ level: 'info' }))

    expect(sink.query({ level: 'error' })).toHaveLength(1)
    expect(sink.query({ level: ['debug', 'info'] })).toHaveLength(2)
  })

  it('query filters by search string', () => {
    const sink = new MemorySink()
    sink.write(makeEntry({ message: 'Connection established' }))
    sink.write(makeEntry({ message: 'Message sent' }))

    const result = sink.query({ search: 'connection' })
    expect(result).toHaveLength(1)
  })

  it('onChange notifies listeners', () => {
    const sink = new MemorySink()
    const received: LogEntry[] = []
    sink.onChange(entry => received.push(entry))

    sink.write(makeEntry({ message: 'hello' }))
    expect(received).toHaveLength(1)
    expect(received[0].message).toBe('hello')
  })

  it('onChange returns unsubscribe function', () => {
    const sink = new MemorySink()
    const received: LogEntry[] = []
    const unsub = sink.onChange(entry => received.push(entry))

    sink.write(makeEntry())
    expect(received).toHaveLength(1)

    unsub()
    sink.write(makeEntry())
    expect(received).toHaveLength(1)
  })

  it('exportJsonl produces valid JSONL', () => {
    const sink = new MemorySink()
    sink.write(makeEntry({ message: 'one' }))
    sink.write(makeEntry({ message: 'two' }))

    const jsonl = sink.exportJsonl()
    const lines = jsonl.split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).message).toBe('one')
  })

  it('clear removes all entries', () => {
    const sink = new MemorySink()
    sink.write(makeEntry())
    sink.write(makeEntry())
    sink.clear()
    expect(sink.getEntries()).toHaveLength(0)
  })

  it('persists to AsyncStorage-like backend', async () => {
    const storage = new Map<string, string>()
    const asyncStorage = {
      getItem: async (key: string) => storage.get(key) ?? null,
      setItem: async (key: string, value: string) => { storage.set(key, value) },
    }

    const sink = new MemorySink({
      persistence: {
        storage: asyncStorage,
        key: '@test/logs',
        maxPersistedEntries: 5,
        flushIntervalMs: 100_000, // won't fire during test
      },
    })

    sink.write(makeEntry({ message: 'persisted' }))
    await sink.flush()

    const raw = storage.get('@test/logs')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].message).toBe('persisted')

    await sink.close()
  })

  it('loads persisted entries on startup', async () => {
    const stored = JSON.stringify([makeEntry({ message: 'old' })])
    const storage = {
      getItem: async () => stored,
      setItem: async () => {},
    }

    const sink = new MemorySink({
      persistence: { storage, key: '@test/logs', maxPersistedEntries: 100, flushIntervalMs: 100_000 },
    })
    await sink.loadPersistedEntries()

    sink.write(makeEntry({ message: 'new' }))
    const entries = sink.getEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0].message).toBe('old')
    expect(entries[1].message).toBe('new')

    await sink.close()
  })

  it('loadPersistedEntries is idempotent — double call does not duplicate entries', async () => {
    const stored = JSON.stringify([makeEntry({ message: 'persisted' })])
    const storage = {
      getItem: async () => stored,
      setItem: async () => {},
    }
    const sink = new MemorySink({
      persistence: { storage, key: '@test/logs', maxPersistedEntries: 100, flushIntervalMs: 100_000 },
    })

    await sink.loadPersistedEntries()
    await sink.loadPersistedEntries() // second call must be a no-op

    expect(sink.getEntries()).toHaveLength(1)
    await sink.close()
  })

  it('persistence timer does not prevent process exit (unref called)', async () => {
    const storage = { getItem: async () => null, setItem: async () => {} }
    const sink = new MemorySink({
      persistence: { storage, key: '@test', maxPersistedEntries: 100, flushIntervalMs: 100_000 },
    })
    const timer = (sink as any).persistTimer as NodeJS.Timeout | null
    if (timer && typeof timer.hasRef === 'function') {
      expect(timer.hasRef()).toBe(false)
    }
    await sink.close()
  })
})

describe('ConsoleSink', () => {
  it('writes to console without throwing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const sink = new ConsoleSink({ color: false })
    sink.write(makeEntry({ level: 'info' }))
    sink.write(makeEntry({ level: 'warn' }))
    sink.write(makeEntry({ level: 'error' }))

    expect(spy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledOnce()

    spy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('includes trace and data in compact format', () => {
    let output = ''
    const spy = vi.spyOn(console, 'log').mockImplementation((msg: string) => { output = msg })

    const sink = new ConsoleSink({ color: false })
    sink.write(makeEntry({ traceId: 'abc12345-long', sessionId: 'sess1234-long', data: { count: 42 } }))

    expect(output).toContain('trace=abc12345')
    expect(output).toContain('session=sess1234')
    expect(output).toContain('count=42')

    spy.mockRestore()
  })
})

describe('FileSink', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `telemetry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
  })

  it('writes JSONL to file (sync mode)', async () => {
    const sink = new FileSink({ dir: testDir, prefix: 'test', bufferFlushMs: 0 })
    sink.write(makeEntry({ message: 'line1' }))
    sink.write(makeEntry({ message: 'line2' }))

    const files = readdirSync(testDir).filter(f => f.endsWith('.jsonl'))
    expect(files).toHaveLength(1)

    const content = readFileSync(join(testDir, files[0]), 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).message).toBe('line1')

    await sink.close()
  })

  it('writes JSONL to file (async mode)', async () => {
    const sink = new FileSink({ dir: testDir, prefix: 'async', bufferFlushMs: 50 })
    sink.write(makeEntry({ message: 'buffered' }))

    // Before flush, file may be empty
    await sink.flush()

    const files = readdirSync(testDir).filter(f => f.endsWith('.jsonl'))
    expect(files).toHaveLength(1)

    const content = readFileSync(join(testDir, files[0]), 'utf-8')
    expect(JSON.parse(content.trim()).message).toBe('buffered')

    await sink.close()
  })

  it('exposes file path', () => {
    const sink = new FileSink({ dir: testDir, prefix: 'mylog', bufferFlushMs: 0 })
    const path = sink.getFilePath()
    expect(path).toContain(testDir)
    expect(path).toContain('mylog')
    expect(path).toMatch(/\.jsonl$/)
  })

  it('creates directory if it does not exist', () => {
    const nestedDir = join(testDir, 'sub', 'dir')
    const sink = new FileSink({ dir: nestedDir, prefix: 'test', bufferFlushMs: 0 })
    sink.write(makeEntry())
    const files = readdirSync(nestedDir)
    expect(files.length).toBeGreaterThan(0)
  })

  it('concurrent flush calls in async mode do not write duplicates', async () => {
    const sink = new FileSink({ dir: testDir, prefix: 'concurrent', bufferFlushMs: 100 })

    for (let i = 0; i < 5; i++) {
      sink.write(makeEntry({ message: `msg-${i}` }))
    }

    // Trigger two concurrent flushes
    await Promise.all([sink.flush(), sink.flush()])

    const files = readdirSync(testDir).filter(f => f.endsWith('.jsonl'))
    expect(files).toHaveLength(1)

    const content = readFileSync(join(testDir, files[0]), 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    // All 5 entries should appear exactly once, not duplicated
    expect(lines).toHaveLength(5)
    const messages = lines.map(l => JSON.parse(l).message)
    expect(new Set(messages).size).toBe(5)

    await sink.close()
  })

  it('uses hourly filename format', () => {
    const sink = new FileSink({ dir: testDir, prefix: 'hourly', bufferFlushMs: 0 })
    const path = sink.getFilePath()
    // Filename should be like: hourly-2026-03-11-09.jsonl
    expect(path).toMatch(/hourly-\d{4}-\d{2}-\d{2}-\d{2}\.jsonl$/)
  })

  it('appends to existing file from current hour', async () => {
    const sink1 = new FileSink({ dir: testDir, prefix: 'append', bufferFlushMs: 0 })
    sink1.write(makeEntry({ message: 'first' }))
    await sink1.close()

    // Simulate new process starting - should append to same file
    const sink2 = new FileSink({ dir: testDir, prefix: 'append', bufferFlushMs: 0 })
    sink2.write(makeEntry({ message: 'second' }))
    await sink2.close()

    const files = readdirSync(testDir).filter(f => f.startsWith('append') && f.endsWith('.jsonl'))
    expect(files).toHaveLength(1)

    const content = readFileSync(join(testDir, files[0]), 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).message).toBe('first')
    expect(JSON.parse(lines[1]).message).toBe('second')
  })

  it('deletes oldest files when maxFiles is exceeded (RFC §5.3)', () => {
    // Pre-create log files with different hours
    const prefixes = ['maxfiles-2026-01-01-00', 'maxfiles-2026-01-01-01', 'maxfiles-2026-01-01-02',
                      'maxfiles-2026-01-01-03', 'maxfiles-2026-01-01-04']
    for (const p of prefixes) {
      writeFileSync(join(testDir, `${p}.jsonl`), 'test\n')
    }

    // Create sink with maxFiles=2 - should trigger cleanup
    const sink = new FileSink({
      dir: testDir,
      prefix: 'maxfiles',
      bufferFlushMs: 0,
      maxFiles: 2,
    })
    sink.write(makeEntry({ message: 'new-entry' }))

    const files = readdirSync(testDir).filter(f => f.startsWith('maxfiles') && f.endsWith('.jsonl'))
    // Should keep at most maxFiles + 1 (including current hour's file)
    expect(files.length).toBeLessThanOrEqual(3)
  })

  it('async mode flush timer does not prevent process exit (unref called)', async () => {
    // If unref() is called, the timer's hasRef() returns false in Node.js.
    // This verifies the timer won't keep the process alive when all else is done.
    const sink = new FileSink({ dir: testDir, prefix: 'unref', bufferFlushMs: 100 })
    // Access the private timer field via type assertion to verify unref was called
    const timer = (sink as any).flushTimer as NodeJS.Timeout | null
    if (timer && typeof timer.hasRef === 'function') {
      expect(timer.hasRef()).toBe(false)
    }
    await sink.close()
  })
})

describe('RemoteSink', () => {
  it('buffers entries and sanitizes before upload', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    const backend = new NewRelicBackend({ licenseKey: 'nr-key-123', region: 'eu' })

    const sink = new RemoteSink({
      backend,
      batchSize: 2,
      flushIntervalMs: 100_000, // won't fire
      minLevel: 'info',
      metadata: { deviceId: 'dev-1', appVersion: '1.0', layer: 'test' },
    })

    sink.write(makeEntry({ data: { token: 'secret', safe: 'ok' } }))
    sink.write(makeEntry({ message: 'second' }))

    // Wait for the async flush triggered by batchSize
    await new Promise(r => setTimeout(r, 50))

    expect(mockFetch).toHaveBeenCalled()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('eu.newrelic.com')

    // NR format: [{ common: {...}, logs: [{ attributes: { ...entry.data } }] }]
    const body = JSON.parse(opts.body) as Array<{ common: unknown; logs: Array<{ attributes: Record<string, unknown> }> }>
    // Sanitizer should have redacted token before backend formats it
    expect(body[0].logs[0].attributes.token).toBe('[REDACTED]')
    expect(body[0].logs[0].attributes.safe).toBe('ok')

    vi.unstubAllGlobals()
    await sink.close()
  })

  it('respects minLevel', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    const sink = new RemoteSink({
      backend: new NewRelicBackend({ licenseKey: 'nr-key' }),
      batchSize: 10,
      minLevel: 'warn',
      flushIntervalMs: 100_000,
      metadata: { deviceId: 'dev-1', appVersion: '1.0', layer: 'test' },
    })

    sink.write(makeEntry({ level: 'debug' }))
    sink.write(makeEntry({ level: 'info' }))
    sink.write(makeEntry({ level: 'warn' }))
    sink.write(makeEntry({ level: 'error' }))

    await sink.flush()

    expect(mockFetch).toHaveBeenCalledOnce()
    const body = JSON.parse(mockFetch.mock.calls[0][1].body) as Array<{ common: unknown; logs: Array<{ level: string }> }>
    expect(body[0].logs).toHaveLength(2)
    expect(body[0].logs.map(e => e.level)).toEqual(['warn', 'error'])

    vi.unstubAllGlobals()
    await sink.close()
  })

  it('does not throw when backend returns null', async () => {
    // NewRelicBackend returns null when licenseKey is a function returning undefined
    const backend = new NewRelicBackend({ licenseKey: () => undefined })
    const sink = new RemoteSink({
      backend,
      batchSize: 1,
      flushIntervalMs: 100_000,
      metadata: { deviceId: 'dev-1', appVersion: '1.0', layer: 'test' },
    })

    expect(() => sink.write(makeEntry())).not.toThrow()
    await sink.close()
  })

  it('default minLevel is debug — keeps all levels (RFC §22.1)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    const sink = new RemoteSink({
      backend: new NewRelicBackend({ licenseKey: 'key' }),
      batchSize: 10,
      flushIntervalMs: 100_000,
      metadata: { deviceId: 'dev-1', appVersion: '1.0', layer: 'test' },
      // no minLevel specified — should default to 'debug'
    })

    sink.write(makeEntry({ level: 'debug' }))
    sink.write(makeEntry({ level: 'info' }))
    sink.write(makeEntry({ level: 'warn' }))

    await sink.flush()

    expect(mockFetch).toHaveBeenCalledOnce()
    const body = JSON.parse(mockFetch.mock.calls[0][1].body) as Array<{ logs: Array<{ level: string }> }>
    const levels = body[0].logs.map(e => e.level)
    expect(levels).toEqual(['debug', 'info', 'warn'])

    await sink.close()
    vi.unstubAllGlobals()
  })

  it('drops oldest entries when maxBufferSize exceeded (RFC §23.5)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    const sink = new RemoteSink({
      backend: new NewRelicBackend({ licenseKey: 'key' }),
      batchSize: 100,       // high batch size — won't auto-flush
      flushIntervalMs: 100_000,
      maxBufferSize: 3,     // very small buffer
      minLevel: 'debug',
      metadata: { deviceId: 'dev-1', appVersion: '1.0', layer: 'test' },
    })

    // Write 5 entries — oldest 2 should be dropped when buffer cap is hit
    for (let i = 1; i <= 5; i++) {
      sink.write(makeEntry({ message: `entry-${i}` }))
    }

    await sink.flush()

    expect(mockFetch).toHaveBeenCalled()
    const body = JSON.parse(mockFetch.mock.calls[0][1].body) as Array<{ logs: Array<{ message: string }> }>
    const messages = body[0].logs.map(e => e.message)
    // Only the 3 newest entries should remain
    expect(messages).toHaveLength(3)
    expect(messages).toContain('entry-3')
    expect(messages).toContain('entry-4')
    expect(messages).toContain('entry-5')
    // Oldest entries dropped
    expect(messages).not.toContain('entry-1')
    expect(messages).not.toContain('entry-2')

    await sink.close()
    vi.unstubAllGlobals()
  })

  it('applies extraSanitizer after built-in sanitizer (RFC §6.3)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    const { Sanitizer } = await import('../sanitizer.js')
    const extraSanitizer = new Sanitizer({ extraSensitiveKeys: ['sessionId'], maxStringLength: 10 })

    const sink = new RemoteSink({
      backend: new NewRelicBackend({ licenseKey: 'key', region: 'eu' }),
      batchSize: 1,
      flushIntervalMs: 100_000,
      minLevel: 'info',
      metadata: { deviceId: 'dev-1', appVersion: '1.0', layer: 'test' },
      extraSanitizer,
    })

    // sessionId in data should be redacted by extraSanitizer
    // longValue should be truncated to 10 chars by extraSanitizer
    sink.write(makeEntry({ data: { sessionId: 'sess-abc', longValue: 'a'.repeat(20), safe: 'ok' } }))

    await new Promise(r => setTimeout(r, 50))

    expect(mockFetch).toHaveBeenCalled()
    const body = JSON.parse(mockFetch.mock.calls[0][1].body) as Array<{ logs: Array<{ attributes: Record<string, unknown> }> }>
    const attrs = body[0].logs[0].attributes
    expect(attrs.sessionId).toBe('[REDACTED]')
    expect((attrs.longValue as string)).toBe('aaaaaaaaaa...[truncated]')
    expect(attrs.safe).toBe('ok')

    vi.unstubAllGlobals()
    await sink.close()
  })

  it('close() drains all batches, not just one', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    const sink = new RemoteSink({
      backend: new NewRelicBackend({ licenseKey: 'key' }),
      batchSize: 2,
      flushIntervalMs: 100_000,
      minLevel: 'debug',
      metadata: { deviceId: 'dev-1', appVersion: '1.0', layer: 'test' },
    })

    // Write 5 entries with batchSize=2, should need 3 flush calls
    for (let i = 1; i <= 5; i++) {
      sink.write(makeEntry({ message: `msg-${i}` }))
    }

    await sink.close()

    // All entries should have been sent across multiple batches
    const allMessages = mockFetch.mock.calls.flatMap(([, opts]) => {
      const body = JSON.parse(opts.body) as Array<{ logs: Array<{ message: string }> }>
      return body[0].logs.map(l => l.message)
    })
    expect(allMessages).toHaveLength(5)
    for (let i = 1; i <= 5; i++) {
      expect(allMessages).toContain(`msg-${i}`)
    }

    vi.unstubAllGlobals()
  })

  it('retains entries in buffer on fetch network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', mockFetch)

    const sink = new RemoteSink({
      backend: new NewRelicBackend({ licenseKey: 'key' }),
      batchSize: 2,
      flushIntervalMs: 100_000,
      minLevel: 'debug',
      metadata: { deviceId: 'dev-1', appVersion: '1.0', layer: 'test' },
    })

    sink.write(makeEntry({ message: 'a' }))
    sink.write(makeEntry({ message: 'b' }))
    await sink.flush()

    // Entries should be back in buffer, not lost
    const buf = (sink as any).buffer as Array<{ message: string }>
    expect(buf).toHaveLength(2)

    vi.unstubAllGlobals()
    // Prevent close from retrying
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    await sink.close()
    vi.unstubAllGlobals()
  })

  it('retains entries in buffer on HTTP 500 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', mockFetch)

    const sink = new RemoteSink({
      backend: new NewRelicBackend({ licenseKey: 'key' }),
      batchSize: 2,
      flushIntervalMs: 100_000,
      minLevel: 'debug',
      metadata: { deviceId: 'dev-1', appVersion: '1.0', layer: 'test' },
    })

    sink.write(makeEntry({ message: 'x' }))
    sink.write(makeEntry({ message: 'y' }))
    await sink.flush()

    const buf = (sink as any).buffer as Array<{ message: string }>
    expect(buf).toHaveLength(2)

    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    await sink.close()
    vi.unstubAllGlobals()
  })

  it('doFlush sends multiple batches in one call', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    const sink = new RemoteSink({
      backend: new NewRelicBackend({ licenseKey: 'key' }),
      batchSize: 2,
      flushIntervalMs: 100_000,
      minLevel: 'debug',
      metadata: { deviceId: 'dev-1', appVersion: '1.0', layer: 'test' },
    })

    // Write 4 entries without triggering auto-flush (we'll call flush manually)
    // batchSize=2, so 4 entries should need 2 fetch calls in one flush
    ;(sink as any).buffer = [
      makeEntry({ message: 'm1' }),
      makeEntry({ message: 'm2' }),
      makeEntry({ message: 'm3' }),
      makeEntry({ message: 'm4' }),
    ]

    await sink.flush()

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const buf = (sink as any).buffer
    expect(buf).toHaveLength(0)

    vi.unstubAllGlobals()
    await sink.close()
  })
})

describe('NewRelicBackend', () => {
  it('builds correct request format', () => {
    const backend = new NewRelicBackend({ licenseKey: 'nr-key' })
    const req = backend.buildRequest(
      [makeEntry({ message: 'hello', traceId: 'trace-1' })],
      { deviceId: 'dev-1', appVersion: '1.0', layer: 'server' },
    )!

    expect(req.url).toBe('https://log-api.newrelic.com/log/v1')
    expect(req.headers['Api-Key']).toBe('nr-key')

    const body = JSON.parse(req.body)
    expect(body).toHaveLength(1)
    expect(body[0].common.attributes['service.name']).toBe('agentbridge')
    expect(body[0].logs).toHaveLength(1)
    expect(body[0].logs[0].message).toBe('hello')
    expect(body[0].logs[0].attributes.traceId).toBe('trace-1')
  })

  it('uses EU endpoint when configured', () => {
    const backend = new NewRelicBackend({ licenseKey: 'key', region: 'eu' })
    const req = backend.buildRequest([makeEntry()], { deviceId: '', appVersion: '', layer: '' })!
    expect(req.url).toContain('log-api.eu.newrelic.com')
  })

  it('omits undefined optional attributes from payload', () => {
    const backend = new NewRelicBackend({ licenseKey: 'key' })
    // Entry with no trace fields, no duration, no machineId in metadata
    const req = backend.buildRequest(
      [makeEntry()],
      { deviceId: 'dev-1', appVersion: '1.0', layer: 'cli' },
    )!
    const attrs = JSON.parse(req.body)[0].logs[0].attributes
    expect('traceId' in attrs).toBe(false)
    expect('spanId' in attrs).toBe(false)
    expect('parentSpanId' in attrs).toBe(false)
    expect('sessionId' in attrs).toBe(false)
    expect('durationMs' in attrs).toBe(false)
    // machineId, env, serverIp in common should also be omitted when not provided
    const common = JSON.parse(req.body)[0].common.attributes
    expect('machine.id' in common).toBe(false)
    expect('deployment.environment' in common).toBe(false)
    expect('server.ip' in common).toBe(false)
  })

  it('includes optional attributes when present', () => {
    const backend = new NewRelicBackend({ licenseKey: 'key' })
    const req = backend.buildRequest(
      [makeEntry({ traceId: 'tid', spanId: 'sid', durationMs: 42 })],
      { deviceId: 'dev-1', appVersion: '1.0', layer: 'cli', machineId: 'machine-1', env: 'production', serverIp: '10.0.1.5' },
    )!
    const attrs = JSON.parse(req.body)[0].logs[0].attributes
    expect(attrs.traceId).toBe('tid')
    expect(attrs.spanId).toBe('sid')
    expect(attrs.durationMs).toBe(42)
    const common = JSON.parse(req.body)[0].common.attributes
    expect(common['machine.id']).toBe('machine-1')
    expect(common['deployment.environment']).toBe('production')
    expect(common['server.ip']).toBe('10.0.1.5')
  })

  it('core fields win over user data with same key (RFC field priority)', () => {
    // If entry.data has a key that collides with a core telemetry field,
    // the core field must take precedence (entry.data spread first, then explicit fields).
    const backend = new NewRelicBackend({ licenseKey: 'key' })
    const req = backend.buildRequest(
      [makeEntry({ traceId: 'real-trace', data: { traceId: 'spoofed', component: 'spoofed' } })],
      { deviceId: 'dev-1', appVersion: '1.0', layer: 'cli' },
    )!
    const attrs = JSON.parse(req.body)[0].logs[0].attributes
    expect(attrs.traceId).toBe('real-trace')
    expect(attrs.component).not.toBe('spoofed')
  })
})

describe('ServerRelayBackend', () => {
  const meta = { deviceId: 'dev-1', appVersion: '1.0', layer: 'cli' }

  it('builds correct request format with string token', () => {
    const backend = new ServerRelayBackend({ serverUrl: 'https://api.example.com', authToken: 'tok-123' })
    const req = backend.buildRequest([makeEntry({ message: 'hello' })], meta)!

    expect(req.url).toBe('https://api.example.com/v1/telemetry/ingest')
    expect(req.method).toBe('POST')
    expect(req.headers['Authorization']).toBe('Bearer tok-123')
    expect(req.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(req.body)
    expect(body.metadata).toEqual(meta)
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0].message).toBe('hello')
  })

  it('supports lazy auth token getter', () => {
    let token: string | undefined = undefined
    const backend = new ServerRelayBackend({ serverUrl: 'https://api.example.com', authToken: () => token })

    // Token not available yet — returns null
    expect(backend.buildRequest([makeEntry()], meta)).toBeNull()

    // Token becomes available
    token = 'lazy-token'
    const req = backend.buildRequest([makeEntry()], meta)!
    expect(req).not.toBeNull()
    expect(req.headers['Authorization']).toBe('Bearer lazy-token')
  })

  it('returns null when token getter returns undefined', () => {
    const backend = new ServerRelayBackend({ serverUrl: 'https://api.example.com', authToken: () => undefined })
    expect(backend.buildRequest([makeEntry()], meta)).toBeNull()
  })

  it('integrates with RemoteSink: buffers until token is available', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    let token: string | undefined = undefined
    const backend = new ServerRelayBackend({ serverUrl: 'https://api.example.com', authToken: () => token })
    const sink = new RemoteSink({
      backend,
      batchSize: 10,
      flushIntervalMs: 100_000,
      metadata: meta,
    })

    sink.write(makeEntry({ message: 'before-auth' }))
    await sink.flush()
    // No token yet — nothing sent, entry buffered back
    expect(mockFetch).not.toHaveBeenCalled()

    // Auth obtained — flush now sends buffered entry + new entry
    token = 'my-token'
    sink.write(makeEntry({ message: 'after-auth' }))
    await sink.flush()

    expect(mockFetch).toHaveBeenCalled()
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    // 'before-auth' was re-buffered when backend returned null, so it appears in the next flush
    expect(body.entries.some((e: LogEntry) => e.message === 'before-auth')).toBe(true)

    await sink.close()
    vi.unstubAllGlobals()
  })
})

describe('cleanupOldLogs', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `cleanup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch {}
  })

  function makeLogFile(name: string, ageMs: number, sizeBytes = 100): string {
    const path = join(testDir, name)
    writeFileSync(path, 'x'.repeat(sizeBytes))
    // Set mtime to simulate file age
    const mtime = new Date(Date.now() - ageMs)
    utimesSync(path, mtime, mtime)
    return path
  }

  it('deletes files older than maxAgeDays', () => {
    const old = makeLogFile('old.jsonl', 8 * 24 * 60 * 60 * 1000) // 8 days old
    const recent = makeLogFile('recent.jsonl', 1 * 60 * 60 * 1000)  // 1 hour old

    cleanupOldLogs({ dir: testDir, maxAgeDays: 7 })

    const remaining = readdirSync(testDir)
    expect(remaining).not.toContain('old.jsonl')
    expect(remaining).toContain('recent.jsonl')
    void old; void recent
  })

  it('deletes oldest files when total size exceeds maxTotalSizeMB', () => {
    // Create 3 files: newest 200KB, second 200KB, oldest 200KB → total 600KB > 0.5MB cap
    makeLogFile('newest.jsonl', 1000, 200 * 1024)
    makeLogFile('middle.jsonl', 2000, 200 * 1024)
    makeLogFile('oldest.jsonl', 3000, 200 * 1024)

    cleanupOldLogs({ dir: testDir, maxAgeDays: 30, maxTotalSizeMB: 0 })

    // With 0MB cap, all but the newest (iterated first) get deleted
    const remaining = readdirSync(testDir)
    // At least the oldest should be deleted
    expect(remaining).not.toContain('oldest.jsonl')
  })

  it('does not over-delete: subtracts deleted file size before checking remaining files (RFC §17.9)', () => {
    // newest=400KB, middle=200KB, oldest=50KB, cap=490KB
    // Without subtract: newest(400)<cap, keep; middle(600>490), delete; oldest(650>490), wrongly delete
    // With subtract:    newest(400)<cap, keep; middle(600>490), delete, totalSize=400; oldest(450)<490, keep
    makeLogFile('newest.jsonl', 100, 400 * 1024)
    makeLogFile('middle.jsonl', 200, 200 * 1024)
    makeLogFile('oldest.jsonl', 300, 50 * 1024)

    cleanupOldLogs({ dir: testDir, maxAgeDays: 30, maxTotalSizeMB: 400 / 1024 + 50 / 1024 + 0.01 }) // ~450KB cap

    const remaining = readdirSync(testDir)
    expect(remaining).toContain('newest.jsonl')   // kept (400KB fits under 450KB cap alone)
    expect(remaining).not.toContain('middle.jsonl') // deleted (400+200=600 > 450)
    expect(remaining).toContain('oldest.jsonl')   // kept (400-200+50=250 < 450 after deletion)
  })

  it('handles non-existent directory without throwing', () => {
    expect(() => cleanupOldLogs({ dir: join(testDir, 'nonexistent') })).not.toThrow()
  })

  it('ignores non-log files', () => {
    writeFileSync(join(testDir, 'keep.txt'), 'data')
    makeLogFile('old.jsonl', 10 * 24 * 60 * 60 * 1000) // 10 days old

    cleanupOldLogs({ dir: testDir, maxAgeDays: 7 })

    expect(readdirSync(testDir)).toContain('keep.txt')
  })

  it('uses defaults (7 days, 500 MB) when options not specified', () => {
    const recent = makeLogFile('recent.jsonl', 1 * 60 * 60 * 1000) // 1 hour
    cleanupOldLogs({ dir: testDir })
    expect(readdirSync(testDir)).toContain('recent.jsonl')
    void recent
  })
})

describe('createRemoteBackend / setTelemetryToken (RFC §24.2)', () => {
  it('createRemoteBackend returns a RemoteBackend instance', async () => {
    // Dynamic import to reset module-level token state
    const { createRemoteBackend } = await import('../sinks/backends/config.js')
    const backend = createRemoteBackend()
    expect(backend).toBeDefined()
    expect(typeof backend.name).toBe('string')
    expect(typeof backend.buildRequest).toBe('function')
  })

  it('setTelemetryToken enables backend to produce requests', async () => {
    const { createRemoteBackend, setTelemetryToken } = await import('../sinks/backends/config.js')

    const backend = createRemoteBackend()
    // Without token, buildRequest returns null
    const noTokenReq = backend.buildRequest([makeEntry()], { deviceId: 'dev', appVersion: '1.0', layer: 'test' })
    expect(noTokenReq).toBeNull()

    // After setting token, buildRequest succeeds
    setTelemetryToken('test-token-xyz')
    const req = backend.buildRequest([makeEntry()], { deviceId: 'dev', appVersion: '1.0', layer: 'test' })
    expect(req).not.toBeNull()
    expect(req!.body).toBeDefined()
  })
})

describe('AxiomBackend (RFC §23.3)', () => {
  const meta = { deviceId: 'dev-1', appVersion: '1.0', layer: 'cli' }

  it('builds correct request format for Axiom ingest', () => {
    const backend = new AxiomBackend({ dataset: 'agentbridge-dev', apiToken: 'axiom-tok' })
    const req = backend.buildRequest(
      [makeEntry({ message: 'hello', traceId: 'trace-1' })],
      meta,
    )!

    expect(req).not.toBeNull()
    expect(req.method).toBe('POST')
    expect(req.url).toBe('https://api.axiom.co/v1/datasets/agentbridge-dev/ingest')
    expect(req.headers['Authorization']).toBe('Bearer axiom-tok')
    expect(req.headers['Content-Type']).toBe('application/json')

    const events = JSON.parse(req.body)
    expect(Array.isArray(events)).toBe(true)
    expect(events).toHaveLength(1)
    // Axiom uses _time for timestamp
    expect(events[0]._time).toBe(makeEntry().timestamp)
    expect(events[0].message).toBe('hello')
    expect(events[0].traceId).toBe('trace-1')
    expect(events[0]._deviceId).toBe('dev-1')
    expect(events[0]._appVersion).toBe('1.0')
    expect(events[0]._layer).toBe('cli')
  })

  it('returns null when token is missing', () => {
    const backend = new AxiomBackend({ dataset: 'test', apiToken: () => undefined })
    expect(backend.buildRequest([makeEntry()], meta)).toBeNull()
  })

  it('supports lazy token getter', () => {
    let token: string | undefined = undefined
    const backend = new AxiomBackend({ dataset: 'test', apiToken: () => token })

    expect(backend.buildRequest([makeEntry()], meta)).toBeNull()

    token = 'lazy-axiom-token'
    const req = backend.buildRequest([makeEntry()], meta)
    expect(req).not.toBeNull()
    expect(req!.headers['Authorization']).toBe('Bearer lazy-axiom-token')
  })

  it('supports custom baseUrl', () => {
    const backend = new AxiomBackend({
      dataset: 'my-dataset',
      apiToken: 'tok',
      baseUrl: 'https://custom.axiom.co',
    })
    const req = backend.buildRequest([makeEntry()], meta)!
    expect(req.url).toBe('https://custom.axiom.co/v1/datasets/my-dataset/ingest')
  })

  it('omits _machineId when machineId not in metadata', () => {
    const backend = new AxiomBackend({ dataset: 'test', apiToken: 'tok' })
    const req = backend.buildRequest([makeEntry()], meta)!
    const events = JSON.parse(req.body)
    expect('_machineId' in events[0]).toBe(false)
  })

  it('includes _machineId when machineId provided in metadata', () => {
    const backend = new AxiomBackend({ dataset: 'test', apiToken: 'tok' })
    const req = backend.buildRequest([makeEntry()], { ...meta, machineId: 'mach-1' })!
    const events = JSON.parse(req.body)
    expect(events[0]._machineId).toBe('mach-1')
  })
})
