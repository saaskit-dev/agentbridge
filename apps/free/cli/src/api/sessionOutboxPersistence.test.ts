import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockMkdir,
  mockReadFile,
  mockRename,
  mockUnlink,
  mockWriteFile,
  mockChmod,
} = vi.hoisted(() => ({
  mockMkdir: vi.fn(async () => undefined),
  mockReadFile: vi.fn(async () => '[]'),
  mockRename: vi.fn(async () => undefined),
  mockUnlink: vi.fn(async () => undefined),
  mockWriteFile: vi.fn(async () => undefined),
  mockChmod: vi.fn(async () => undefined),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  readFile: mockReadFile,
  rename: mockRename,
  unlink: mockUnlink,
  writeFile: mockWriteFile,
  chmod: mockChmod,
}));

vi.mock('@/configuration', () => ({
  configuration: {
    freeHomeDir: '/tmp/agentbridge-test',
  },
}));

import {
  loadPendingSessionOutbox,
  persistPendingSessionOutbox,
  type PendingOutboxEntry,
  type PendingOutboxMessage,
} from './sessionOutboxPersistence';

describe('sessionOutboxPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('[]');
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockChmod.mockResolvedValue(undefined);
  });

  it('persists only the newest tail when the outbox snapshot is too large', async () => {
    const messages: PendingOutboxMessage[] = [
      { id: 'oldest', content: 'a'.repeat(900_000) },
      { id: 'middle', content: 'b'.repeat(900_000) },
      { id: 'latest', content: 'c'.repeat(900_000) },
    ];

    await persistPendingSessionOutbox('session-1', messages);

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [firstWriteCall] = mockWriteFile.mock.calls as Array<unknown[]>;
    expect(firstWriteCall).toBeTruthy();
    const persistedPayload = firstWriteCall?.[1];
    expect(typeof persistedPayload).toBe('string');

    const parsed = String(persistedPayload)
      .split('\n')
      .map(line => JSON.parse(line) as PendingOutboxEntry);
    expect(parsed).toEqual([
      {
        type: 'persisted-outbox-placeholder',
        originalMessageId: 'oldest',
        reason: 'message_too_large',
        originalContentLength: 900_000,
        createdAt: expect.any(Number),
      },
      {
        id: 'middle',
        content: 'b'.repeat(900_000),
      },
      {
        id: 'latest',
        content: 'c'.repeat(900_000),
      },
    ]);
  });

  it('does not throw when serializing the snapshot fails', async () => {
    const originalStringify = JSON.stringify;
    const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation(value => {
      if (
        value &&
        typeof value === 'object' &&
        'id' in value &&
        (value as { id?: string }).id === 'only'
      ) {
        throw new RangeError('Invalid string length');
      }
      return originalStringify(value);
    });

    try {
      await expect(
        persistPendingSessionOutbox('session-2', [{ id: 'only', content: 'payload' }])
      ).resolves.toBeUndefined();

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const [firstWriteCall] = mockWriteFile.mock.calls as Array<unknown[]>;
      const persistedPayload = String(firstWriteCall?.[1]);
      expect(JSON.parse(persistedPayload)).toMatchObject({
        type: 'persisted-outbox-placeholder',
        originalMessageId: 'only',
        reason: 'serialization_failed',
        originalContentLength: 'payload'.length,
        error: 'RangeError: Invalid string length',
      });
    } finally {
      stringifySpy.mockRestore();
    }
  });

  it('loads legacy json array payloads', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify([
        { id: 'legacy-1', content: 'first' },
        { id: 'legacy-2', content: 'second' },
      ])
    );

    await expect(loadPendingSessionOutbox('session-3')).resolves.toEqual([
      { id: 'legacy-1', content: 'first' },
      { id: 'legacy-2', content: 'second' },
    ]);
  });

  it('loads ndjson payloads and ignores malformed lines', async () => {
    mockReadFile.mockResolvedValue(
      [
        JSON.stringify({ id: 'line-1', content: 'first' }),
        'not-json',
        JSON.stringify({ nope: true }),
        JSON.stringify({
          type: 'persisted-outbox-placeholder',
          originalMessageId: 'dropped-1',
          reason: 'message_too_large',
          originalContentLength: 123,
          createdAt: 1,
        }),
        JSON.stringify({ id: 'line-2', content: 'second' }),
      ].join('\n')
    );

    await expect(loadPendingSessionOutbox('session-4')).resolves.toEqual([
      { id: 'line-1', content: 'first' },
      {
        type: 'persisted-outbox-placeholder',
        originalMessageId: 'dropped-1',
        reason: 'message_too_large',
        originalContentLength: 123,
        createdAt: 1,
      },
      { id: 'line-2', content: 'second' },
    ]);
  });
});
