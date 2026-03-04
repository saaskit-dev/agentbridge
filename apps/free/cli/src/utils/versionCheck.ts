/**
 * CLI Version Check Utility
 *
 * Provides functionality for sessions to detect CLI version changes
 * and gracefully exit when the CLI has been updated.
 *
 * This ensures that old sessions don't continue running with outdated code
 * after the user updates the CLI via npm.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectPath } from '@/projectPath';
import { logger } from '@/ui/logger';

/**
 * Get the currently installed CLI version from package.json
 */
export function getCurrentCliVersion(): string {
  try {
    const packageJsonPath = join(projectPath(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  } catch (error) {
    logger.debug('[VERSION CHECK] Failed to read current CLI version:', error);
    return 'unknown';
  }
}

/**
 * Options for starting version monitoring
 */
export interface VersionMonitorOptions {
  /** The version that was current when the session started */
  startVersion: string;

  /** Interval in milliseconds between checks (default: 60000 = 1 minute) */
  checkIntervalMs?: number;

  /** Callback when version change is detected */
  onVersionChange: (oldVersion: string, newVersion: string) => void | Promise<void>;

  /** Label for logging purposes */
  label?: string;
}

/**
 * Start monitoring for CLI version changes.
 * Returns a cleanup function to stop monitoring.
 *
 * @example
 * ```typescript
 * const cleanup = startVersionMonitor({
 *   startVersion: packageJson.version,
 *   onVersionChange: (oldV, newV) => {
 *     logger.debug(`CLI updated from ${oldV} to ${newV}, exiting...`);
 *     process.exit(0);
 *   },
 *   label: 'Gemini'
 * });
 *
 * // Later, when session ends:
 * cleanup();
 * ```
 */
export function startVersionMonitor(options: VersionMonitorOptions): () => void {
  const { startVersion, checkIntervalMs = 60000, onVersionChange, label = 'Session' } = options;

  let isMonitoring = true;

  const checkVersion = async () => {
    if (!isMonitoring) return;

    try {
      const currentVersion = getCurrentCliVersion();

      if (currentVersion !== startVersion && currentVersion !== 'unknown') {
        logger.debug(`[${label}] CLI version changed from ${startVersion} to ${currentVersion}`);

        isMonitoring = false;
        clearInterval(intervalId);

        await onVersionChange(startVersion, currentVersion);
      }
    } catch (error) {
      logger.debug(`[${label}] Error checking version:`, error);
    }
  };

  const intervalId = setInterval(checkVersion, checkIntervalMs);

  logger.debug(
    `[${label}] Started version monitor (startVersion: ${startVersion}, interval: ${checkIntervalMs}ms)`
  );

  return () => {
    if (isMonitoring) {
      isMonitoring = false;
      clearInterval(intervalId);
      logger.debug(`[${label}] Stopped version monitor`);
    }
  };
}

/**
 * Notify a session process to gracefully exit.
 * Sends SIGTERM first, then SIGKILL after timeout.
 */
export async function notifySessionToExit(pid: number, timeoutMs: number = 5000): Promise<boolean> {
  return new Promise(resolve => {
    let resolved = false;

    const cleanup = (success: boolean) => {
      if (!resolved) {
        resolved = true;
        resolve(success);
      }
    };

    // Check if process exists first
    try {
      process.kill(pid, 0);
    } catch {
      logger.debug(`[VERSION CHECK] Process ${pid} already exited`);
      cleanup(true);
      return;
    }

    // Set up timeout for force kill
    const timeout = setTimeout(() => {
      try {
        process.kill(pid, 'SIGKILL');
        logger.debug(`[VERSION CHECK] Force killed process ${pid} after timeout`);
      } catch {
        // Process already dead
      }
      cleanup(false);
    }, timeoutMs);

    // Set up listener for process exit
    const exitListener = () => {
      clearTimeout(timeout);
      cleanup(true);
    };

    // Try graceful shutdown first
    try {
      process.kill(pid, 'SIGTERM');
      logger.debug(`[VERSION CHECK] Sent SIGTERM to process ${pid}`);

      // Wait a bit and check if process still exists
      setTimeout(() => {
        try {
          process.kill(pid, 0);
          // Process still running, will be force killed by timeout
        } catch {
          // Process exited gracefully
          clearTimeout(timeout);
          cleanup(true);
        }
      }, 1000);
    } catch (error) {
      clearTimeout(timeout);
      cleanup(true); // Process already dead
    }
  });
}
