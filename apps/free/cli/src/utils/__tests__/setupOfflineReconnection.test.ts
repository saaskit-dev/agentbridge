import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupOfflineReconnection } from '../setupOfflineReconnection';

const mockStartOfflineReconnection = vi.fn();

vi.mock('../serverConnectionErrors', () => ({
  startOfflineReconnection: (...args: unknown[]) => mockStartOfflineReconnection(...args),
}));

describe('setupOfflineReconnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartOfflineReconnection.mockReturnValue({
      cancel: vi.fn(),
      isReconnected: vi.fn(() => false),
      getSession: vi.fn(() => null),
    });
  });

  it('preserves sessionId by default', () => {
    const result = setupOfflineReconnection({
      api: { getOrCreateSession: vi.fn(), sessionSyncClient: vi.fn() } as any,
      sessionId: 'sess-1',
      metadata: { path: '/tmp', host: 'h' } as any,
      state: {},
      initialLastSeq: 42,
      response: null,
      onSessionSwap: vi.fn(),
    });

    expect(result.isOffline).toBe(true);
    expect(result.session.sessionId).toBe('sess-1');
    expect(result.session.getLastSeq()).toBe(42);
  });

  it('uses custom reconnect callback when provided', async () => {
    const reconnect = vi.fn().mockResolvedValue(null);
    const result = setupOfflineReconnection({
      api: { getOrCreateSession: vi.fn(), sessionSyncClient: vi.fn() } as any,
      sessionId: 'sess-2',
      metadata: { path: '/tmp', host: 'h' } as any,
      state: {},
      response: null,
      reconnect,
      onSessionSwap: vi.fn(),
    });

    expect(result.isOffline).toBe(true);
    expect(result.session.sessionId).toBe('sess-2');
    expect(mockStartOfflineReconnection).toHaveBeenCalledOnce();
  });

  it('restores initialLastSeq onto the real session after offline reconnect', async () => {
    const sessionSyncClient = vi.fn((session: { lastSeq?: number }) => ({
      sessionId: 'sess-3',
      getLastSeq: () => session.lastSeq ?? 0,
    }));
    const api = {
      getOrCreateSession: vi.fn(),
      sessionSyncClient,
    } as any;
    const onSessionSwap = vi.fn();
    const reconnect = vi.fn().mockResolvedValue({
      id: 'sess-3',
      metadata: { path: '/tmp', host: 'h' },
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 0,
      capabilities: null,
      capabilitiesVersion: 0,
      encryptionKey: new Uint8Array(32),
      encryptionVariant: 'legacy',
      lastSeq: 0,
    });

    mockStartOfflineReconnection.mockImplementation(({ onReconnected }: { onReconnected: () => Promise<unknown> }) => {
      void onReconnected();
      return {
        cancel: vi.fn(),
        isReconnected: vi.fn(() => true),
        getSession: vi.fn(() => null),
      };
    });

    setupOfflineReconnection({
      api,
      sessionId: 'sess-3',
      metadata: { path: '/tmp', host: 'h' } as any,
      state: {},
      initialLastSeq: 42,
      response: null,
      reconnect,
      onSessionSwap,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(sessionSyncClient).toHaveBeenCalledWith(expect.objectContaining({ lastSeq: 42 }));
    expect(onSessionSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-3',
      })
    );
  });
});
