import { existsSync, readFileSync } from 'node:fs';
import { spawnFreeCLI } from '@/utils/spawnFreeCLI';
import { readDaemonState } from '@/persistence';
import { listDaemonSessions, stopDaemon } from '@/daemon/controlClient';
import { configuration } from '@/configuration';

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 100
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout waiting for condition (${timeoutMs}ms)`);
}

export async function startDaemonForIntegrationTest(): Promise<number> {
  await stopDaemon();

  const useRealAgentHome = process.env.FREE_RUN_REAL_AGENT_SMOKE === '1';
  const daemonEnv = useRealAgentHome
    ? {
        ...process.env,
        HOME: process.env.FREE_TEST_ORIGINAL_HOME || process.env.HOME,
        USERPROFILE: process.env.FREE_TEST_ORIGINAL_USERPROFILE || process.env.USERPROFILE,
        CODEX_HOME: process.env.FREE_TEST_ORIGINAL_CODEX_HOME || process.env.CODEX_HOME,
      }
    : process.env;

  void spawnFreeCLI(['daemon', 'start-sync'], {
    env: daemonEnv,
    stdio: 'ignore',
  });

  let daemonPid: number | null = null;
  await waitFor(
    async () => {
      const state = await readDaemonState();
      if (state?.pid) {
        daemonPid = state.pid;
        return true;
      }

      if (existsSync(configuration.daemonLockFile)) {
        const rawPid = readFileSync(configuration.daemonLockFile, 'utf-8').trim();
        const parsedPid = Number.parseInt(rawPid, 10);
        if (Number.isFinite(parsedPid) && parsedPid > 0) {
          daemonPid = parsedPid;
          return true;
        }
      }

      return false;
    },
    60_000,
    250
  );

  const daemonState = await readDaemonState();
  if (!daemonState && !daemonPid) {
    throw new Error('Daemon failed to start within timeout');
  }

  return daemonState?.pid ?? daemonPid!;
}

export async function waitForTrackedDaemonSession(
  sessionId: string,
  timeoutMs = 30_000
): Promise<{
  sessionId: string;
  agentType: string;
  cwd: string;
  state: string;
  startedAt: string;
  startedBy: string;
}> {
  let trackedSession:
    | {
        sessionId: string;
        agentType: string;
        cwd: string;
        state: string;
        startedAt: string;
        startedBy: string;
      }
    | undefined;

  await waitFor(
    async () => {
      const sessions = await listDaemonSessions();
      trackedSession = sessions.find(
        (candidate: { sessionId: string }) => candidate.sessionId === sessionId
      );
      return trackedSession !== undefined;
    },
    timeoutMs,
    250
  );

  if (!trackedSession) {
    throw new Error(`Daemon session ${sessionId} was not tracked`);
  }

  return trackedSession;
}
