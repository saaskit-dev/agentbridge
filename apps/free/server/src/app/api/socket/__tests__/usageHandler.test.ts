import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sessionFindFirst: vi.fn(),
  usageReportUpsert: vi.fn(),
  emitEphemeral: vi.fn(),
  buildUsageEphemeral: vi.fn(() => ({ type: 'usage' })),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
  db: {
    session: {
      findFirst: mocks.sessionFindFirst,
    },
    usageReport: {
      upsert: mocks.usageReportUpsert,
    },
  },
}));

vi.mock('@/app/events/eventRouter', () => ({
  eventRouter: {
    emitEphemeral: mocks.emitEphemeral,
  },
  buildUsageEphemeral: mocks.buildUsageEphemeral,
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

import { usageHandler } from '../usageHandler';

function makeSocket() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    triggerUsageReport: async (payload: Record<string, unknown>) =>
      new Promise(resolve => {
        (handlers['usage-report'] as any)?.(payload, resolve);
      }),
  };
}

describe('usageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits localOnly usage updates without persisting them', async () => {
    const socket = makeSocket();
    usageHandler('user-1', socket as any);

    mocks.sessionFindFirst.mockResolvedValue({ id: 'sess-1' });

    const result = await socket.triggerUsageReport({
      key: 'ctx-refresh',
      sessionId: 'sess-1',
      tokens: { total: 123 },
      cost: { total: 0 },
      localOnly: true,
    });

    expect(mocks.sessionFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'sess-1',
        accountId: 'user-1',
      },
    });
    expect(mocks.buildUsageEphemeral).toHaveBeenCalledWith(
      'sess-1',
      'ctx-refresh',
      { total: 123 },
      { total: 0 }
    );
    expect(mocks.emitEphemeral).toHaveBeenCalledTimes(1);
    expect(mocks.usageReportUpsert).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      localOnly: true,
    });
  });
});
