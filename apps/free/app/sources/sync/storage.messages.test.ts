import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedMessage } from './typesRaw';

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

function buildUserTextMessage(
  id: string,
  seq: number,
  createdAt: number,
  text: string
): NormalizedMessage {
  return {
    id,
    seq,
    createdAt,
    isSidechain: false,
    role: 'user',
    content: {
      type: 'text',
      text,
    },
  };
}

describe('storage messages', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('__DEV__', false);
    const { kvStore } = await import('./cachedKVStore');
    kvStore.clearAll();
  });

  it('incrementally merges message batches without changing visible order', async () => {
    const { storage } = await import('./storage');

    const sessionId = `sess-messages-${Date.now()}`;
    storage.getState().applySessions([buildSession(sessionId) as any]);

    storage.getState().applyMessages(sessionId, [
      buildUserTextMessage('m1', 1, 1_000, 'first'),
      buildUserTextMessage('m3', 3, 3_000, 'third'),
    ]);

    storage
      .getState()
      .applyMessages(sessionId, [buildUserTextMessage('m2', 2, 2_000, 'second')]);

    const messages = storage.getState().sessionMessages[sessionId]?.messages ?? [];
    expect(messages.map(message => message.createdAt)).toEqual([3_000, 2_000, 1_000]);
    expect(messages[2]).toMatchObject({ text: 'first', createdAt: 1_000 });
  });

  it('drops only targeted session message caches', async () => {
    const { storage } = await import('./storage');

    const firstSessionId = `sess-drop-1-${Date.now()}`;
    const secondSessionId = `sess-drop-2-${Date.now()}`;
    storage.getState().applySessions([
      buildSession(firstSessionId) as any,
      buildSession(secondSessionId, { status: 'offline', presence: 1_000 }) as any,
    ]);

    storage
      .getState()
      .applyMessages(firstSessionId, [buildUserTextMessage('first', 1, 1_000, 'one')]);
    storage
      .getState()
      .applyMessages(secondSessionId, [buildUserTextMessage('second', 1, 1_000, 'two')]);

    storage.getState().dropSessionMessages([secondSessionId]);

    expect(storage.getState().sessionMessages[firstSessionId]).toBeDefined();
    expect(storage.getState().sessionMessages[secondSessionId]).toBeUndefined();
  });
});
