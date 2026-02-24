/**
 * @agentbridge/sync - Sync Utilities
 *
 * InvalidateSync - Coalesces invalidation signals with automatic backoff
 * ValueSync - Syncs the latest value with automatic backoff
 */

import { backoff, createBackoff, type BackoffOptions } from '@agentbridge/utils';

/**
 * InvalidateSync - Coalesces multiple invalidation signals
 *
 * When invalidate() is called multiple times rapidly, only one sync
 * operation is performed. If invalidate() is called during a sync,
 * another sync will be triggered after the current one completes.
 *
 * Based on happy's InvalidateSync pattern.
 */
export class InvalidateSync {
  private _invalidated = false;
  private _invalidatedDouble = false;
  private _stopped = false;
  private readonly _command: () => Promise<void>;
  private readonly _backoff: (fn: () => Promise<void>) => Promise<void>;
  private _pendings: (() => void)[] = [];

  constructor(command: () => Promise<void>, backoffOptions?: BackoffOptions) {
    this._command = command;
    this._backoff = backoffOptions ? createBackoff(backoffOptions) as (fn: () => Promise<void>) => Promise<void> : backoff as (fn: () => Promise<void>) => Promise<void>;
  }

  /**
   * Trigger an invalidation - will start sync if not already running
   * If called while sync is running, will trigger another sync after
   */
  invalidate(): void {
    if (this._stopped) {
      return;
    }
    if (!this._invalidated) {
      this._invalidated = true;
      this._invalidatedDouble = false;
      this._doSync();
    } else {
      // Already running - mark for double sync
      if (!this._invalidatedDouble) {
        this._invalidatedDouble = true;
      }
    }
  }

  /**
   * Trigger invalidation and wait for all pending syncs to complete
   */
  async invalidateAndAwait(): Promise<void> {
    if (this._stopped) {
      return;
    }
    await new Promise<void>(resolve => {
      this._pendings.push(resolve);
      this.invalidate();
    });
  }

  /**
   * Wait for any pending sync operations to complete
   */
  async awaitQueue(): Promise<void> {
    if (this._stopped || (!this._invalidated && this._pendings.length === 0)) {
      return;
    }
    await new Promise<void>(resolve => {
      this._pendings.push(resolve);
    });
  }

  /**
   * Stop the sync and resolve all pending promises
   */
  stop(): void {
    if (this._stopped) {
      return;
    }
    this._notifyPendings();
    this._stopped = true;
  }

  /**
   * Check if the sync is stopped
   */
  get isStopped(): boolean {
    return this._stopped;
  }

  /**
   * Check if a sync is currently in progress
   */
  get isInProgress(): boolean {
    return this._invalidated;
  }

  private _notifyPendings = (): void => {
    for (const pending of this._pendings) {
      pending();
    }
    this._pendings = [];
  };

  private _doSync = async (): Promise<void> => {
    await this._backoff(async () => {
      if (this._stopped) {
        return;
      }
      await this._command();
    });

    if (this._stopped) {
      this._notifyPendings();
      return;
    }

    if (this._invalidatedDouble) {
      // Another invalidate was called during sync - run again
      this._invalidatedDouble = false;
      this._doSync();
    } else {
      // All done
      this._invalidated = false;
      this._notifyPendings();
    }
  };
}

/**
 * ValueSync - Syncs the latest value with automatic backoff
 *
 * Similar to InvalidateSync but for values. Multiple rapid setValue()
 * calls will be coalesced - only the latest value will be synced.
 */
export class ValueSync<T> {
  private _latestValue: T | undefined;
  private _hasValue = false;
  private _processing = false;
  private _stopped = false;
  private readonly _command: (value: T) => Promise<void>;
  private readonly _backoff: (fn: () => Promise<void>) => Promise<void>;
  private _pendings: (() => void)[] = [];

  constructor(command: (value: T) => Promise<void>, backoffOptions?: BackoffOptions) {
    this._command = command;
    this._backoff = backoffOptions ? createBackoff(backoffOptions) as (fn: () => Promise<void>) => Promise<void> : backoff as (fn: () => Promise<void>) => Promise<void>;
  }

  /**
   * Set a new value to sync - will start sync if not already running
   * If called while sync is running, the latest value will be synced next
   */
  setValue(value: T): void {
    if (this._stopped) {
      return;
    }
    this._latestValue = value;
    this._hasValue = true;
    if (!this._processing) {
      this._processing = true;
      this._doSync();
    }
  }

  /**
   * Set value and wait for sync to complete
   */
  async setValueAndAwait(value: T): Promise<void> {
    if (this._stopped) {
      return;
    }
    await new Promise<void>(resolve => {
      this._pendings.push(resolve);
      this.setValue(value);
    });
  }

  /**
   * Wait for any pending sync operations to complete
   */
  async awaitQueue(): Promise<void> {
    if (this._stopped || (!this._processing && this._pendings.length === 0)) {
      return;
    }
    await new Promise<void>(resolve => {
      this._pendings.push(resolve);
    });
  }

  /**
   * Stop the sync and resolve all pending promises
   */
  stop(): void {
    if (this._stopped) {
      return;
    }
    this._notifyPendings();
    this._stopped = true;
  }

  /**
   * Check if the sync is stopped
   */
  get isStopped(): boolean {
    return this._stopped;
  }

  /**
   * Check if a sync is currently in progress
   */
  get isInProgress(): boolean {
    return this._processing;
  }

  /**
   * Get the latest value (if any)
   */
  get latestValue(): T | undefined {
    return this._latestValue;
  }

  private _notifyPendings = (): void => {
    for (const pending of this._pendings) {
      pending();
    }
    this._pendings = [];
  };

  private _doSync = async (): Promise<void> => {
    while (this._hasValue && !this._stopped) {
      const value = this._latestValue!;
      this._hasValue = false;

      await this._backoff(async () => {
        if (this._stopped) {
          return;
        }
        await this._command(value);
      });

      if (this._stopped) {
        this._notifyPendings();
        return;
      }
    }

    this._processing = false;
    this._notifyPendings();
  };
}

/**
 * Create an InvalidateSync instance
 */
export function createInvalidateSync(
  command: () => Promise<void>,
  backoffOptions?: BackoffOptions
): InvalidateSync {
  return new InvalidateSync(command, backoffOptions);
}

/**
 * Create a ValueSync instance
 */
export function createValueSync<T>(
  command: (value: T) => Promise<void>,
  backoffOptions?: BackoffOptions
): ValueSync<T> {
  return new ValueSync(command, backoffOptions);
}
