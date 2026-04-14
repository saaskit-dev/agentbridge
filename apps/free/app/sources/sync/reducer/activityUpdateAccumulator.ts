import type { ApiEphemeralActivityUpdate } from '../apiTypes';

export class ActivityUpdateAccumulator {
  private pendingUpdates = new Map<string, ApiEphemeralActivityUpdate>();
  private lastEmittedStates = new Map<
    string,
    { active: boolean; thinking: boolean; activeAt: number }
  >();
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private flushHandler: (updates: Map<string, ApiEphemeralActivityUpdate>) => void,
    private debounceDelay: number = 500
  ) {}

  addUpdate(update: ApiEphemeralActivityUpdate): void {
    this.addUpdates([update]);
  }

  addUpdates(updates: ApiEphemeralActivityUpdate[]): void {
    if (updates.length === 0) {
      return;
    }

    let hasSignificantChange = false;

    for (const update of updates) {
      const sessionId = update.id;
      const lastState = this.lastEmittedStates.get(sessionId);

      // Check if this is a critical timestamp update (more than half of disconnect timeout old)
      const timeSinceLastUpdate = lastState ? update.activeAt - lastState.activeAt : 0;
      const isCriticalTimestamp = timeSinceLastUpdate > 60000; // Half of 120 second timeout

      // Check if this is a significant state change that needs immediate emission
      const isSignificantChange =
        !lastState ||
        lastState.active !== update.active ||
        lastState.thinking !== update.thinking ||
        isCriticalTimestamp;

      this.pendingUpdates.set(sessionId, update);
      if (isSignificantChange) {
        hasSignificantChange = true;
      }
    }

    if (hasSignificantChange) {
      // Cancel any pending timeout
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }

      // Flush all pending updates together (batched)
      this.flushPendingUpdates();
      return;
    }

    // Only start a new timer if one isn't already running
    if (!this.timeoutId) {
      this.timeoutId = setTimeout(() => {
        this.flushPendingUpdates();
        this.timeoutId = null;
      }, this.debounceDelay);
    }
    // Don't reset the timer for subsequent updates - let it fire!
  }

  private flushPendingUpdates(): void {
    if (this.pendingUpdates.size > 0) {
      // Create a copy of the pending updates
      const updatesToFlush = new Map(this.pendingUpdates);

      // Emit all updates in a single batch
      this.flushHandler(updatesToFlush);

      // Update last emitted states for all flushed updates
      for (const [sessionId, update] of updatesToFlush) {
        this.lastEmittedStates.set(sessionId, {
          active: update.active,
          thinking: update.thinking,
          activeAt: update.activeAt,
        });
      }

      // Clear pending updates
      this.pendingUpdates.clear();
    }
  }

  cancel(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.pendingUpdates.clear();
  }

  reset(): void {
    this.cancel();
    this.lastEmittedStates.clear();
  }

  flush(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.flushPendingUpdates();
  }
}
