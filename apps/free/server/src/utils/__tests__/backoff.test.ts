import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  delay: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../delay', () => ({
  delay: mocks.delay,
}));

vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    warn(...args: unknown[]) {
      mocks.loggerWarn(...args);
    }
  },
}));

vi.mock('@saaskit-dev/agentbridge', () => ({
  safeStringify: (value: unknown) => String(value),
}));

describe('createBackoff', () => {
  const originalRandom = Math.random;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Math.random = vi.fn(() => 0.5);
    mocks.delay.mockResolvedValue(undefined);
  });

  afterEach(() => {
    Math.random = originalRandom;
  });

  it('increases delay after consecutive failures', async () => {
    const { createBackoff } = await import('../backoff');
    const backoff = createBackoff({ minDelay: 100, maxDelay: 1000, factor: 0.5 });

    let attempts = 0;
    const result = await backoff(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error(`boom-${attempts}`);
      }
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(mocks.delay).toHaveBeenNthCalledWith(1, 100, undefined);
    expect(mocks.delay).toHaveBeenNthCalledWith(2, 200, undefined);
  });
});
