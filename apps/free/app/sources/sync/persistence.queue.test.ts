import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./messageDB', () => {
  const asyncNoop = vi.fn(async () => undefined);
  return {
    messageDB: new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (prop === 'kvGetAll') {
            return vi.fn(async () => []);
          }
          return asyncNoop;
        },
      }
    ),
  };
});

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-queue',
    seq: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    status: 'active',
    activeAt: 1_000,
    metadata: null,
    metadataVersion: 0,
    agentState: null,
    agentStateVersion: 0,
    capabilities: null,
    capabilitiesVersion: 0,
    thinking: false,
    thinkingAt: 0,
    presence: 'online',
    draft: null,
    permissionMode: 'accept-edits',
    desiredAgentMode: null,
    modelMode: null,
    desiredConfigOptions: null,
    queuedMessages: [],
    ...overrides,
  };
}

describe('session cache queued messages', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('__DEV__', false);
    const { kvStore } = await import('./cachedKVStore');
    kvStore.clearAll();
  });

  it('persists and restores queued messages from cached sessions', async () => {
    const { saveCachedSessions, loadCachedSessions } = await import('./persistence');

    saveCachedSessions([
      buildSession({
        queuedMessages: [
          {
            id: 'queued-1',
            text: 'first queued',
            createdAt: 1_111,
            updatedAt: 1_222,
            permissionMode: 'accept-edits',
            model: 'gemini-2.5-pro',
            fallbackModel: null,
            attachments: [
              {
                id: 'att-1',
                mimeType: 'image/jpeg',
                filename: 'photo.jpg',
                localUri: 'file:///tmp/photo.jpg',
              },
            ],
          },
          {
            id: 'queued-2',
            text: 'second queued',
            createdAt: 1_333,
            updatedAt: 1_444,
            permissionMode: 'yolo',
            model: null,
            fallbackModel: null,
          },
        ],
      }),
    ] as any);

    const sessions = loadCachedSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.queuedMessages).toEqual([
      {
        id: 'queued-1',
        text: 'first queued',
        createdAt: 1_111,
        updatedAt: 1_222,
        permissionMode: 'accept-edits',
        model: 'gemini-2.5-pro',
        fallbackModel: null,
        attachments: [
          {
            id: 'att-1',
            mimeType: 'image/jpeg',
            filename: 'photo.jpg',
            localUri: 'file:///tmp/photo.jpg',
          },
        ],
      },
      {
        id: 'queued-2',
        text: 'second queued',
        createdAt: 1_333,
        updatedAt: 1_444,
        permissionMode: 'yolo',
        model: null,
        fallbackModel: null,
      },
    ]);
  });

  it('drops malformed queued messages during restore', async () => {
    const { saveCachedSessions, loadCachedSessions } = await import('./persistence');

    saveCachedSessions([
      buildSession({
        queuedMessages: [
          {
            id: 'valid',
            text: 'kept',
            createdAt: 2_000,
            updatedAt: 2_100,
            permissionMode: 'accept-edits',
            model: null,
            fallbackModel: null,
          },
          {
            id: 'broken',
            text: 123,
            createdAt: 2_200,
            updatedAt: 2_300,
            permissionMode: 'accept-edits',
            model: null,
            fallbackModel: null,
          },
        ],
      }),
    ] as any);

    const sessions = loadCachedSessions();
    expect(sessions[0]?.queuedMessages).toEqual([
      {
        id: 'valid',
        text: 'kept',
        createdAt: 2_000,
        updatedAt: 2_100,
        permissionMode: 'accept-edits',
        model: null,
        fallbackModel: null,
      },
    ]);
  });
});
