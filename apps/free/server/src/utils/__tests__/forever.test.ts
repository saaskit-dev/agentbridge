import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  keepAlive: vi.fn(),
  backoff: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../shutdown', () => ({
  keepAlive: mocks.keepAlive,
  shutdownSignal: { aborted: false },
}));

vi.mock('../backoff', () => ({
  backoff: mocks.backoff,
}));

vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    error(...args: unknown[]) {
      mocks.loggerError(...args);
    }
  },
}));

describe('forever', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.backoff.mockResolvedValue(undefined);
  });

  it('logs when detached keepAlive task rejects unexpectedly', async () => {
    const rejection = Promise.reject(new Error('worker boom'));
    rejection.catch(() => undefined);
    mocks.keepAlive.mockReturnValue(rejection);
    const { forever } = await import('../forever');

    forever('job-1', async () => {});
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.loggerError).toHaveBeenCalledWith(
      '[forever] background task exited unexpectedly',
      expect.objectContaining({ name: 'job-1', error: 'Error: worker boom' })
    );
  });
});
