/**
 * PushableAsyncIterable - A generic async iterable that allows external pushing
 * Provides a clean API for creating async iterables that can be pushed to from external sources
 */
import { toError } from '@saaskit-dev/agentbridge';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('utils/PushableAsyncIterable');

/** Monotonically increasing ID so each instance is distinguishable in logs. */
let instanceCounter = 0;

/**
 * A pushable async iterable implementation
 * Allows asynchronous pushing of values that can be consumed via for-await-of
 */
export class PushableAsyncIterable<T> implements AsyncIterableIterator<T> {
  private queue: T[] = [];
  private waiters: Array<{
    resolve: (value: IteratorResult<T>) => void;
    reject: (error: Error) => void;
  }> = [];
  private isDone = false;
  private error: Error | null = null;
  private started = false;
  private pushCount = 0;
  private readonly instanceId = ++instanceCounter;

  constructor() {}

  /**
   * Push a value to the iterable
   */
  push(value: T): void {
    if (this.isDone) {
      // Silently drop — this can happen legitimately when a backend pushes
      // a final message concurrently with output.end() (e.g. PTY onData
      // firing in the same tick as onExit). Throwing here would crash the
      // daemon process.
      logger.debug('[PushableAsyncIterable] push after done, dropping', {
        id: this.instanceId,
        queueSize: this.queue.length,
        totalPushed: this.pushCount,
      });
      return;
    }

    if (this.error) {
      throw this.error;
    }

    this.pushCount++;

    // If there's a waiting consumer, deliver directly
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value });
    } else {
      // Otherwise queue the value
      this.queue.push(value);
    }
  }

  /**
   * Mark the iterable as complete
   */
  end(): void {
    if (this.isDone) {
      logger.debug('[PushableAsyncIterable] end() called but already done', {
        id: this.instanceId,
      });
      return;
    }

    logger.debug('[PushableAsyncIterable] ending', {
      id: this.instanceId,
      queueSize: this.queue.length,
      waiters: this.waiters.length,
      totalPushed: this.pushCount,
    });
    this.isDone = true;
    this.cleanup();
  }

  /**
   * Set an error on the iterable
   */
  setError(err: Error): void {
    if (this.isDone) {
      logger.debug('[PushableAsyncIterable] setError() called but already done', {
        id: this.instanceId,
        error: err.message,
      });
      return;
    }

    logger.warn('[PushableAsyncIterable] error set', {
      id: this.instanceId,
      error: err.message,
      waiters: this.waiters.length,
      totalPushed: this.pushCount,
    });
    this.error = err;
    this.isDone = true;
    this.cleanup();
  }

  /**
   * Cleanup waiting consumers
   */
  private cleanup(): void {
    const waiterCount = this.waiters.length;
    // Resolve or reject all waiting consumers
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (this.error) {
        waiter.reject(this.error);
      } else {
        waiter.resolve({ done: true, value: undefined });
      }
    }
    if (waiterCount > 0) {
      logger.debug('[PushableAsyncIterable] cleanup resolved waiters', {
        id: this.instanceId,
        waiterCount,
        hadError: this.error != null,
      });
    }
  }

  /**
   * AsyncIterableIterator implementation
   */
  async next(): Promise<IteratorResult<T>> {
    // Return queued items first
    if (this.queue.length > 0) {
      return { done: false, value: this.queue.shift()! };
    }

    // Check if we're done or have an error
    if (this.isDone) {
      if (this.error) {
        throw this.error;
      }
      return { done: true, value: undefined };
    }

    // Wait for next value
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  /**
   * AsyncIterableIterator return implementation
   */
  async return(_value?: any): Promise<IteratorResult<T>> {
    this.end();
    return { done: true, value: undefined };
  }

  /**
   * AsyncIterableIterator throw implementation
   */
  async throw(e: any): Promise<IteratorResult<T>> {
    this.setError(toError(e));
    throw this.error;
  }

  /**
   * Make this iterable
   */
  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    if (this.started) {
      throw new Error('PushableAsyncIterable can only be iterated once');
    }
    this.started = true;
    return this;
  }

  /**
   * Check if the iterable is done
   */
  get done(): boolean {
    return this.isDone;
  }

  /**
   * Check if the iterable has an error
   */
  get hasError(): boolean {
    return this.error !== null;
  }

  /**
   * Get the current queue size
   */
  get queueSize(): number {
    return this.queue.length;
  }

  /**
   * Get the number of waiting consumers
   */
  get waiterCount(): number {
    return this.waiters.length;
  }
}
