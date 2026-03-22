/**
 * Test setup file for vitest (globalSetup)
 *
 * Runs ONCE before all tests. Responsibilities:
 *   1. Isolate test artifacts (HOME, FREE_HOME_DIR, etc.)
 *   2. Build the CLI so integration tests can spawn it
 *   3. Start a local PGlite-backed server on a random port
 *      — all integration tests share this single server instance
 *      — no conflict with dev/production servers
 */

import { randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function ensureDir(p: string) {
  try {
    mkdirSync(p, { recursive: true });
  } catch {
    // ignore
  }
}

async function waitForHealth(url: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (resp.ok) return;
    } catch {
      // retry
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server health check timed out at ${url}`);
}

let serverProcess: ChildProcess | null = null;

export async function setup() {
  // ---------------------------------------------------------------------------
  // 1. Isolate test artifacts
  // ---------------------------------------------------------------------------
  const runId = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const base = join(homedir(), '.free-test', 'vitest', runId);
  const freeHomeDir = join(base, 'free');
  const fakeHomeDir = join(base, 'home');
  const isolatedServerPort = 32000 + Math.floor(Math.random() * 10000);
  const originalHome = process.env.HOME || homedir();
  const originalUserProfile = process.env.USERPROFILE;
  const originalCodexHome = process.env.CODEX_HOME;

  ensureDir(freeHomeDir);
  ensureDir(fakeHomeDir);

  process.env.FREE_HOME_DIR = freeHomeDir;
  process.env.FREE_SERVER_URL = `http://localhost:${isolatedServerPort}`;
  process.env.FREE_WEBAPP_URL = 'http://localhost:8081';
  process.env.CLAUDE_CONFIG_DIR = join(fakeHomeDir, '.claude');
  process.env.FREE_TEST_ORIGINAL_HOME = originalHome;
  if (originalUserProfile) {
    process.env.FREE_TEST_ORIGINAL_USERPROFILE = originalUserProfile;
  }
  if (originalCodexHome) {
    process.env.FREE_TEST_ORIGINAL_CODEX_HOME = originalCodexHome;
  }

  process.env.HOME = fakeHomeDir;
  process.env.USERPROFILE = fakeHomeDir;
  process.env.VITEST_POOL_TIMEOUT = '60000';

  // ---------------------------------------------------------------------------
  // 2. Build CLI
  // ---------------------------------------------------------------------------
  const buildResult = spawnSync('pnpm', ['build'], { stdio: 'pipe' });

  if (buildResult.stderr && buildResult.stderr.length > 0) {
    const errorOutput = buildResult.stderr.toString();
    console.error(`Build stderr (could be debugger output): ${errorOutput}`);
    const stdout = buildResult.stdout.toString();
    console.log(`Build stdout: ${stdout}`);

    if (errorOutput.includes('Command failed with exit code')) {
      throw new Error(`Build failed STDERR: ${errorOutput}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Start isolated integration test server (PGlite, random port)
  //    Unit tests ignore this; integration tests connect to it automatically.
  // ---------------------------------------------------------------------------
  const projectRoot = join(import.meta.dirname, '..', '..', '..', '..');
  const pgliteDir = join(freeHomeDir, 'integration-pglite');
  const dataDir = join(freeHomeDir, 'integration-server-data');
  const serverLogFile = join(freeHomeDir, 'logs', 'integration-server-bootstrap.log');
  ensureDir(join(freeHomeDir, 'logs'));
  const serverLogStream = createWriteStream(serverLogFile, { flags: 'a' });

  serverProcess = spawn('pnpm', ['--filter', '@free/server', 'standalone', 'serve'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(isolatedServerPort),
      APP_ENV: 'development',
      FREE_HOME_DIR: freeHomeDir,
      FREE_MASTER_SECRET: 'free-cli-integration-test-secret',
      JWT_SECRET: 'free-cli-integration-jwt-secret',
      DATA_DIR: dataDir,
      PGLITE_DIR: pgliteDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.pipe(serverLogStream);
  serverProcess.stderr?.pipe(serverLogStream);
  serverProcess.once('exit', () => serverLogStream.end());

  console.log(
    `[globalSetup] Starting integration server on port ${isolatedServerPort} (PID ${serverProcess.pid})`
  );
  console.log(`[globalSetup] Server log: ${serverLogFile}`);

  await waitForHealth(`http://localhost:${isolatedServerPort}`);
  console.log(`[globalSetup] Integration server healthy`);
}

export async function teardown() {
  if (serverProcess && !serverProcess.killed && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await new Promise<void>(resolve => {
      serverProcess!.once('exit', () => resolve());
      setTimeout(() => resolve(), 5000);
    });
    console.log(`[globalSetup] Integration server stopped`);
  }
}
