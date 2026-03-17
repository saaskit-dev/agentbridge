import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { backoff, delay } from '@/utils/time';

const logger = new Logger('cli/utils/sync');

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
      logger.error('[InvalidateSync] backoff exhausted, scheduling retry', undefined, {
        error: String(e),
        retryInMs: RETRY_AFTER_EXHAUSTION_MS,
      });
      // Auto-retry after a cooldown so messages don't stay stuck.
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
