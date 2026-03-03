/**
 * AsyncIterableQueue - A simple async iterable queue
 *
 * An async iterable message queue that allows pushing items and consuming
 * them asynchronously via `for await...of` syntax.
 *
 * (but without SDK-specific types)
 */

/**
 * A generic async iterable queue
 *
 * @example
 * ```typescript
 * const queue = new AsyncIterableQueue<string>();
 *
 * // Producer
 * queue.push('hello');
 * queue.push('world');
 * queue.close();
 *
 * // Consumer
 * for await (const item of queue) {
 *   console.log(item);
 * }
 * ```
 */
export class AsyncIterableQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiters: Array<(value: T | undefined) => void> = [];
  private closed = false;
  private closePromise?: Promise<void>;
  private closeResolve?: () => void;

  constructor() {
    this.closePromise = new Promise((resolve) => {
      this.closeResolve = resolve;
    });
  }

  /**
   * Push an item to the queue
   * If there's a waiting consumer, deliver directly
   */
  push(item: T): void {
    if (this.closed) {
      throw new Error('Cannot push to closed queue');
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      // Deliver directly to waiting consumer
      waiter(item);
    } else {
      // Queue for later consumption
      this.queue.push(item);
    }
  }

  /**
   * Push multiple items to the queue
   */
  pushMany(items: T[]): void {
    for (const item of items) {
      this.push(item);
    }
  }

  /**
   * Close the queue - no more items can be pushed
   * Iterators will finish after consuming remaining items
   */
  close(): void {
    this.closed = true;
    this.closeResolve?.();
    // Resolve all waiters with undefined to signal end
    for (const waiter of this.waiters) {
      waiter(undefined);
    }
    this.waiters = [];
  }

  /**
   * Check if the queue is closed
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Get the current queue size (number of queued items)
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Check if the queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Async iterator implementation
   */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const item = this.queue.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }

      if (this.closed) {
        return;
      }

      // Wait for next item
      const nextItem = await this.waitForNext();
      if (nextItem === undefined) {
        return;
      }
      yield nextItem;
    }
  }

  /**
   * Wait for the next item or queue closure
   */
  private waitForNext(): Promise<T | undefined> {
    return new Promise((resolve) => {
      if (this.closed) {
        resolve(undefined);
        return;
      }

      const waiter = (value: T | undefined) => resolve(value);
      this.waiters.push(waiter);

      // Also listen for close event
      this.closePromise?.then(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) {
          this.waiters.splice(index, 1);
          resolve(undefined);
        }
      });
    });
  }

  /**
   * Create an async iterator that can be aborted
   */
  async *iterateWithAbort(signal: AbortSignal): AsyncGenerator<T, void, unknown> {
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(new Error('Aborted'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    });

    while (true) {
      const item = this.queue.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }

      if (this.closed) {
        return;
      }

      // Wait for next item or abort
      try {
        const nextItem = await Promise.race([
          this.waitForNext(),
          abortPromise
        ]);
        if (nextItem === undefined) {
          return;
        }
        yield nextItem;
      } catch (error) {
        // Aborted
        return;
      }
    }
  }

  /**
   * Collect all remaining items into an array
   * Useful for draining the queue
   */
  drain(): T[] {
    const items = [...this.queue];
    this.queue = [];
    return items;
  }

  /**
   * Clear all queued items without processing
   */
  clear(): void {
    this.queue = [];
  }
}
