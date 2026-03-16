/**
 * Test setup file for vitest
 *
 * Global setup that runs ONCE before all tests
 */

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function ensureDir(p: string) {
  try {
    mkdirSync(p, { recursive: true });
  } catch {
    // ignore
  }
}

export function setup() {
  // -------------------------------------------------------------------------
  // Dev/CI hygiene:
  // - Never write test artifacts into stable user state (~/.free).
  // - Default to dedicated test paths (~/.free-test/...) and a per-run isolated dir.
  // - Avoid polluting real Claude config (~/.claude) during tests.
  // -------------------------------------------------------------------------

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

  // Do NOT force APP_ENV here. Many unit tests intentionally assert behavior when
  // APP_ENV is unset (production-like). Individual tests can set APP_ENV when needed.
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

  // Some code uses homedir()-based paths. Redirecting HOME helps prevent writes
  // into the developer's real home directory during tests.
  process.env.HOME = fakeHomeDir;
  process.env.USERPROFILE = fakeHomeDir;

  // Extend test timeout for integration tests
  process.env.VITEST_POOL_TIMEOUT = '60000';

  // Make sure to build the project before running tests
  // We rely on the dist files to spawn our CLI in integration tests
  const buildResult = spawnSync('yarn', ['build'], { stdio: 'pipe' });

  if (buildResult.stderr && buildResult.stderr.length > 0) {
    const errorOutput = buildResult.stderr.toString();
    console.error(`Build stderr (could be debugger output): ${errorOutput}`);
    const stdout = buildResult.stdout.toString();
    console.log(`Build stdout: ${stdout}`);

    if (errorOutput.includes('Command failed with exit code')) {
      throw new Error(`Build failed STDERR: ${errorOutput}`);
    }
  }
}
