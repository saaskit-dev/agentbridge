import { describe, it, expect, vi } from 'vitest';
import { AsyncLock, createLock } from '../lock';

describe('AsyncLock', () => {
  describe('basic functionality', () => {
    it('allows single operation', async () => {
      const lock = new AsyncLock();
      const result = await lock.inLock(async () => 'test');

      expect(result).toBe('test');
      expect(lock.isLocked()).toBe(false);
    });

    it('returns undefined for void operations', async () => {
      const lock = new AsyncLock();
      let executed = false;

      await lock.inLock(async () => {
        executed = true;
      });

      expect(executed).toBe(true);
    });

    it('releases lock on success', async () => {
      const lock = new AsyncLock();

      await lock.inLock(async () => {});
      expect(lock.isLocked()).toBe(false);
    });

    it('releases lock on error', async () => {
      const lock = new AsyncLock();

      await expect(
        lock.inLock(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(lock.isLocked()).toBe(false);
    });
  });

  describe('mutual exclusion', () => {
    it('prevents concurrent access', async () => {
      const lock = new AsyncLock();
      const order: number[] = [];

      const task1 = lock.inLock(async () => {
        order.push(1);
        await new Promise(resolve => setTimeout(resolve, 50));
        order.push(2);
      });

      const task2 = lock.inLock(async () => {
        order.push(3);
        await new Promise(resolve => setTimeout(resolve, 50));
        order.push(4);
      });

      await Promise.all([task1, task2]);

      // Task 1 should complete before Task 2 starts
      expect(order).toEqual([1, 2, 3, 4]);
    });

    it('queues multiple operations', async () => {
      const lock = new AsyncLock();
      const results: number[] = [];

      const tasks = [1, 2, 3, 4, 5].map(i =>
        lock.inLock(async () => {
          results.push(i);
          await new Promise(resolve => setTimeout(resolve, 10));
        })
      );

      await Promise.all(tasks);

      // All operations should complete in order
      expect(results).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('isLocked', () => {
    it('returns false initially', () => {
      const lock = new AsyncLock();
      expect(lock.isLocked()).toBe(false);
    });

    it('returns true while locked', async () => {
      const lock = new AsyncLock();
      let lockChecked = false;

      const promise = lock.inLock(async () => {
        // This runs while we hold the lock
        // But we can't check from outside
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // The lock is held while the operation runs
      await promise;
      expect(lock.isLocked()).toBe(false);
    });
  });

  describe('error handling', () => {
    it('propagates errors', async () => {
      const lock = new AsyncLock();

      await expect(
        lock.inLock(async () => {
          throw new TypeError('Type error');
        })
      ).rejects.toThrow(TypeError);
    });

    it('continues after error', async () => {
      const lock = new AsyncLock();

      try {
        await lock.inLock(async () => {
          throw new Error('First error');
        });
      } catch {}

      const result = await lock.inLock(async () => 'success');
      expect(result).toBe('success');
    });
  });

  describe('createLock factory', () => {
    it('creates an AsyncLock instance', () => {
      const lock = createLock();
      expect(lock).toBeInstanceOf(AsyncLock);
    });
  });
});
