export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

export function exponentialBackoffDelay(
  currentFailureCount: number,
  minDelay: number,
  maxDelay: number,
  maxFailureCount: number
) {
  const maxDelayRet =
    minDelay +
    ((maxDelay - minDelay) / maxFailureCount) * Math.min(currentFailureCount, maxFailureCount);
  return Math.round(Math.random() * maxDelayRet);
}

export type BackoffFunc = <T>(callback: () => Promise<T>) => Promise<T>;

export function createBackoff(opts?: {
  onError?: (e: any, failuresCount: number) => void;
  minDelay?: number;
  maxDelay?: number;
  maxFailureCount?: number;
  /** Maximum wall-clock duration (ms) before giving up and re-throwing. Default: 60 000. Set 0 to disable. */
  maxDuration?: number;
}): BackoffFunc {
  return async <T>(callback: () => Promise<T>): Promise<T> => {
    let currentFailureCount = 0;
    const startedAt = Date.now();
    const minDelay = opts && opts.minDelay !== undefined ? opts.minDelay : 250;
    const maxDelay = opts && opts.maxDelay !== undefined ? opts.maxDelay : 1000;
    const maxFailureCount = opts && opts.maxFailureCount !== undefined ? opts.maxFailureCount : 50;
    const maxDuration = opts && opts.maxDuration !== undefined ? opts.maxDuration : 60_000;
    while (true) {
      try {
        return await callback();
      } catch (e) {
        if (maxDuration > 0 && Date.now() - startedAt >= maxDuration) {
          throw e;
        }
        if (currentFailureCount < maxFailureCount) {
          currentFailureCount++;
        }
        if (opts && opts.onError) {
          opts.onError(e, currentFailureCount);
        }
        const waitForRequest = exponentialBackoffDelay(
          currentFailureCount,
          minDelay,
          maxDelay,
          maxFailureCount
        );
        await delay(waitForRequest);
      }
    }
  };
}

export const backoff = createBackoff();
