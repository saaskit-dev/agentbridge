import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exportDiagnostic } from '../exporter.js';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import type { LogEntry } from '../types.js';

function makeEntry(overrides?: Partial<LogEntry>): LogEntry {
  return {
    timestamp: '2026-03-06T14:00:00.000Z',
    level: 'info',
    layer: 'test',
    component: 'test',
    message: 'test message',
    ...overrides,
  };
}

function unzip(zipData: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;

  while (offset < zipData.length) {
    const sig = zipData.readUInt32LE(offset);
    if (sig !== 0x04034b50) break; // not a local file header

    const compressedSize = zipData.readUInt32LE(offset + 18);
    const nameLen = zipData.readUInt16LE(offset + 26);
    const extraLen = zipData.readUInt16LE(offset + 28);
    const compression = zipData.readUInt16LE(offset + 8);

    const name = zipData.subarray(offset + 30, offset + 30 + nameLen).toString('utf-8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const rawData = zipData.subarray(dataStart, dataStart + compressedSize);

    if (compression === 8) {
      files.set(name, Buffer.from(inflateRawSync(rawData)));
    } else {
      files.set(name, Buffer.from(rawData));
    }

    offset = dataStart + compressedSize;
  }

  return files;
}

describe('exportDiagnostic', () => {
  let testDir: string;
  let logDir: string;
  let outDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `export-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    logDir = join(testDir, 'logs');
    outDir = join(testDir, 'out');
    mkdirSync(logDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('produces a valid zip file', () => {
    const entries = [
      makeEntry({ message: 'first', traceId: 'trace-1' }),
      makeEntry({ message: 'second', traceId: 'trace-1' }),
    ];
    writeFileSync(join(logDir, 'test.jsonl'), entries.map(e => JSON.stringify(e)).join('\n'));

    const result = exportDiagnostic({
      logDirs: [logDir],
      outputPath: join(outDir, 'diagnostic.zip'),
    });

    expect(result.outputPath).toMatch(/\.zip$/);
    expect(result.entriesCount).toBe(2);

    // Verify zip magic bytes
    const zipData = readFileSync(result.outputPath);
    expect(zipData[0]).toBe(0x50); // P
    expect(zipData[1]).toBe(0x4b); // K
    expect(zipData[2]).toBe(0x03);
    expect(zipData[3]).toBe(0x04);

    // Unzip and verify contents
    const files = unzip(zipData);
    expect(files.has('logs.jsonl')).toBe(true);
    expect(files.has('environment.json')).toBe(true);

    const logs = files.get('logs.jsonl')!.toString('utf-8');
    const lines = logs.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).message).toBe('first');
    expect(JSON.parse(lines[1]).message).toBe('second');
  });

  it('appends .zip extension when missing', () => {
    writeFileSync(join(logDir, 'test.jsonl'), JSON.stringify(makeEntry()));

    const result = exportDiagnostic({
      logDirs: [logDir],
      outputPath: join(outDir, 'diagnostic'),
    });

    expect(result.outputPath).toBe(join(outDir, 'diagnostic.zip'));
  });

  it('filters by traceId', () => {
    const entries = [
      makeEntry({ message: 'match', traceId: 'aaa' }),
      makeEntry({ message: 'no-match', traceId: 'bbb' }),
    ];
    writeFileSync(join(logDir, 'test.jsonl'), entries.map(e => JSON.stringify(e)).join('\n'));

    const result = exportDiagnostic({
      logDirs: [logDir],
      outputPath: join(outDir, 'filtered.zip'),
      traceId: 'aaa',
    });

    expect(result.entriesCount).toBe(1);

    const files = unzip(readFileSync(result.outputPath));
    const logs = files.get('logs.jsonl')!.toString('utf-8');
    expect(JSON.parse(logs).message).toBe('match');
  });

  it('filters by sessionId', () => {
    const entries = [
      makeEntry({ message: 'match', sessionId: 'sess-1' }),
      makeEntry({ message: 'no-match', sessionId: 'sess-2' }),
    ];
    writeFileSync(join(logDir, 'test.jsonl'), entries.map(e => JSON.stringify(e)).join('\n'));

    const result = exportDiagnostic({
      logDirs: [logDir],
      outputPath: join(outDir, 'filtered.zip'),
      sessionId: 'sess-1',
    });

    expect(result.entriesCount).toBe(1);
  });

  it('filters by since timestamp', () => {
    const entries = [
      makeEntry({ message: 'old', timestamp: '2026-03-05T00:00:00.000Z' }),
      makeEntry({ message: 'new', timestamp: '2026-03-06T12:00:00.000Z' }),
    ];
    writeFileSync(join(logDir, 'test.jsonl'), entries.map(e => JSON.stringify(e)).join('\n'));

    const result = exportDiagnostic({
      logDirs: [logDir],
      outputPath: join(outDir, 'filtered.zip'),
      since: '2026-03-06T00:00:00.000Z',
    });

    expect(result.entriesCount).toBe(1);
  });

  it('sorts entries by timestamp', () => {
    const entries = [
      makeEntry({ message: 'second', timestamp: '2026-03-06T14:00:02.000Z' }),
      makeEntry({ message: 'first', timestamp: '2026-03-06T14:00:01.000Z' }),
    ];
    writeFileSync(join(logDir, 'test.jsonl'), entries.map(e => JSON.stringify(e)).join('\n'));

    const result = exportDiagnostic({
      logDirs: [logDir],
      outputPath: join(outDir, 'sorted.zip'),
    });

    const files = unzip(readFileSync(result.outputPath));
    const lines = files.get('logs.jsonl')!.toString('utf-8').split('\n');
    expect(JSON.parse(lines[0]).message).toBe('first');
    expect(JSON.parse(lines[1]).message).toBe('second');
  });

  it('sanitizes sensitive data', () => {
    const entries = [makeEntry({ data: { token: 'secret-value', safe: 'visible' } })];
    writeFileSync(join(logDir, 'test.jsonl'), entries.map(e => JSON.stringify(e)).join('\n'));

    const result = exportDiagnostic({
      logDirs: [logDir],
      outputPath: join(outDir, 'sanitized.zip'),
    });

    const files = unzip(readFileSync(result.outputPath));
    const entry = JSON.parse(files.get('logs.jsonl')!.toString('utf-8'));
    expect(entry.data.token).toBe('[REDACTED]');
    expect(entry.data.safe).toBe('visible');
  });

  it('includes environment.json', () => {
    writeFileSync(join(logDir, 'test.jsonl'), JSON.stringify(makeEntry()));

    const result = exportDiagnostic({
      logDirs: [logDir],
      outputPath: join(outDir, 'env.zip'),
      environment: { platform: 'darwin', appVersion: '1.0.0' },
    });

    const files = unzip(readFileSync(result.outputPath));
    const env = JSON.parse(files.get('environment.json')!.toString('utf-8'));
    expect(env.platform).toBe('darwin');
    expect(env.appVersion).toBe('1.0.0');
  });

  it('reads from multiple log directories', () => {
    const logDir2 = join(testDir, 'logs2');
    mkdirSync(logDir2, { recursive: true });

    writeFileSync(join(logDir, 'a.jsonl'), JSON.stringify(makeEntry({ message: 'from-dir1' })));
    writeFileSync(join(logDir2, 'b.jsonl'), JSON.stringify(makeEntry({ message: 'from-dir2' })));

    const result = exportDiagnostic({
      logDirs: [logDir, logDir2],
      outputPath: join(outDir, 'multi.zip'),
    });

    expect(result.entriesCount).toBe(2);
  });

  it('handles empty log directories', () => {
    const result = exportDiagnostic({
      logDirs: [logDir],
      outputPath: join(outDir, 'empty.zip'),
    });

    expect(result.entriesCount).toBe(0);

    const files = unzip(readFileSync(result.outputPath));
    expect(files.get('logs.jsonl')!.toString('utf-8')).toBe('');
  });

  it('skips non-existent directories', () => {
    writeFileSync(join(logDir, 'test.jsonl'), JSON.stringify(makeEntry()));

    const result = exportDiagnostic({
      logDirs: [join(testDir, 'nonexistent'), logDir],
      outputPath: join(outDir, 'skip.zip'),
    });

    expect(result.entriesCount).toBe(1);
  });
});
