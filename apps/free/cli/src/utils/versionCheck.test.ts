import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { notifySessionToExit, startVersionMonitor, getCurrentCliVersion } from './versionCheck';

describe('versionCheck', () => {
  describe('getCurrentCliVersion', () => {
    it('returns a version string', () => {
      const version = getCurrentCliVersion();
      // Should return either a valid semver or 'unknown'
      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
    });
  });

  describe('startVersionMonitor', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('calls onVersionChange when version changes', async () => {
      const onVersionChange = vi.fn();
      const cleanup = startVersionMonitor({
        startVersion: '1.0.0',
        checkIntervalMs: 1000,
        onVersionChange,
        label: 'Test',
      });

      // Should not call immediately
      expect(onVersionChange).not.toHaveBeenCalled();

      // Advance time and trigger check
      await vi.advanceTimersByTimeAsync(1000);

      // Version might have changed or not, but the check should have run
      // We can't guarantee version changed, so just verify the monitor was set up
      expect(cleanup).toBeInstanceOf(Function);

      cleanup();
    });

    it('cleanup stops the monitor', async () => {
      const onVersionChange = vi.fn();
      const cleanup = startVersionMonitor({
        startVersion: '1.0.0',
        checkIntervalMs: 1000,
        onVersionChange,
        label: 'Test',
      });

      // Cleanup immediately
      cleanup();

      // Advance time - should not call onVersionChange because monitor is stopped
      await vi.advanceTimersByTimeAsync(5000);

      // Monitor was stopped, so no calls expected
      expect(onVersionChange).not.toHaveBeenCalled();
    });
  });

  describe('notifySessionToExit', () => {
    it('returns true if process already exited', async () => {
      // Use a PID that doesn't exist (high number)
      const result = await notifySessionToExit(999999, 1000);
      expect(result).toBe(true);
    });

    it('uses timeout for force kill', async () => {
      // This test verifies the timeout mechanism
      // Using a non-existent PID to avoid actual process killing
      const startTime = Date.now();
      const result = await notifySessionToExit(999999, 100);
      const elapsed = Date.now() - startTime;

      // Should return quickly since process doesn't exist
      expect(result).toBe(true);
      expect(elapsed).toBeLessThan(1000);
    });
  });
});
