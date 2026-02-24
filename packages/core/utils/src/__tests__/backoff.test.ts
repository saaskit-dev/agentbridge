import { describe, it, expect, vi } from 'vitest';
import { backoff, createBackoff } from '../backoff';

describe('backoff', () => {
  it('executes successful operation', async () => {
    const result = await backoff(async () => 'success');
    expect(result).toBe('success');
  });

  it('retries on transient errors until success', async () => {
    let attempts = 0;

    const result = await backoff(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Temporary error');
      }
      return 'success';
    });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('does not retry auth errors (401)', async () => {
    let attempts = 0;

    await expect(
      backoff(async () => {
        attempts++;
        const error = new Error('Unauthorized');
        (error as any).status = 401;
        throw error;
      })
    ).rejects.toThrow('Unauthorized');

    expect(attempts).toBe(1);
  });

  it('does not retry errors with 401 in message', async () => {
    let attempts = 0;

    await expect(
      backoff(async () => {
        attempts++;
        throw new Error('Received 401 Unauthorized');
      })
    ).rejects.toThrow('401');

    expect(attempts).toBe(1);
  });

  it('retries indefinitely (free/happy compatible)', async () => {
    vi.useFakeTimers();

    let attempts = 0;
    const promise = backoff(async () => {
      attempts++;
      if (attempts < 10) {
        throw new Error(`Error ${attempts}`);
      }
      return 'success';
    });

    // Run all timers - should succeed after 10 attempts
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(attempts).toBe(10);

    vi.useRealTimers();
  });
});

describe('createBackoff', () => {
  it('creates backoff with custom options', async () => {
    const customBackoff = createBackoff({
      minDelay: 10,
      maxDelay: 50,
    });

    let attempts = 0;

    const result = await customBackoff(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Temporary error');
      }
      return 'success';
    });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('respects minDelay', async () => {
    vi.useFakeTimers();

    const customBackoff = createBackoff({
      minDelay: 100,
    });

    let attempts = 0;
    const promise = customBackoff(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('First error');
      }
      return 'success';
    });

    // Fast-forward time
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe('success');

    vi.useRealTimers();
  });

  it('uses linear interpolation to max delay (free/happy compatible)', async () => {
    vi.useFakeTimers();

    const customBackoff = createBackoff({
      minDelay: 10,
      maxDelay: 100,
      maxFailureCount: 5,
    });

    let attempts = 0;

    // This will eventually succeed, proving it keeps retrying
    const promise = customBackoff(async () => {
      attempts++;
      if (attempts < 10) {
        throw new Error(`Error ${attempts}`);
      }
      return 'success';
    });

    // Run all timers
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(attempts).toBe(10);

    vi.useRealTimers();
  });

  it('calls onError callback on each failure', async () => {
    vi.useFakeTimers();

    const errors: Array<{ error: unknown; count: number }> = [];
    const customBackoff = createBackoff({
      minDelay: 1,
      onError: (error, count) => {
        errors.push({ error, count });
      },
    });

    let attempts = 0;
    const promise = customBackoff(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error(`Error ${attempts}`);
      }
      return 'success';
    });

    await vi.runAllTimersAsync();
    await promise;

    expect(errors.length).toBe(2);
    expect(errors[0].count).toBe(1);
    expect(errors[1].count).toBe(2);

    vi.useRealTimers();
  });
});
