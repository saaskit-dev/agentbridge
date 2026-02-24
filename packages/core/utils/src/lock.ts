/**
 * @agentbridge/utils - AsyncLock
 * Mutual exclusion lock for async operations
 */

/**
 * AsyncLock - Ensures mutual exclusion for async operations
 *
 * Used to prevent concurrent modifications to the same resource
 * (e.g., metadata updates, agent state updates)
 */
export class AsyncLock {
  private _locked = false;
  private _queue: Array<() => void> = [];

  /**
   * Execute a function while holding the lock
   * If the lock is already held, wait until it's released
   */
  async inLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Acquire the lock
   * Returns immediately if lock is available, otherwise waits
   */
  private async acquire(): Promise<void> {
    if (!this._locked) {
      this._locked = true;
      return;
    }

    return new Promise<void>(resolve => {
      this._queue.push(resolve);
    });
  }

  /**
   * Release the lock
   * If there are waiting tasks, wake up the next one
   */
  private release(): void {
    const next = this._queue.shift();
    if (next) {
      // Give the next task the lock
      next();
    } else {
      this._locked = false;
    }
  }

  /**
   * Check if the lock is currently held
   */
  isLocked(): boolean {
    return this._locked;
  }
}

/**
 * Create a new AsyncLock
 */
export function createLock(): AsyncLock {
  return new AsyncLock();
}
