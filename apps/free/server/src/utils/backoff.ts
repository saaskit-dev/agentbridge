import { AbortedExeption } from './aborted';
import { delay } from './delay';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const log = new Logger('utils/backoff');

function exponentialRandomizedBackoffDelay(
  failureCount: number,
  minDelay: number,
  maxDelay: number,
  factor = 0.5
) {
  const exponentialDelay = Math.min(maxDelay, minDelay * Math.pow(2, failureCount));
  const jitterRange = exponentialDelay * factor;
  const randomJitter = (Math.random() * 2 - 1) * jitterRange;
  const delayWithJitter = exponentialDelay + randomJitter;
  return Math.floor(Math.max(minDelay, Math.min(maxDelay, delayWithJitter)));
}

type BackoffFunc = <T>(callback: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

export function createBackoff(opts?: {
  minDelay?: number;
  maxDelay?: number;
  factor?: number;
}): BackoffFunc {
  return async <T>(callback: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const currentFailureCount = 0;
    const minDelay = opts && opts.minDelay !== undefined ? opts.minDelay : 250;
    const maxDelay = opts && opts.maxDelay !== undefined ? opts.maxDelay : 10000;
    const factor = opts && opts.factor !== undefined ? opts.factor : 0.5;
    while (true) {
      try {
        return await callback();
      } catch (e: any) {
        // Check if error is due to abort
        if (AbortedExeption.isAborted(e)) {
          throw e;
        }
        log.warn(`Backoff retry after error: ${safeStringify(e)}`);
        const waitForRequest = exponentialRandomizedBackoffDelay(
          currentFailureCount,
          minDelay,
          maxDelay,
          factor
        );
        await delay(waitForRequest, signal);
      }
    }
  };
}

export const backoff = createBackoff();
