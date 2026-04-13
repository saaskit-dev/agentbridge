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

function buildSession(sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
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
    queuedMessages: [],
    permissionMode: 'accept-edits',
    desiredAgentMode: null,
    modelMode: null,
    desiredConfigOptions: null,
    ...overrides,
  };
}

describe('storage queued messages', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('__DEV__', false);
    const { kvStore } = await import('./cachedKVStore');
    kvStore.clearAll();
  });

  it('enqueues, updates, and removes queued messages for a session', async () => {
    const { storage } = await import('./storage');

    const sessionId = `sess-${Date.now()}`;
    storage.getState().applySessions([buildSession(sessionId) as any]);

    storage.getState().enqueueSessionQueuedMessage(sessionId, {
      id: 'queued-1',
      text: 'first',
      createdAt: 1_100,
      updatedAt: 1_100,
      permissionMode: 'accept-edits',
      model: null,
      fallbackModel: null,
    });

    expect(storage.getState().sessions[sessionId]?.queuedMessages).toEqual([
      {
        id: 'queued-1',
        text: 'first',
        createdAt: 1_100,
        updatedAt: 1_100,
        permissionMode: 'accept-edits',
        model: null,
        fallbackModel: null,
      },
    ]);

    storage.getState().updateSessionQueuedMessage(sessionId, {
      id: 'queued-1',
      text: 'edited',
      createdAt: 1_100,
      updatedAt: 1_200,
      permissionMode: 'accept-edits',
      model: 'gemini-2.5-pro',
      fallbackModel: null,
    });

    expect(storage.getState().sessions[sessionId]?.queuedMessages?.[0]).toEqual({
      id: 'queued-1',
      text: 'edited',
      createdAt: 1_100,
      updatedAt: 1_200,
      permissionMode: 'accept-edits',
      model: 'gemini-2.5-pro',
      fallbackModel: null,
    });

    storage.getState().removeSessionQueuedMessage(sessionId, 'queued-1');
    expect(storage.getState().sessions[sessionId]?.queuedMessages).toEqual([]);

    storage.getState().deleteSession(sessionId);
  });

  it('preserves existing queued messages when server session updates arrive', async () => {
    const { storage } = await import('./storage');

    const sessionId = `sess-merge-${Date.now()}`;
    storage.getState().applySessions([buildSession(sessionId, { updatedAt: 2_000 }) as any]);
    storage.getState().enqueueSessionQueuedMessage(sessionId, {
      id: 'queued-1',
      text: 'still queued',
      createdAt: 2_100,
      updatedAt: 2_100,
      permissionMode: 'accept-edits',
      model: null,
      fallbackModel: null,
    });

    storage.getState().applySessions([
      buildSession(sessionId, {
        updatedAt: 3_000,
        thinking: true,
      }) as any,
    ]);

    expect(storage.getState().sessions[sessionId]?.queuedMessages).toEqual([
      {
        id: 'queued-1',
        text: 'still queued',
        createdAt: 2_100,
        updatedAt: 2_100,
        permissionMode: 'accept-edits',
        model: null,
        fallbackModel: null,
      },
    ]);

    storage.getState().deleteSession(sessionId);
  });
});
