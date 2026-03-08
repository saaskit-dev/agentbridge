/**
 * HTTP client helpers for daemon communication
 * Used by CLI commands to interact with running daemon
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { Metadata } from '@/api/types';
import { configuration } from '@/configuration';
import { clearDaemonState, readDaemonState } from '@/persistence';
import { projectPath } from '@/projectPath';
import { Logger } from '@agentbridge/core/telemetry';
const logger = new Logger('daemon/controlClient');

async function daemonPost(path: string, body?: any): Promise<{ error?: string } | any> {
  const state = await readDaemonState();
  if (!state?.httpPort) {
    const errorMessage = 'No daemon running, no state file found';
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return {
      error: errorMessage,
    };
  }

  try {
    process.kill(state.pid, 0);
  } catch (error) {
    const errorMessage = 'Daemon is not running, file is stale';
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return {
      error: errorMessage,
    };
  }

  try {
    const timeout = process.env.FREE_DAEMON_HTTP_TIMEOUT
      ? parseInt(process.env.FREE_DAEMON_HTTP_TIMEOUT)
      : 10_000;
    const response = await fetch(`http://127.0.0.1:${state.httpPort}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      // Mostly increased for stress test
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const errorMessage = `Request failed: ${path}, HTTP ${response.status}`;
      logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
      return {
        error: errorMessage,
      };
    }

    return await response.json();
  } catch (error) {
    const errorMessage = `Request failed: ${path}, ${error instanceof Error ? error.message : 'Unknown error'}`;
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return {
      error: errorMessage,
    };
  }
}

export async function notifyDaemonSessionStarted(
  sessionId: string,
  metadata: Metadata
): Promise<{ error?: string } | any> {
  return await daemonPost('/session-started', {
    sessionId,
    metadata,
  });
}

export async function listDaemonSessions(): Promise<any[]> {
  const result = await daemonPost('/list');
  return result.children || [];
}

export async function stopDaemonSession(sessionId: string): Promise<boolean> {
  const result = await daemonPost('/stop-session', { sessionId });
  return result.success || false;
}

export async function spawnDaemonSession(directory: string, sessionId?: string, sessionTag?: string): Promise<any> {
  const result = await daemonPost('/spawn-session', { directory, sessionId, sessionTag });
  return result;
}

export async function stopDaemonHttp(): Promise<void> {
  await daemonPost('/stop');
}

/**
 * Structured result from daemon running check.
 * - running:     process exists and daemon state file is present
 * - stale:       state file exists but the process is no longer alive (will be cleaned up)
 * - not_running: no state file found
 */
export type DaemonRunningState =
  | { status: 'running'; pid: number; startTime: string; version: string; httpPort?: number }
  | { status: 'stale'; pid: number }
  | { status: 'not_running' };

/**
 * Check whether the daemon is alive and clean up any stale state file.
 *
 * Returns a structured DaemonRunningState so callers can show rich output
 * (e.g. `free daemon status`) without a separate readDaemonState() call.
 */
export async function checkIfDaemonRunningAndCleanupStaleState(): Promise<DaemonRunningState> {
  const state = await readDaemonState();
  if (!state) {
    return { status: 'not_running' };
  }

  // Check if the daemon process is alive (signal 0 = existence check)
  try {
    process.kill(state.pid, 0);
    return {
      status: 'running',
      pid: state.pid,
      startTime: state.startTime,
      version: state.startedWithCliVersion,
      httpPort: state.httpPort,
    };
  } catch {
    logger.debug('[DAEMON RUN] Daemon PID not running, cleaning up stale state');
    await cleanupDaemonState();
    return { status: 'stale', pid: state.pid };
  }
}

/**
 * Check if the running daemon version matches the current CLI version.
 * This should work from both the daemon itself & a new CLI process.
 * Works via the daemon.state.json file.
 *
 * @returns true if versions match, false if versions differ or no daemon running
 */
export async function isDaemonRunningCurrentlyInstalledFreeVersion(): Promise<boolean> {
  logger.debug('[DAEMON CONTROL] Checking if daemon is running same version');
  const daemonState = await checkIfDaemonRunningAndCleanupStaleState();
  if (daemonState.status !== 'running') {
    logger.debug('[DAEMON CONTROL] No daemon running, returning false');
    return false;
  }

  try {
    // Read package.json on demand from disk - so we are guaranteed to get the latest version
    const packageJsonPath = join(projectPath(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const currentCliVersion = packageJson.version;

    logger.debug(
      `[DAEMON CONTROL] Current CLI version: ${currentCliVersion}, Daemon started with version: ${daemonState.version}`
    );
    return currentCliVersion === daemonState.version;
  } catch (error) {
    logger.debug('[DAEMON CONTROL] Error checking daemon version', error);
    return false;
  }
}

export async function cleanupDaemonState(): Promise<void> {
  try {
    await clearDaemonState();
    logger.debug('[DAEMON RUN] Daemon state file removed');
  } catch (error) {
    logger.debug('[DAEMON RUN] Error cleaning up daemon metadata', error);
  }
}

export async function stopDaemon() {
  try {
    const state = await readDaemonState();
    if (!state) {
      logger.debug('No daemon state found');
      return;
    }

    logger.debug(`Stopping daemon with PID ${state.pid}`);

    // Try HTTP graceful stop
    try {
      await stopDaemonHttp();

      // Wait for daemon to die
      await waitForProcessDeath(state.pid, 8000);
      logger.debug('Daemon stopped gracefully via HTTP');
      return;
    } catch (error) {
      logger.debug('HTTP stop failed, will force kill', error);
    }

    // Force kill
    try {
      process.kill(state.pid, 'SIGKILL');
      logger.debug('Force killed daemon');
    } catch (error) {
      logger.debug('Daemon already dead');
    }
  } catch (error) {
    logger.debug('Error stopping daemon', error);
  }
}

async function waitForProcessDeath(pid: number, timeout: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      process.kill(pid, 0);
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch {
      return; // Process is dead
    }
  }
  throw new Error('Process did not die within timeout');
}
