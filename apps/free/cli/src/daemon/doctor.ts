/**
 * Daemon doctor utilities
 *
 * Process discovery and cleanup functions for the daemon
 * Helps diagnose and fix issues with hung or orphaned processes
 */

import spawn from 'cross-spawn';
import psList from 'ps-list';
import { configuration } from '@/configuration';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('daemon/doctor');

function isDevProcess(cmd: string): boolean {
  return cmd.includes('--variant development') || cmd.includes('.free-dev');
}

/** Check if a command line belongs to a Free CLI process (not the server or other tooling). */
function isFreeCLIProcess(name: string, cmd: string): boolean {
  // Explicit Free CLI markers
  if (cmd.includes('free-cli') || cmd.includes('@saaskit-dev/free')) return true;
  // The compiled entrypoint lives at apps/free/cli/dist/cli.mjs — but we must
  // exclude other cli.mjs files (e.g. tsx's own cli.mjs used by the server).
  if (name === 'node' && cmd.includes('dist/cli.mjs') && !cmd.includes('tsx/dist/')) return true;
  // Catch 'free' binary name (e.g. installed via npm/curl)
  if (name === 'free') return true;
  return false;
}

/**
 * Find all Free CLI processes (including current process)
 */
export async function findAllFreeProcesses(): Promise<
  Array<{ pid: number; command: string; type: string }>
> {
  try {
    const processes = await psList();
    const allProcesses: Array<{ pid: number; command: string; type: string }> = [];

    for (const proc of processes) {
      const cmd = proc.cmd || '';
      const name = proc.name || '';

      if (!isFreeCLIProcess(name, cmd)) continue;

      // Classify process type
      // Use --variant flag (injected by spawnFreeCLI / plist / systemd) or fall back to tsx detection
      const isDev = isDevProcess(cmd);
      let type = 'unknown';
      if (proc.pid === process.pid) {
        type = 'current';
      } else if (cmd.includes('--version')) {
        type = isDev ? 'dev-daemon-version-check' : 'daemon-version-check';
      } else if (cmd.includes('daemon start-sync') || cmd.includes('daemon start')) {
        type = isDev ? 'dev-daemon' : 'daemon';
      } else if (cmd.includes('--started-by daemon')) {
        type = isDev ? 'dev-daemon-spawned' : 'daemon-spawned-session';
      } else if (cmd.includes('doctor')) {
        type = isDev ? 'dev-doctor' : 'doctor';
      } else if (cmd.includes('--yolo')) {
        type = 'dev-session';
      } else {
        type = isDev ? 'dev-related' : 'user-session';
      }

      allProcesses.push({ pid: proc.pid, command: cmd || name, type });
    }

    return allProcesses;
  } catch (error) {
    return [];
  }
}

/**
 * Find all runaway Free CLI processes that should be killed
 */
export async function findRunawayFreeProcesses(): Promise<Array<{ pid: number; command: string }>> {
  const allProcesses = await findAllFreeProcesses();

  // Use configuration.variant to scope cleanup to the current environment.
  // curl install and npm global are both 'production' — they manage each other's processes.
  // dev (APP_ENV=development) is isolated.
  const allowedTypes = configuration.variant === 'development'
    ? ['dev-daemon-spawned', 'dev-daemon-version-check']
    : ['daemon-spawned-session', 'daemon-version-check'];

  // Filter to just runaway processes:
  // - Exclude current process
  // - Exclude daemon itself (use `free daemon stop` to stop it)
  // - Only match processes from the same environment (dev or production)
  return allProcesses
    .filter(p => p.pid !== process.pid && allowedTypes.includes(p.type))
    .map(p => ({ pid: p.pid, command: p.command }));
}

/**
 * Kill all runaway Free CLI processes
 */
export async function killRunawayFreeProcesses(): Promise<{
  killed: number;
  errors: Array<{ pid: number; error: string }>;
}> {
  const runawayProcesses = await findRunawayFreeProcesses();
  const errors: Array<{ pid: number; error: string }> = [];
  let killed = 0;

  for (const { pid, command } of runawayProcesses) {
    try {
      logger.info('Killing runaway process', { pid, command });

      if (process.platform === 'win32') {
        // Windows: use taskkill
        const result = spawn.sync('taskkill', ['/F', '/PID', pid.toString()], { stdio: 'pipe' });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`taskkill exited with code ${result.status}`);
      } else {
        // Unix: try SIGTERM first
        process.kill(pid, 'SIGTERM');

        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if still alive
        const processes = await psList();
        const stillAlive = processes.find(p => p.pid === pid);
        if (stillAlive) {
          logger.debug('Process ignored SIGTERM, using SIGKILL', { pid });
          process.kill(pid, 'SIGKILL');
        }
      }

      logger.info('Killed runaway process', { pid });
      killed++;
    } catch (error) {
      const errorMessage = (error as Error).message;
      errors.push({ pid, error: errorMessage });
      logger.warn('Failed to kill runaway process', { pid, error: errorMessage });
    }
  }

  return { killed, errors };
}
