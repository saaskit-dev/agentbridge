/**
 * @agentbridge/utils - Backoff
 *
 * Compatible with free/happy backoff implementation:
 * - Linear interpolation to max delay
 * - Infinite retries (no maxRetries limit)
 * - Random jitter
 */

/**
 * Check if error is an authentication error (should not retry)
 */
function isAuthError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (e.status === 401) return true;
    if (typeof e.message === 'string') {
      if (e.message.includes('401')) return true;
      if (e.message.includes('Unauthorized')) return true;
    }
  }
  return false;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Backoff function type
 */
export type BackoffFunction<T> = (fn: () => Promise<T>) => Promise<T>;

/**
 * Backoff options
 */
export interface BackoffOptions {
  /** Minimum delay in ms (default: 250) */
  minDelay?: number;
  /** Maximum delay in ms (default: 1000) */
  maxDelay?: number;
  /** Max failures before using maxDelay (default: 50) */
  maxFailureCount?: number;
  /** Error callback */
  onError?: (error: unknown, failureCount: number) => void;
}

/**
 * Calculate backoff delay using linear interpolation (free compatible)
 * Note: free uses Math.max which means delay range is [0, maxDelayForCount] from the start
 */
function calculateBackoffDelay(
  failureCount: number,
  minDelay: number,
  maxDelay: number,
  maxFailureCount: number
): number {
  // EXACTLY matching free's implementation:
  // let maxDelayRet = minDelay + ((maxDelay - minDelay) / maxFailureCount) * Math.max(currentFailureCount, maxFailureCount);
  // return Math.round(Math.random() * maxDelayRet);
  const maxDelayRet = minDelay + ((maxDelay - minDelay) / maxFailureCount) * Math.max(failureCount, maxFailureCount);
  return Math.round(Math.random() * maxDelayRet);
}

/**
 * Create a backoff function with configurable parameters
 *
 * Compatible with free/happy implementation:
 * - Infinite retries (never gives up unless auth error)
 * - Linear interpolation to max delay
 * - Random jitter
 */
export function createBackoff(options: BackoffOptions = {}): BackoffFunction<unknown> {
  const {
    minDelay = 250,
    maxDelay = 1000,
    maxFailureCount = 50,
    onError,
  } = options;

  let failureCount = 0;

  return async function <T>(fn: () => Promise<T>): Promise<T> {
    while (true) {
      try {
        const result = await fn();
        // Reset failure count on success
        failureCount = 0;
        return result;
      } catch (error: unknown) {
        // Don't retry auth errors
        if (isAuthError(error)) {
          throw error;
        }

        // Increment failure count (capped at maxFailureCount)
        if (failureCount < maxFailureCount) {
          failureCount++;
        }

        // Call error callback if provided
        if (onError) {
          onError(error, failureCount);
        }

        // Calculate delay using linear interpolation (free/happy compatible)
        const delay = calculateBackoffDelay(failureCount, minDelay, maxDelay, maxFailureCount);
        await sleep(delay);
      }
    }
  };
}

/**
 * Default backoff function (free/happy compatible)
 * - minDelay: 250ms
 * - maxDelay: 1000ms
 * - maxFailureCount: 50
 * - Infinite retries
 * - Linear interpolation with random jitter
 */
export const backoff = createBackoff({
  onError: (e) => { console.warn(e); }
});
