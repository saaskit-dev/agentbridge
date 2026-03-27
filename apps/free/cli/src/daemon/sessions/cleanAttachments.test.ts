/**
 * cleanStaleAttachments unit tests
 *
 * Tests stale file detection and removal, error resilience, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node:fs/promises (default import)
// ---------------------------------------------------------------------------

const fsMock = vi.hoisted(() => ({
  readdir: vi.fn<() => Promise<string[]>>(),
  stat: vi.fn<() => Promise<{ mtimeMs: number }>>(),
  unlink: vi.fn<() => Promise<void>>(),
}));

vi.mock('node:fs/promises', () => ({ default: fsMock }));
vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    warn() {}
    info() {}
  },
}));

import { cleanStaleAttachments } from './cleanAttachments';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('cleanStaleAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early without error when directory does not exist', async () => {
    fsMock.readdir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await expect(cleanStaleAttachments('/tmp/no-such-dir')).resolves.toBeUndefined();
    expect(fsMock.stat).not.toHaveBeenCalled();
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  it('does nothing when directory is empty', async () => {
    fsMock.readdir.mockResolvedValue([]);

    await cleanStaleAttachments('/tmp/attachments');

    expect(fsMock.stat).not.toHaveBeenCalled();
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  it('removes files older than maxAgeDays', async () => {
    const staleTime = Date.now() - 8 * DAY_MS; // 8 days old (> 7 default)
    fsMock.readdir.mockResolvedValue(['abc.jpg', 'def.png']);
    fsMock.stat.mockResolvedValue({ mtimeMs: staleTime });
    fsMock.unlink.mockResolvedValue(undefined);

    await cleanStaleAttachments('/tmp/attachments');

    expect(fsMock.unlink).toHaveBeenCalledTimes(2);
    expect(fsMock.unlink).toHaveBeenCalledWith('/tmp/attachments/abc.jpg');
    expect(fsMock.unlink).toHaveBeenCalledWith('/tmp/attachments/def.png');
  });

  it('keeps files newer than maxAgeDays', async () => {
    const freshTime = Date.now() - 2 * DAY_MS; // 2 days old (< 7 default)
    fsMock.readdir.mockResolvedValue(['fresh.jpg']);
    fsMock.stat.mockResolvedValue({ mtimeMs: freshTime });

    await cleanStaleAttachments('/tmp/attachments');

    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  it('respects custom maxAgeDays parameter', async () => {
    const time = Date.now() - 2 * DAY_MS; // 2 days old
    fsMock.readdir.mockResolvedValue(['img.jpg']);
    fsMock.stat.mockResolvedValue({ mtimeMs: time });
    fsMock.unlink.mockResolvedValue(undefined);

    // maxAgeDays=1 → 2-day-old file should be removed
    await cleanStaleAttachments('/tmp/attachments', 1);
    expect(fsMock.unlink).toHaveBeenCalledTimes(1);
  });

  it('removes only stale files when directory contains a mix', async () => {
    const staleTime = Date.now() - 10 * DAY_MS;
    const freshTime = Date.now() - 1 * DAY_MS;

    fsMock.readdir.mockResolvedValue(['stale.jpg', 'fresh.png']);
    fsMock.stat
      .mockResolvedValueOnce({ mtimeMs: staleTime })
      .mockResolvedValueOnce({ mtimeMs: freshTime });
    fsMock.unlink.mockResolvedValue(undefined);

    await cleanStaleAttachments('/tmp/attachments');

    expect(fsMock.unlink).toHaveBeenCalledTimes(1);
    expect(fsMock.unlink).toHaveBeenCalledWith('/tmp/attachments/stale.jpg');
  });

  it('continues processing remaining files when stat fails for one file', async () => {
    const staleTime = Date.now() - 10 * DAY_MS;
    fsMock.readdir.mockResolvedValue(['err.jpg', 'ok.jpg']);
    fsMock.stat
      .mockRejectedValueOnce(new Error('EPERM'))
      .mockResolvedValueOnce({ mtimeMs: staleTime });
    fsMock.unlink.mockResolvedValue(undefined);

    await expect(cleanStaleAttachments('/tmp/attachments')).resolves.toBeUndefined();

    // Second file should still be processed and removed
    expect(fsMock.unlink).toHaveBeenCalledTimes(1);
    expect(fsMock.unlink).toHaveBeenCalledWith('/tmp/attachments/ok.jpg');
  });

  it('continues processing remaining files when unlink fails for one file', async () => {
    const staleTime = Date.now() - 10 * DAY_MS;
    fsMock.readdir.mockResolvedValue(['fail.jpg', 'ok.jpg']);
    fsMock.stat.mockResolvedValue({ mtimeMs: staleTime });
    fsMock.unlink
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockResolvedValueOnce(undefined);

    await expect(cleanStaleAttachments('/tmp/attachments')).resolves.toBeUndefined();

    expect(fsMock.unlink).toHaveBeenCalledTimes(2);
  });
});
