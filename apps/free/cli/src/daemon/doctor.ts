/**
 * Daemon doctor utilities
 *
 * Process discovery and cleanup functions for the daemon
 * Helps diagnose and fix issues with hung or orphaned processes
 */

import spawn from 'cross-spawn';
import psList from 'ps-list';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('daemon/doctor');

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

      // Check if it's a Free process
      const isFree =
        name.includes('free') ||
        (name === 'node' && (cmd.includes('free-cli') || cmd.includes('dist/cli.mjs'))) ||
        cmd.includes('cli.mjs') ||
        cmd.includes('@saaskit-dev/free') ||
        (cmd.includes('tsx') && cmd.includes('src/index.ts') && cmd.includes('free-cli'));

      if (!isFree) continue;

      // Classify process type
      let type = 'unknown';
      if (proc.pid === process.pid) {
        type = 'current';
      } else if (cmd.includes('--version')) {
        type = cmd.includes('tsx') ? 'dev-daemon-version-check' : 'daemon-version-check';
      } else if (cmd.includes('daemon start-sync') || cmd.includes('daemon start')) {
        type = cmd.includes('tsx') ? 'dev-daemon' : 'daemon';
      } else if (cmd.includes('--started-by daemon')) {
        type = cmd.includes('tsx') ? 'dev-daemon-spawned' : 'daemon-spawned-session';
      } else if (cmd.includes('doctor')) {
        type = cmd.includes('tsx') ? 'dev-doctor' : 'doctor';
      } else if (cmd.includes('--yolo')) {
        type = 'dev-session';
      } else {
        type = cmd.includes('tsx') ? 'dev-related' : 'user-session';
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

  // Filter to just runaway processes (excluding current process)
  return allProcesses
    .filter(
      p =>
        p.pid !== process.pid &&
        (p.type === 'daemon' ||
          p.type === 'dev-daemon' ||
          p.type === 'daemon-spawned-session' ||
          p.type === 'dev-daemon-spawned' ||
          p.type === 'daemon-version-check' ||
          p.type === 'dev-daemon-version-check')
    )
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
