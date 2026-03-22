/**
 * Cross-platform Free CLI spawning utility
 *
 * ## Background
 *
 * We built a command-line JavaScript program with the entrypoint at `dist/cli.mjs`.
 * This needs to be run with `node`, but we want to hide deprecation warnings and other
 * noise from end users by passing specific flags: `--no-warnings --no-deprecation`.
 *
 * Users don't care about these technical details - they just want a clean experience
 * with no warning output when using Free.
 *
 * ## The Wrapper Strategy
 *
 * The CLI entrypoint (cli.ts) self-handles Node.js flags by re-executing itself
 * with the correct flags if needed. The `bin` field in package.json points directly
 * to `dist/cli.mjs`.
 *
 * ## Execution Chains
 *
 * **All platforms:**
 * 1. User runs `free` command
 * 2. NPM executes `dist/cli.mjs` with node
 * 3. `dist/cli.mjs` checks if flags are set, re-execs if needed, then imports the main CLI
 *
 * ## The Spawning Solution
 *
 * Since we know exactly what needs to happen (run `dist/cli.mjs` with specific
 * Node.js flags), we can do it directly:
 *
 * `spawn('node', ['--no-warnings', '--no-deprecation', 'dist/cli.mjs', ...args])`
 *
 * This works on all platforms.
 */

import { spawn, SpawnOptions, type ChildProcess } from 'child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectPath } from '@/projectPath';
import { configuration } from '@/configuration';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('utils/spawnFreeCLI');

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForEntrypointSync(entrypoint: string, timeoutMs = 10_000): boolean {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(entrypoint)) return true;
    sleepSync(100);
  }
  return existsSync(entrypoint);
}

/**
 * Spawn the Free CLI with the given arguments in a cross-platform way.
 *
 * This function spawns the actual CLI entrypoint (dist/cli.mjs) directly with Node.js,
 * ensuring compatibility across all platforms including Windows.
 *
 * @param args - Arguments to pass to the Free CLI
 * @param options - Spawn options (same as child_process.spawn)
 * @returns ChildProcess instance
 */
export function spawnFreeCLI(args: string[], options: SpawnOptions = {}): ChildProcess {
  const projectRoot = projectPath();
  const entrypoint = join(projectRoot, 'dist', 'cli.mjs');

  let directory: string | URL | undefined;
  if ('cwd' in options) {
    directory = options.cwd;
  } else {
    directory = process.cwd();
  }
  // Note: We're actually executing 'node' with the calculated entrypoint path below,
  // bypassing the 'free' wrapper that would normally be found in the shell's PATH.
  // However, we log it as 'free' here because other engineers are typically looking
  // for when "free" was started and don't care about the underlying node process
  // details and flags we use to achieve the same result.
  const fullCommand = `free ${args.join(' ')}`;
  logger.debug(`[SPAWN FREE CLI] Spawning: ${fullCommand} in ${directory}`);

  // Use the same Node.js flags that the wrapper script uses
  // Inject --variant so spawned processes are identifiable by environment (dev vs production)
  const nodeArgs = [
    '--no-warnings',
    '--no-deprecation',
    entrypoint,
    '--variant',
    configuration.variant,
    ...args,
  ];

  // Sanity check of the entrypoint path exists
  if (!waitForEntrypointSync(entrypoint)) {
    const errorMessage = `Entrypoint ${entrypoint} does not exist`;
    logger.debug(`[SPAWN FREE CLI] ${errorMessage}`);
    throw new Error(errorMessage);
  }

  // Ensure APP_ENV is propagated so child processes inherit the correct variant
  // without relying solely on the --variant CLI flag.
  const env = {
    ...(options.env ?? process.env),
    APP_ENV: configuration.isDev ? 'development' : 'production',
  };

  // Use absolute path to the current runtime to avoid PATH issues in daemon processes
  // process.execPath gives us the absolute path to the node/bun binary running this process
  const runtime = process.execPath;
  return spawn(runtime, nodeArgs, { ...options, env });
}
