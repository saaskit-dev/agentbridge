import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Session, UpdateSessionBody } from '@/api/types';
import { readCredentials } from '@/persistence';
import {
  ensureLocalServerAndCredentials,
  stopSpawnedProcess,
} from '@/test-helpers/integrationEnvironment';
import { FakeAppClient } from '@/test-helpers/FakeAppClient';
import {
  startDaemonForIntegrationTest,
  waitForTrackedDaemonSession,
} from '@/test-helpers/daemonTestHarness';
import { spawnDaemonSession, stopDaemon, stopDaemonSession } from '@/daemon/controlClient';

const runRealAgentSmoke = process.env.FREE_RUN_REAL_AGENT_SMOKE === '1';

type SmokeResult =
  | { kind: 'capabilities'; value: unknown }
  | { kind: 'error'; value: unknown };

async function waitForSmokeOutcome(
  appClient: FakeAppClient,
  session: Session,
  sessionId: string,
  timeoutMs: number
): Promise<SmokeResult> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const capabilityUpdate = appClient.receivedUpdates.find((event) => {
      return (
        event.body?.t === 'update-session' &&
        event.body.id === sessionId &&
        (event.body.capabilities?.version ?? 0) > 0
      );
    });

    if (capabilityUpdate && capabilityUpdate.body.t === 'update-session') {
      return {
        kind: 'capabilities',
        value: appClient.decryptCapabilities(session, capabilityUpdate.body as UpdateSessionBody),
      };
    }

    const fetched = await appClient.fetchMessages(session);
    for (const message of fetched.messages) {
      const decrypted = await appClient.decryptSessionMessage(session, message) as
        | { role?: string; content?: unknown }
        | null;
      if (decrypted?.role !== 'event') {
        continue;
      }
      const eventContent = decrypted.content as { type?: string; message?: string } | undefined;
      if (eventContent?.type === 'error') {
        return { kind: 'error', value: decrypted };
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for smoke outcome for session ${sessionId}`);
}

function expectSmokeOutcome(outcome: SmokeResult): void {
  if (outcome.kind === 'capabilities') {
    const capabilities = outcome.value as Record<string, unknown> | null;
    expect(capabilities).toBeTruthy();
    expect(
      Boolean(
        (capabilities as { models?: unknown })?.models ||
          (capabilities as { modes?: unknown })?.modes ||
          (capabilities as { configOptions?: unknown })?.configOptions ||
          (capabilities as { commands?: unknown })?.commands
      )
    ).toBe(true);
    return;
  }

  const visibleError = outcome.value as {
    role?: string;
    content?: { type?: string; message?: string };
  } | null;
  expect(visibleError?.role).toBe('event');
  expect(visibleError?.content?.type).toBe('error');
  expect(visibleError?.content?.message).toBeTruthy();
}

describe.skipIf(!runRealAgentSmoke)(
  'Real daemon ACP smoke integration',
  { timeout: 120_000 },
  () => {
    let serverProcess: import('node:child_process').ChildProcess | null = null;
    let appClient: FakeAppClient;
    let token: string;
    let daemonPid = 0;

    beforeAll(async () => {
      await ensureLocalServerAndCredentials();

      const credentials = await readCredentials();
      if (!credentials) throw new Error('Missing test credentials');

      token = credentials.token;
      appClient = await FakeAppClient.create(credentials);
      await appClient.connectUserSocket();
      daemonPid = await startDaemonForIntegrationTest();
      expect(daemonPid).toBeGreaterThan(0);
    }, 120_000);

    afterAll(async () => {
      await appClient?.disconnect();
      await stopDaemon();
    }, 120_000);

    it('claude-acp surfaces initial capabilities or a visible error instead of failing silently', async () => {
      const session = await appClient.createSession();

      try {
        const spawnResult = await spawnDaemonSession('/tmp', undefined, 'claude-acp');
        expect(spawnResult).toHaveProperty('success', true);
        expect(spawnResult.sessionId).toBe(session.id);

        await waitForTrackedDaemonSession(session.id);

        const { response } = await appClient.sendUserTextMessage(
          session,
          'Reply with one short sentence.',
          {
            meta: {
              sentFrom: 'daemon-agent-smoke',
              permissionMode: 'read-only',
            },
          }
        );
        expect(response.status).toBe(200);

        const outcome = await waitForSmokeOutcome(appClient, session, session.id, 45_000);
        expectSmokeOutcome(outcome);
      } finally {
        await stopDaemonSession(session.id);
        await fetchSessionDelete(token, session.id);
      }
    });

    it('codex-acp surfaces either initial capabilities or a visible error instead of failing silently', async () => {
      const session = await appClient.createSession();

      try {
        const spawnResult = await spawnDaemonSession('/tmp', undefined, 'codex-acp');
        expect(spawnResult).toHaveProperty('success', true);
        expect(spawnResult.sessionId).toBe(session.id);

        await waitForTrackedDaemonSession(session.id);

        const { response } = await appClient.sendUserTextMessage(
          session,
          'Reply with one short sentence.',
          {
            meta: {
              sentFrom: 'daemon-agent-smoke',
              permissionMode: 'read-only',
            },
          }
        );
        expect(response.status).toBe(200);

        const outcome = await waitForSmokeOutcome(appClient, session, session.id, 140_000);
        expectSmokeOutcome(outcome);
      } finally {
        await stopDaemonSession(session.id);
        await fetchSessionDelete(token, session.id);
      }
    }, 180_000);
  }
);

async function fetchSessionDelete(token: string, sessionId: string): Promise<void> {
  try {
    await fetch(`${process.env.FREE_SERVER_URL || 'http://localhost:3005'}/v1/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    // ignore cleanup failures
  }
}
