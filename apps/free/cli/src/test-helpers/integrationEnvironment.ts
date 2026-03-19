import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { configuration } from '@/configuration';
import { readCredentials, writeCredentialsLegacy } from '@/persistence';
import { getRandomBytes } from '@/api/encryption';
import { authGetToken } from '@/api/auth';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('test-helpers/integrationEnvironment');

async function waitForServerHealthy(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${configuration.serverUrl}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for server health at ${configuration.serverUrl}`);
}

async function ensureCredentials(): Promise<void> {
  const existing = await readCredentials();
  if (existing) return;

  const secret = getRandomBytes(32);
  const token = await authGetToken(secret);

  await writeCredentialsLegacy({
    token,
    secret,
  });

  logger.info('[integrationEnvironment] wrote test credentials', {
    freeHomeDir: configuration.freeHomeDir,
    privateKeyFile: configuration.privateKeyFile,
  });
}

/**
 * Ensure the integration test server (started by globalSetup) is healthy,
 * and that test credentials exist. Does NOT start a server — globalSetup handles that.
 */
export async function ensureLocalServerAndCredentials(): Promise<void> {
  await waitForServerHealthy();
  await ensureCredentials();
}

export async function stopSpawnedProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.killed || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    setTimeout(() => resolve(), 5000);
  });
}
