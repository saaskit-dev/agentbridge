/**
 * Sync Compatibility Tests
 *
 * Tests to verify SDK sync implementation is compatible with free's sync.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InvalidateSync, ValueSync } from '../index';

describe('InvalidateSync - free compatibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Basic behavior (matching free)', () => {
    it('should call command on invalidate', async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const sync = new InvalidateSync(command);

      sync.invalidate();
      await vi.runAllTimersAsync();

      expect(command).toHaveBeenCalledTimes(1);
    });

    it('should coalesce invalidate calls within same sync cycle', async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const sync = new InvalidateSync(command);

      // First invalidate starts the sync
      sync.invalidate();
      await vi.runAllTimersAsync();

      // After sync completes, _invalidated is false
      // Now call invalidate again - should start new sync
      sync.invalidate();
      await vi.runAllTimersAsync();

      expect(command).toHaveBeenCalledTimes(2);
    });

    it('should re-run if invalidate called during execution (double invalidate)', async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const sync = new InvalidateSync(command);

      // Multiple rapid invalidates before sync starts
      sync.invalidate(); // Starts _doSync()
      sync.invalidate(); // Sets _invalidatedDouble = true
      sync.invalidate(); // _invalidatedDouble already true

      await vi.runAllTimersAsync();

      // Should call twice: once for initial, once for double
      expect(command).toHaveBeenCalledTimes(2);
    });

    it('should NOT re-run if only one invalidate', async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const sync = new InvalidateSync(command);

      sync.invalidate();
      await vi.runAllTimersAsync();

      expect(command).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop() behavior', () => {
    it('should stop and not call command after stop', async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const sync = new InvalidateSync(command);

      sync.stop();
      sync.invalidate();

      await vi.runAllTimersAsync();

      expect(command).not.toHaveBeenCalled();
    });

    it('should resolve pending promises on stop', async () => {
      let resolveCommand: () => void;
      const command = vi.fn().mockImplementation(() => {
        return new Promise<void>(resolve => {
          resolveCommand = resolve;
        });
      });
      const sync = new InvalidateSync(command);

      let awaitResolved = false;
      sync.invalidateAndAwait().then(() => {
        awaitResolved = true;
      });

      await vi.advanceTimersByTimeAsync(0);

      // Stop while command is pending
      sync.stop();

      // Pending promise should be resolved
      await vi.runAllTimersAsync();

      expect(awaitResolved).toBe(true);
    });
  });

  describe('invalidateAndAwait()', () => {
    it('should resolve after sync completes', async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const sync = new InvalidateSync(command);

      await sync.invalidateAndAwait();
      await vi.runAllTimersAsync();

      expect(command).toHaveBeenCalledTimes(1);
    });
  });

  describe('awaitQueue()', () => {
    it('should resolve immediately when no pending operations', async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const sync = new InvalidateSync(command);

      await sync.awaitQueue();

      expect(command).not.toHaveBeenCalled();
    });

    it('should wait for current sync to complete', async () => {
      let resolveCommand: () => void;
      const command = vi.fn().mockImplementation(() => {
        return new Promise<void>(resolve => {
          resolveCommand = resolve;
        });
      });
      const sync = new InvalidateSync(command);

      sync.invalidate();
      await vi.advanceTimersByTimeAsync(0);

      let awaitResolved = false;
      sync.awaitQueue().then(() => {
        awaitResolved = true;
      });

      // Not resolved yet
      expect(awaitResolved).toBe(false);

      // Complete the command
      resolveCommand!();
      await vi.runAllTimersAsync();

      expect(awaitResolved).toBe(true);
    });
  });
});

describe('ValueSync - free compatibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Basic behavior (matching free)', () => {
    it('should call command with value', async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const sync = new ValueSync<string>(command);

      sync.setValue('test value');
      await vi.runAllTimersAsync();

      expect(command).toHaveBeenCalledWith('test value');
      expect(command).toHaveBeenCalledTimes(1);
    });

    it('should coalesce multiple rapid setValue calls to latest value', async () => {
      let resolveCommand: () => void;
      const command = vi.fn().mockImplementation(() => {
        return new Promise<void>(resolve => {
          resolveCommand = resolve;
        });
      });
      const sync = new ValueSync<string>(command);

      // First value starts processing
      sync.setValue('value1');
      await vi.advanceTimersByTimeAsync(0);

      // While processing, set new values - only latest should be used
      sync.setValue('value2');
      sync.setValue('value3');

      // Complete first command
      resolveCommand!();
      await vi.runAllTimersAsync();

      // Should have called twice: value1, then value3 (latest)
      expect(command).toHaveBeenCalledTimes(2);
      expect(command).toHaveBeenNthCalledWith(1, 'value1');
      expect(command).toHaveBeenNthCalledWith(2, 'value3');
    });

    it('should only call once if single value', async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const sync = new ValueSync<string>(command);

      sync.setValue('only value');
      await vi.runAllTimersAsync();

      expect(command).toHaveBeenCalledTimes(1);
      expect(command).toHaveBeenCalledWith('only value');
    });
  });

  describe('stop() behavior', () => {
    it('should stop and not call command after stop', async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const sync = new ValueSync<string>(command);

      sync.stop();
      sync.setValue('test');

      await vi.runAllTimersAsync();

      expect(command).not.toHaveBeenCalled();
    });
  });

  describe('setValueAndAwait()', () => {
    it('should resolve after sync completes', async () => {
      const command = vi.fn().mockResolvedValue(undefined);
      const sync = new ValueSync<string>(command);

      await sync.setValueAndAwait('test value');
      await vi.runAllTimersAsync();

      expect(command).toHaveBeenCalledWith('test value');
    });
  });
});
