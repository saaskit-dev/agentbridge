/**
 * HTTP client helpers for daemon communication
 * Used by CLI commands to interact with running daemon
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { configuration } from '@/configuration';
import type { AgentType } from '@/daemon/sessions/types';
import { clearDaemonState, readDaemonState } from '@/persistence';
import { projectPath } from '@/projectPath';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
const logger = new Logger('daemon/controlClient');

/**
 * Read the PID from the daemon lock file
 * This is useful when the daemon is still starting (waiting for credentials)
 * and hasn't written daemon.state.json yet
 */
function readDaemonLockPid(): number | null {
  try {
    const lockFile = configuration.daemonLockFile;
    if (!existsSync(lockFile)) {
      return null;
    }
    const content = readFileSync(lockFile, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

async function daemonPost(path: string, body?: any): Promise<{ error?: string } | any> {
  const state = await readDaemonState();
  if (!state?.httpPort) {
    const errorMessage = 'No daemon running, no state file found';
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return {
      error: errorMessage,
    };
  }

  if (!state.controlToken) {
    const errorMessage = 'Daemon state missing controlToken — daemon may need restart';
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.controlToken}`,
      },
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
    const errorMessage = `Request failed: ${path}, ${safeStringify(error)}`;
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return {
      error: errorMessage,
    };
  }
}

export async function listDaemonSessions(): Promise<any[]> {
  const result = await daemonPost('/list');
  return result.sessions || [];
}

export async function stopDaemonSession(sessionId: string): Promise<boolean> {
  const result = await daemonPost('/stop-session', { sessionId });
  return result.success || false;
}

export async function spawnDaemonSession(
  directory: string,
  sessionId?: string,
  agent?: AgentType
): Promise<any> {
  const result = await daemonPost('/spawn-session', { directory, sessionId, agent });
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
  | {
      status: 'running';
      pid: number;
      startTime: string;
      version: string;
      httpPort?: number;
      buildHash?: string;
      buildTime?: string;
    }
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
      buildHash: state.buildHash,
      buildTime: state.buildTime,
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
    // Read build hash from dist/.hash file
    const buildHashPath = join(projectPath(), 'dist', '.hash');
    let currentBuildHash: string | undefined;
    if (existsSync(buildHashPath)) {
      currentBuildHash = readFileSync(buildHashPath, 'utf-8').trim();
    }

    // Fallback: compute hash from dist directory if .hash file doesn't exist
    if (!currentBuildHash) {
      const distPath = join(projectPath(), 'dist');
      const files = readdirSync(distPath).filter(f => f.endsWith('.mjs') || f.endsWith('.cjs'));
      const hash = createHash('md5');
      for (const file of files) {
        const filePath = join(distPath, file);
        const content = readFileSync(filePath);
        hash.update(content);
      }
      currentBuildHash = hash.digest('hex');
    }

    logger.debug(
      `[DAEMON CONTROL] Current build hash: ${currentBuildHash?.substring(0, 8)}, Daemon hash: ${daemonState.buildHash?.substring(0, 8) ?? 'not set'}`
    );

    // Compare build hashes
    if (daemonState.buildHash && currentBuildHash && daemonState.buildHash !== currentBuildHash) {
      logger.debug(
        `[DAEMON CONTROL] Build hash mismatch (daemon: ${daemonState.buildHash?.substring(0, 8)}, current: ${currentBuildHash.substring(0, 8)})`
      );
      return false;
    }

    // Read package.json on demand from disk - so we are guaranteed to get the latest version
    const packageJsonPath = join(projectPath(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const currentCliVersion = packageJson.version;

    logger.debug(
      `[DAEMON CONTROL] Current CLI version: ${currentCliVersion}, Daemon started with version: ${daemonState.version}`
    );
    return currentCliVersion === daemonState.version && daemonState.buildHash === currentBuildHash;
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
    // First try to get PID from daemon state file
    let state = await readDaemonState();
    let pid = state?.pid;

    // If no state file, check the lock file for PID
    if (!pid) {
      const lockPid = await readDaemonLockPid();
      if (lockPid) {
        pid = lockPid;
        logger.debug(`Found daemon PID ${pid} from lock file`);
      }
    }

    if (!pid) {
      logger.debug('No daemon running (no state or lock file found)');
      return;
    }

    logger.debug(`Stopping daemon with PID ${pid}`);

    // Try HTTP graceful stop
    try {
      await stopDaemonHttp();

      // Wait for daemon to die
      await waitForProcessDeath(pid, 8000);
      logger.debug('Daemon stopped gracefully via HTTP');
      return;
    } catch (error) {
      logger.debug('HTTP stop failed, will force kill', error);
    }

    // Force kill
    try {
      process.kill(pid, 'SIGKILL');
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
