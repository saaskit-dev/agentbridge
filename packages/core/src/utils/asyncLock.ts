/**
 * AsyncLock - Asynchronous lock for concurrency control
 *
 * Provides mutual exclusion for async operations.
 */

export class AsyncLock {
  private permits: number = 1;
  private promiseResolverQueue: Array<(v: boolean) => void> = [];

  /**
   * Execute a function within the lock
   * @param func - Function to execute
   * @returns Result of the function
   */
  async inLock<T>(func: () => Promise<T> | T): Promise<T> {
    try {
      await this.lock();
      return await func();
    } finally {
      this.unlock();
    }
  }

  private async lock(): Promise<void> {
    if (this.permits > 0) {
      this.permits = this.permits - 1;
      return;
    }
    await new Promise<boolean>(resolve => this.promiseResolverQueue.push(resolve));
  }

  private unlock(): void {
    this.permits += 1;
    if (this.permits > 1 && this.promiseResolverQueue.length > 0) {
      throw new Error('this.permits should never be > 0 when there is someone waiting.');
    } else if (this.permits === 1 && this.promiseResolverQueue.length > 0) {
      // If there is someone else waiting, immediately consume the permit that was released
      // at the beginning of this function and let the waiting function resume.
      this.permits -= 1;

      const nextResolver = this.promiseResolverQueue.shift();
      // Resolve on the next tick
      if (nextResolver) {
        setTimeout(() => {
          nextResolver(true);
        }, 0);
      }
    }
  }
}
