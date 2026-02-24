/**
 * @agentbridge/utils - Message Queue
 * Async message queue with mode isolation for agent communication
 */

/**
 * Message hash function type
 */
export type MessageHashFunction<T> = (item: T) => string;

/**
 * Queued message item
 */
export interface QueuedMessage<M = unknown> {
  message: string;
  mode: M;
  isolate: boolean;
  hash: string;
}

/**
 * Wait result from queue
 */
export type WaitResult<M = unknown> = QueuedMessage<M> | null;

/**
 * MessageQueue options
 */
export interface MessageQueueOptions<T> {
  /** Function to compute hash for mode isolation */
  hashFunction?: MessageHashFunction<T>;
  /** Maximum queue size (default: 100) */
  maxSize?: number;
}

/**
 * MessageQueue - Advanced message queue with mode isolation
 *
 * Messages with different modes are isolated - when mode changes,
 * a new "session" effectively starts. This is useful for AI agents
 * where changing permission mode or model requires restarting.
 *
 * @example
 * ```typescript
 * interface Mode {
 *   permissionMode: 'default' | 'yolo'
 *   model?: string
 * }
 *
 * const queue = new MessageQueue<Mode>((mode) =>
 *   JSON.stringify({ permissionMode: mode.permissionMode, model: mode.model })
 * )
 *
 * queue.push('Hello', { permissionMode: 'default' })
 * queue.push('Continue', { permissionMode: 'yolo' }) // Different mode = isolation
 *
 * const batch = await queue.waitForMessagesAndGetAsString()
 * ```
 */
export class MessageQueue<T = unknown> {
  private queue: QueuedMessage<T>[] = [];
  private resolvers: Array<(value: WaitResult<T>) => void> = [];
  private hashFunction: MessageHashFunction<T>;
  private maxSize: number;
  private aborted = false;

  constructor(hashFunction?: MessageHashFunction<T>, options?: MessageQueueOptions<T>) {
    this.hashFunction = hashFunction ?? ((item: T) => JSON.stringify(item));
    this.maxSize = options?.maxSize ?? 100;
  }

  /**
   * Push a message to the queue
   * @returns true if pushed, false if queue is full
   */
  push(message: string, mode: T): boolean {
    if (this.aborted) {
      return false;
    }

    if (this.queue.length >= this.maxSize) {
      console.warn('[MessageQueue] Queue is full, dropping oldest message');
      this.queue.shift();
    }

    const hash = this.hashFunction(mode);
    const item: QueuedMessage<T> = {
      message,
      mode,
      isolate: false,
      hash,
    };

    this.queue.push(item);

    // Resolve any waiting consumers
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver(this.queue.shift() ?? null);
    }

    return true;
  }

  /**
   * Wait for messages and get as a single batch string
   * Respects mode boundaries - returns when mode changes
   */
  async waitForMessagesAndGetAsString(signal?: AbortSignal): Promise<WaitResult<T>> {
    // Check if already aborted
    if (signal?.aborted || this.aborted) {
      return null;
    }

    // If queue has items, return the first one
    if (this.queue.length > 0) {
      return this.queue.shift() ?? null;
    }

    // Wait for new items
    return new Promise((resolve) => {
      // Handle abort
      const onAbort = () => {
        const index = this.resolvers.indexOf(resolve);
        if (index !== -1) {
          this.resolvers.splice(index, 1);
        }
        resolve(null);
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      this.resolvers.push((result) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      });
    });
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Clear all messages from queue
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Reset queue and abort state
   */
  reset(): void {
    this.queue = [];
    this.aborted = false;
    // Reject all pending waiters
    for (const resolver of this.resolvers) {
      resolver(null);
    }
    this.resolvers = [];
  }

  /**
   * Abort all pending operations
   */
  abort(): void {
    this.aborted = true;
    for (const resolver of this.resolvers) {
      resolver(null);
    }
    this.resolvers = [];
  }

  /**
   * Check if queue is aborted
   */
  isAborted(): boolean {
    return this.aborted;
  }

  /**
   * Peek at the next message without removing it
   */
  peek(): QueuedMessage<T> | undefined {
    return this.queue[0];
  }

  /**
   * Get all messages (for debugging)
   */
  getAll(): QueuedMessage<T>[] {
    return [...this.queue];
  }

  /**
   * Get current mode hash (from first message)
   */
  getCurrentModeHash(): string | null {
    return this.queue[0]?.hash ?? null;
  }

  /**
   * Check if adding a message with given mode would cause isolation
   */
  wouldIsolate(mode: T): boolean {
    if (this.queue.length === 0) {
      return false;
    }
    const newHash = this.hashFunction(mode);
    return this.queue[0].hash !== newHash;
  }
}

/**
 * Simple message queue without mode isolation
 */
export class SimpleMessageQueue {
  private queue: string[] = [];
  private resolvers: Array<(value: string | null) => void> = [];
  private aborted = false;

  /**
   * Push a message
   */
  push(message: string): void {
    if (this.aborted) return;

    this.queue.push(message);

    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver(this.queue.shift() ?? null);
    }
  }

  /**
   * Wait for next message
   */
  async wait(signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted || this.aborted) {
      return null;
    }

    if (this.queue.length > 0) {
      return this.queue.shift() ?? null;
    }

    return new Promise((resolve) => {
      const onAbort = () => {
        const index = this.resolvers.indexOf(resolve);
        if (index !== -1) {
          this.resolvers.splice(index, 1);
        }
        resolve(null);
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      this.resolvers.push((result) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      });
    });
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear queue
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Reset and abort
   */
  abort(): void {
    this.aborted = true;
    for (const resolver of this.resolvers) {
      resolver(null);
    }
    this.resolvers = [];
  }
}
