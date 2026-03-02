/**
 * Caffeinate utility for preventing macOS from sleeping
 *
 * Uses the built-in macOS caffeinate command to keep the system awake.
 * Only works on macOS, silently does nothing on other platforms.
 *
 */

import { spawn, ChildProcess } from 'node:child_process';

let caffeinateProcess: ChildProcess | null = null;
let isStopping = false;
let cleanupHandlersSet = false;

/**
 * Options for caffeinate
 */
export interface CaffeinateOptions {
  /** Prevent system from idle sleeping (default: true) */
  preventIdleSleep?: boolean;
  /** Prevent disk from sleeping (default: true) */
  preventDiskSleep?: boolean;
  /** Prevent display from sleeping (default: false) */
  preventDisplaySleep?: boolean;
}

/**
 * Start caffeinate to prevent system sleep
 *
 * Only works on macOS, silently does nothing on other platforms.
 *
 * @param options - Caffeinate options
 * @returns true if caffeinate was started, false otherwise
 */
export function startCaffeinate(options: CaffeinateOptions = {}): boolean {
  const {
    preventIdleSleep = true,
    preventDiskSleep = true,
    preventDisplaySleep = false
  } = options;

  // Only run on macOS
  if (process.platform !== 'darwin') {
    return false;
  }

  // Don't start if already running
  if (caffeinateProcess && !caffeinateProcess.killed) {
    return true;
  }

  try {
    // Build flags
    const flags: string[] = [];
    if (preventIdleSleep) flags.push('-i');
    if (preventDiskSleep) flags.push('-m');
    if (preventDisplaySleep) flags.push('-d');

    if (flags.length === 0) {
      return false;
    }

    // Spawn caffeinate
    caffeinateProcess = spawn('caffeinate', flags, {
      stdio: 'ignore',
      detached: false
    });

    caffeinateProcess.on('error', () => {
      caffeinateProcess = null;
    });

    caffeinateProcess.on('exit', () => {
      caffeinateProcess = null;
    });

    // Set up cleanup handlers
    setupCleanupHandlers();

    return true;
  } catch {
    return false;
  }
}

/**
 * Stop the caffeinate process
 */
export async function stopCaffeinate(): Promise<void> {
  // Prevent re-entrant calls during cleanup
  if (isStopping) {
    return;
  }

  if (caffeinateProcess && !caffeinateProcess.killed) {
    isStopping = true;

    try {
      caffeinateProcess.kill('SIGTERM');

      // Give it a moment to terminate gracefully
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (caffeinateProcess && !caffeinateProcess.killed) {
        caffeinateProcess.kill('SIGKILL');
      }
      caffeinateProcess = null;
      isStopping = false;
    } catch {
      caffeinateProcess = null;
      isStopping = false;
    }
  }
}

/**
 * Check if caffeinate is currently running
 */
export function isCaffeinateRunning(): boolean {
  return caffeinateProcess !== null && !caffeinateProcess.killed;
}

/**
 * Set up cleanup handlers to ensure caffeinate is stopped on exit
 */
function setupCleanupHandlers(): void {
  if (cleanupHandlersSet) {
    return;
  }

  cleanupHandlersSet = true;

  // Clean up on various exit conditions
  const cleanup = () => {
    stopCaffeinate();
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGUSR1', cleanup);
  process.on('SIGUSR2', cleanup);
}
