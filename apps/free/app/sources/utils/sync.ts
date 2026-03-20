import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { backoff, delay } from '@/utils/time';

const logger = new Logger('app/utils/sync');

/** After backoff exhaustion, wait this long before auto-retrying. */
const RETRY_AFTER_EXHAUSTION_MS = 10_000;

export class InvalidateSync {
  private _invalidated = false;
  private _invalidatedDouble = false;
  private _stopped = false;
  private _command: () => Promise<void>;
  private _pendings: (() => void)[] = [];
  /** AbortController for the post-exhaustion retry delay — cancelled by invalidate() to cut wait short. */
  private _retryDelayAbort: AbortController | null = null;

  constructor(command: () => Promise<void>) {
    this._command = command;
  }

  invalidate() {
    if (this._stopped) {
      return;
    }
    // If we're waiting in the post-exhaustion retry delay, cancel it immediately
    this._retryDelayAbort?.abort();
    if (!this._invalidated) {
      this._invalidated = true;
      this._invalidatedDouble = false;
      this._doSync();
    } else {
      if (!this._invalidatedDouble) {
        this._invalidatedDouble = true;
      }
    }
  }

  async invalidateAndAwait() {
    if (this._stopped) {
      return;
    }
    await new Promise<void>(resolve => {
      this._pendings.push(resolve);
      this.invalidate();
    });
  }

  async awaitQueue() {
    if (this._stopped || (!this._invalidated && this._pendings.length === 0)) {
      return;
    }
    await new Promise<void>(resolve => {
      this._pendings.push(resolve);
    });
  }

  stop() {
    if (this._stopped) {
      return;
    }
    this._notifyPendings();
    this._stopped = true;
  }

  private _notifyPendings = () => {
    for (const pending of this._pendings) {
      pending();
    }
    this._pendings = [];
  };

  private _doSync = async () => {
    try {
      await backoff(async () => {
        if (this._stopped) {
          return;
        }
        await this._command();
      });
    } catch (e) {
      logger.warn('[InvalidateSync] backoff exhausted, scheduling retry', {
        error: String(e),
        retryInMs: RETRY_AFTER_EXHAUSTION_MS,
      });
      if (!this._stopped) {
        this._retryDelayAbort = new AbortController();
        await delay(RETRY_AFTER_EXHAUSTION_MS, this._retryDelayAbort.signal).catch(() => {});
        this._retryDelayAbort = null;
        if (!this._stopped) {
          this._invalidatedDouble = true;
        }
      }
    }
    if (this._stopped) {
      this._notifyPendings();
      return;
    }
    if (this._invalidatedDouble) {
      this._invalidatedDouble = false;
      this._doSync();
    } else {
      this._invalidated = false;
      this._notifyPendings();
    }
  };
}

export class ValueSync<T> {
  private _latestValue: T | undefined;
  private _hasValue = false;
  private _processing = false;
  private _stopped = false;
  private _command: (value: T) => Promise<void>;
  private _pendings: (() => void)[] = [];

  constructor(command: (value: T) => Promise<void>) {
    this._command = command;
  }

  setValue(value: T) {
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

  async setValueAndAwait(value: T) {
    if (this._stopped) {
      return;
    }
    await new Promise<void>(resolve => {
      this._pendings.push(resolve);
      this.setValue(value);
    });
  }

  async awaitQueue() {
    if (this._stopped || (!this._processing && this._pendings.length === 0)) {
      return;
    }
    await new Promise<void>(resolve => {
      this._pendings.push(resolve);
    });
  }

  stop() {
    if (this._stopped) {
      return;
    }
    this._notifyPendings();
    this._stopped = true;
  }

  private _notifyPendings = () => {
    for (const pending of this._pendings) {
      pending();
    }
    this._pendings = [];
  };

  private _doSync = async () => {
    while (this._hasValue && !this._stopped) {
      const value = this._latestValue!;
      this._hasValue = false;

      try {
        await backoff(async () => {
          if (this._stopped) {
            return;
          }
          await this._command(value);
        });
      } catch (e) {
        logger.error('[ValueSync] backoff exhausted, will retry on next setValue', {
          error: String(e),
        });
      }

      if (this._stopped) {
        this._notifyPendings();
        return;
      }
    }

    this._processing = false;
    this._notifyPendings();
  };
}
