import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSingleton,
  getSingletonSync,
  hasSingleton,
  clearSingleton,
  clearAllSingletons,
  getSingletonKeys,
} from '../singleton';

describe('singleton utilities', () => {
  beforeEach(() => {
    clearAllSingletons();
  });

  describe('getSingleton', () => {
    it('creates and returns singleton', async () => {
      let callCount = 0;

      const factory = () => {
        callCount++;
        return { value: 'test' };
      };

      const result1 = await getSingleton('key1', factory);
      const result2 = await getSingleton('key1', factory);

      expect(result1).toBe(result2);
      expect(callCount).toBe(1);
    });

    it('handles async factory', async () => {
      const factory = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return { async: true };
      };

      const result = await getSingleton('async-key', factory);
      expect(result).toEqual({ async: true });
    });

    it('handles concurrent access', async () => {
      let callCount = 0;
      let factoryPromise: Promise<{ count: number }> | null = null;

      const factory = async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return { count: callCount };
      };

      // Start two concurrent requests
      const [result1, result2] = await Promise.all([
        getSingleton('concurrent-key', factory),
        getSingleton('concurrent-key', factory),
      ]);

      expect(result1).toBe(result2);
      expect(callCount).toBe(1);
    });
  });

  describe('getSingletonSync', () => {
    it('creates and returns singleton synchronously', () => {
      const factory = () => ({ sync: true });

      const result1 = getSingletonSync('sync-key', factory);
      const result2 = getSingletonSync('sync-key', factory);

      expect(result1).toBe(result2);
    });
  });

  describe('hasSingleton', () => {
    it('returns true for existing singleton', async () => {
      await getSingleton('exists-key', () => 'value');
      expect(hasSingleton('exists-key')).toBe(true);
    });

    it('returns false for non-existing singleton', () => {
      expect(hasSingleton('nonexistent-key')).toBe(false);
    });
  });

  describe('clearSingleton', () => {
    it('removes singleton', async () => {
      await getSingleton('clear-key', () => 'value');

      const cleared = clearSingleton('clear-key');

      expect(cleared).toBe(true);
      expect(hasSingleton('clear-key')).toBe(false);
    });

    it('returns false for non-existing key', () => {
      expect(clearSingleton('nonexistent')).toBe(false);
    });
  });

  describe('clearAllSingletons', () => {
    it('removes all singletons', async () => {
      await getSingleton('key1', () => 1);
      await getSingleton('key2', () => 2);

      clearAllSingletons();

      expect(hasSingleton('key1')).toBe(false);
      expect(hasSingleton('key2')).toBe(false);
    });
  });

  describe('getSingletonKeys', () => {
    it('returns all singleton keys', async () => {
      await getSingleton('a', () => 1);
      await getSingleton('b', () => 2);

      const keys = getSingletonKeys();

      expect(keys).toContain('a');
      expect(keys).toContain('b');
    });

    it('returns empty array when no singletons', () => {
      clearAllSingletons();
      expect(getSingletonKeys()).toEqual([]);
    });
  });

  describe('Edge cold start simulation', () => {
    it('persists values across "cold starts"', async () => {
      // Simulate Edge environment where module state persists
      const createConnection = () => ({ connected: true, id: Math.random() });

      // First request
      const conn1 = await getSingleton('db-connection', createConnection);

      // Simulate new request (module state persists)
      const conn2 = await getSingleton('db-connection', createConnection);

      // Should be the same instance
      expect(conn1).toBe(conn2);
      expect(conn1.id).toBe(conn2.id);
    });
  });
});
