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

describe('storage drafts', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('__DEV__', false);
    const { kvStore } = await import('./cachedKVStore');
    kvStore.clearAll();
  });

  it('persists drafts without rewriting cached sessions and patches list data', async () => {
    const { storage } = await import('./storage');
    const { loadCachedSessions, loadSessionDrafts } = await import('./persistence');

    const sessionId = `sess-draft-${Date.now()}`;
    storage.getState().applySessions([buildSession(sessionId) as any]);

    storage.getState().updateSessionDraft(sessionId, 'hello world');

    expect(storage.getState().sessions[sessionId]?.draft).toBe('hello world');
    expect(loadSessionDrafts()).toEqual({ [sessionId]: 'hello world' });
    expect(loadCachedSessions()).toEqual([]);

    const activeSessionsItem = storage
      .getState()
      .sessionListViewData?.find(item => item.type === 'active-sessions');
    expect(activeSessionsItem?.type).toBe('active-sessions');
    if (activeSessionsItem?.type === 'active-sessions') {
      expect(activeSessionsItem.sessions[0]?.draft).toBe('hello world');
    }

    storage.getState().updateSessionDraft(sessionId, null);

    expect(storage.getState().sessions[sessionId]?.draft).toBeNull();
    expect(loadSessionDrafts()).toEqual({});
  });
});
