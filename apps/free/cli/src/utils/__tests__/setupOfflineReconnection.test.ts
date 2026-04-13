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
});
