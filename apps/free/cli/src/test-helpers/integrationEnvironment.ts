import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { homedir } from 'node:os';
import { configuration } from '@/configuration';
import { readCredentials, writeCredentialsLegacy } from '@/persistence';
import { getRandomBytes } from '@/api/encryption';
import { authGetToken } from '@/api/auth';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('test-helpers/integrationEnvironment');

const TEST_MASTER_SECRET = 'free-cli-integration-test-secret';

function parseServerPort(serverUrl: string): number {
  return Number(new URL(serverUrl).port || 80);
}

function getProjectRoot(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
}

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

async function probeAuth(): Promise<boolean> {
  try {
    await authGetToken(getRandomBytes(32));
    return true;
  } catch {
    return false;
  }
}

async function killProcessOnPort(port: number): Promise<void> {
  const child = spawn('sh', ['-lc', `lsof -ti tcp:${port}`], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  await new Promise<void>((resolve) => {
    child.on('exit', () => resolve());
  });

  const pids = stdout
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore
    }
  }

  if (pids.length > 0) {
    logger.info('[integrationEnvironment] terminated existing server process on port', {
      port,
      pids,
    });
    await delay(1000);
  }
}

export async function ensureLocalServerAndCredentials(): Promise<{
  serverProcess: ChildProcess | null;
}> {
  let serverProcess: ChildProcess | null = null;
  const port = parseServerPort(configuration.serverUrl);

  try {
    await waitForServerHealthy(1000);
    if (await probeAuth()) {
      logger.info('[integrationEnvironment] reusing existing server', {
        serverUrl: configuration.serverUrl,
      });
    } else {
      logger.warn('[integrationEnvironment] existing server failed auth probe; restarting', {
        serverUrl: configuration.serverUrl,
      });
      await killProcessOnPort(port);
      throw new Error('restart required');
    }
  } catch {
    const projectRoot = getProjectRoot();
    const pgliteDir = join(configuration.freeHomeDir, 'integration-pglite');
    const dataDir = join(configuration.freeHomeDir, 'integration-server-data');
    const serverLogFile = join(configuration.logsDir, 'integration-server-bootstrap.log');
    const serverLogStream = createWriteStream(serverLogFile, { flags: 'a' });

    serverProcess = spawn(
      'pnpm',
      ['--filter', '@free/server', 'standalone', 'serve'],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          PORT: String(port),
          APP_ENV: 'development',
          FREE_HOME_DIR: process.env.FREE_HOME_DIR || join(homedir(), '.free-dev'),
          FREE_MASTER_SECRET: process.env.FREE_MASTER_SECRET || TEST_MASTER_SECRET,
          JWT_SECRET: process.env.JWT_SECRET || 'free-cli-integration-jwt-secret',
          DATA_DIR: dataDir,
          PGLITE_DIR: pgliteDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    serverProcess.stdout?.pipe(serverLogStream);
    serverProcess.stderr?.pipe(serverLogStream);
    serverProcess.once('exit', () => {
      serverLogStream.end();
    });

    logger.info('[integrationEnvironment] started local server for integration tests', {
      pid: serverProcess.pid,
      serverUrl: configuration.serverUrl,
      dataDir,
      pgliteDir,
      serverLogFile,
    });

    await waitForServerHealthy();
  }

  await ensureCredentials();
  return { serverProcess };
}

export async function stopSpawnedProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.killed || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    setTimeout(() => resolve(), 5000);
  });
}
