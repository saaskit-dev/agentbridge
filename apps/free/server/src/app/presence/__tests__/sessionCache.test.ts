import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  machineFindUnique: vi.fn(),
  sessionUpdate: vi.fn(),
  machineUpdate: vi.fn(),
  sessionCacheCounterInc: vi.fn(),
  databaseUpdatesSkippedCounterInc: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
  db: {
    session: {
      findUnique: mocks.sessionFindUnique,
      update: mocks.sessionUpdate,
    },
    machine: {
      findUnique: mocks.machineFindUnique,
      update: mocks.machineUpdate,
    },
  },
}));

vi.mock('@/app/monitoring/metrics2', () => ({
  sessionCacheCounter: { inc: mocks.sessionCacheCounterInc },
  databaseUpdatesSkippedCounter: { inc: mocks.databaseUpdatesSkippedCounterInc },
}));

vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    info(...args: unknown[]) {
      mocks.loggerInfo(...args);
    }
    error(...args: unknown[]) {
      mocks.loggerError(...args);
    }
  },
}));

describe('ActivityCache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.sessionFindUnique.mockResolvedValue({
      id: 'sess-1',
      accountId: 'user-1',
      status: 'active',
      lastActiveAt: new Date(0),
    });
    mocks.machineFindUnique.mockResolvedValue({
      id: 'machine-1',
      accountId: 'user-1',
      lastActiveAt: new Date(0),
    });
    mocks.sessionUpdate.mockResolvedValue(undefined);
    mocks.machineUpdate.mockResolvedValue(undefined);
  });

  it('retains pending session update when flush fails', async () => {
    const { ActivityCache } = await import('../sessionCache');
    const cache = new ActivityCache();

    await cache.isSessionValid('sess-1', 'user-1');
    expect(cache.queueSessionUpdate('sess-1', 60_000)).toBe(true);

    mocks.sessionUpdate.mockRejectedValueOnce(new Error('db down'));

    await (cache as any).flushPendingUpdates();

    const sessionEntry = (cache as any).sessionCache.get('sess-1');
    expect(sessionEntry.pendingUpdate).toBe(60_000);
    expect(sessionEntry.lastUpdateSent).toBe(0);

    await cache.shutdown();
  });

  it('awaits final flush during shutdown', async () => {
    const { ActivityCache } = await import('../sessionCache');
    const cache = new ActivityCache();

    await cache.isSessionValid('sess-1', 'user-1');
    expect(cache.queueSessionUpdate('sess-1', 60_000)).toBe(true);

    let resolveUpdate: (() => void) | null = null;
    const updatePromise = new Promise<void>(resolve => {
      resolveUpdate = resolve;
    });
    mocks.sessionUpdate.mockReturnValueOnce(updatePromise);

    let shutdownFinished = false;
    const shutdownPromise = cache.shutdown().then(() => {
      shutdownFinished = true;
    });

    await Promise.resolve();
    expect(shutdownFinished).toBe(false);

    resolveUpdate?.();
    await shutdownPromise;

    expect(shutdownFinished).toBe(true);
    const sessionEntry = (cache as any).sessionCache.get('sess-1');
    expect(sessionEntry.pendingUpdate).toBeNull();
    expect(sessionEntry.lastUpdateSent).toBe(60_000);
  });
});
