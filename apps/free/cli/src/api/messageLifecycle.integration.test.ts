/**
 * E2E integration test for the full message lifecycle:
 *   App (test) → Server → Daemon/Claude → Server → App (test)
 *
 * Zero-mock — real Server, real Daemon, real Claude API.
 *
 * Prerequisites (any missing → describe.skipIf + friendly hint):
 *   1. Credentials:  free auth login
 *   2. Server:       $FREE_SERVER_URL must respond to /health
 *   3. Daemon:       free daemon start
 *
 * Run:
 *   cd apps/free/cli
 *   dotenv -e .env.integration-test -- npx vitest run src/api/messageLifecycle.integration.test.ts
 */

import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { readCredentials } from '@/persistence';
import { configuration } from '@/configuration';
import {
  checkIfDaemonRunningAndCleanupStaleState,
  listDaemonSessions,
  spawnDaemonSession,
  stopDaemonSession,
} from '@/daemon/controlClient';
import { ApiClient } from '@/api/api';
import { decrypt, decodeBase64, encrypt, encodeBase64 } from '@/api/encryption';
import { projectPath } from '@/projectPath';
import type { Metadata, WireTrace } from '@/api/types';
import { Logger } from '@agentbridge/core/telemetry';

const logger = new Logger('api/messageLifecycle.integration.test');

// ─── Pre-requisite check ─────────────────────────────────────────────────────

async function checkPrerequisites(): Promise<{ ready: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  const creds = await readCredentials();
  if (!creds) {
    reasons.push('❌ 未找到认证信息 → 请先运行: free auth login');
  }

  try {
    const res = await fetch(`${configuration.serverUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      reasons.push(`❌ Server 返回 ${res.status} → 请启动 Server (${configuration.serverUrl})`);
    }
  } catch {
    reasons.push(`❌ Server 不可达 (${configuration.serverUrl}) → 请启动 Server`);
  }

  const daemonState = await checkIfDaemonRunningAndCleanupStaleState();
  if (daemonState.status !== 'running') {
    reasons.push('❌ Daemon 未运行 → 请先运行: free daemon start');
  }

  return { ready: reasons.length === 0, reasons };
}

const { ready, reasons } = await checkPrerequisites();
if (!ready) {
  console.log('[E2E Test] 跳过：前置条件未满足');
  reasons.forEach(r => console.log(' ', r));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function waitForEvent<T>(
  events: T[],
  predicate: (e: T) => boolean,
  timeoutMs = 90_000,
  description = ''
): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const match = events.find(predicate);
      if (match) return resolve(match);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`waitForEvent timeout (${timeoutMs}ms): ${description}`));
      }
      setTimeout(check, 200);
    };
    check();
  });
}

/**
 * Poll listDaemonSessions() until the given sessionId appears, confirming the
 * daemon has fully registered the session and is ready to receive messages.
 */
async function waitForDaemonSession(sessionId: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (true) {
    const sessions = await listDaemonSessions();
    if (sessions.some((s: any) => s.freeSessionId === sessionId)) {
      logger.debug('[E2E] Daemon session ready', { sessionId });
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForDaemonSession timeout (${timeoutMs}ms): sessionId=${sessionId}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

/**
 * Wait until at least one agent reply (role=agent) arrives for the session.
 * The daemon sends `closeClaudeSessionTurn('completed')` after Claude finishes,
 * but that only emits a session-protocol envelope — NOT `activity.active=false`.
 * The `activity.active=false` ephemeral is only emitted when the full session
 * terminates (sendSessionDeath). Instead, we detect turn completion by watching
 * for the first decryptable agent reply in the collected updates.
 */
function waitForAgentReply(
  updates: any[],
  sessionId: string,
  encKey: Uint8Array,
  encVariant: 'legacy' | 'dataKey',
  timeoutMs = 90_000
): Promise<any> {
  return waitForEvent(
    updates,
    u => {
      if (u.body?.t !== 'new-message' || u.body?.sid !== sessionId) return false;
      const encContent = u.body?.message?.content?.c;
      if (!encContent) return false;
      try {
        const decrypted = decrypt(encKey, encVariant, decodeBase64(encContent));
        return decrypted?.role === 'agent';
      } catch {
        return false;
      }
    },
    timeoutMs,
    'agent reply message (role=agent)'
  );
}

/**
 * Build the message body the same way the app does in sync.ts:
 * meta includes permissionMode, sentFrom, model, fallbackModel, appendSystemPrompt.
 * permissionMode=bypassPermissions so the daemon auto-approves all tool calls
 * (no session-scoped socket is present to send RPC approvals during tests).
 */
function buildUserMessageBody(text: string): Record<string, unknown> {
  return {
    role: 'user',
    content: { type: 'text', text },
    meta: {
      sentFrom: 'test',
      permissionMode: 'bypassPermissions',
      model: null,
      fallbackModel: null,
      appendSystemPrompt: null,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe.skipIf(!ready)('Message Lifecycle E2E', { timeout: 120_000 }, () => {
  let sessionId: string;
  let sessionTag: string;
  let encKey: Uint8Array;
  let encVariant: 'legacy' | 'dataKey';
  let token: string;
  let appSocket: Socket;

  const collectedUpdates: any[] = [];
  const collectedEphemerals: any[] = [];
  let sessionDeleted = false;

  beforeAll(async () => {
    // ── Step 1: Read credentials ──────────────────────────────────────────
    const creds = await readCredentials();
    if (!creds) throw new Error('No credentials — run: free auth login');
    token = creds.token;

    // ── Step 2: Create session via ApiClient (test controls encKey) ───────
    // Using a unique tag so the daemon can find this exact session
    sessionTag = randomUUID();
    const api = await ApiClient.create(creds);
    const libDir = projectPath();
    const sessionMetadata: Metadata = {
      path: '/tmp',
      host: os.hostname(),
      homeDir: os.homedir(),
      freeHomeDir: configuration.freeHomeDir,
      freeLibDir: libDir,
      freeToolsDir: libDir,
      startedBy: 'terminal',
    };
    const session = await api.getOrCreateSession({
      tag: sessionTag,
      metadata: sessionMetadata,
      state: null,
    });
    if (!session) throw new Error('Failed to create session via ApiClient');
    sessionId = session.id;
    encKey = session.encryptionKey;
    encVariant = session.encryptionVariant;
    logger.debug('[E2E] Session created', { sessionId, sessionTag, encVariant });
    const jwtUserId = (() => {
      try {
        const seg = token.split('.')[1];
        // base64url → base64
        const b64 = seg.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(seg.length / 4) * 4, '=');
        const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
        console.log('[E2E] JWT payload:', JSON.stringify(payload));
        return payload.user ?? payload.userId ?? payload.sub ?? '?';
      } catch (e) {
        console.log('[E2E] JWT decode error:', e);
        return '?';
      }
    })();
    console.log(`[E2E] SESSION_ID=${sessionId}  USER_ID=${jwtUserId}`);

    // ── Step 3: Connect user-scoped App socket ────────────────────────────
    await new Promise<void>((resolve, reject) => {
      appSocket = io(configuration.serverUrl, {
        path: '/v1/updates',
        auth: { token, clientType: 'user-scoped' },
        transports: ['websocket'],
        // Keep reconnection enabled — mirrors app behavior and prevents missing
        // events caused by a brief server-side disconnect during the test.
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 3000,
      });

      appSocket.on('connect', () => {
        logger.debug('[E2E] App socket connected', { id: appSocket.id });
        resolve();
      });
      appSocket.on('connect_error', err => {
        reject(new Error(`App socket connect error: ${err.message}`));
      });
      appSocket.on('update', (data: any) => {
        logger.debug('[E2E] update', { t: data?.body?.t, sid: data?.body?.sid });
        collectedUpdates.push(data);
      });
      appSocket.on('ephemeral', (data: any) => {
        const type = data?.type;
        if (type === 'text_delta') {
          logger.debug('[E2E] ephemeral text_delta', {
            sessionId: data?.sessionId,
            messageId: data?.messageId,
            len: data?.delta?.length,
            traceId: data?._trace?.tid,
          });
        } else if (type === 'text_complete') {
          logger.debug('[E2E] ephemeral text_complete', {
            sessionId: data?.sessionId,
            messageId: data?.messageId,
            fullTextLen: data?.fullText?.length,
            traceId: data?._trace?.tid,
          });
        } else if (type === 'activity') {
          logger.debug('[E2E] ephemeral activity', {
            id: data?.id,
            active: data?.active,
            thinking: data?.thinking,
          });
        } else {
          logger.debug('[E2E] ephemeral', { type, id: data?.id, active: data?.active });
        }
        collectedEphemerals.push(data);
      });

      setTimeout(() => reject(new Error('App socket connect timeout (10s)')), 10_000);
    });

    // ── Step 4: Tell Daemon to spawn into our session (via sessionTag) ────
    // The daemon uses FREE_SESSION_TAG to call getOrCreateSession({tag: sessionTag}),
    // finds the existing session, and recovers the encKey via the v1 block.
    const spawnResult = await spawnDaemonSession('/tmp', undefined, sessionTag);
    if (!spawnResult?.success) {
      throw new Error(`spawnDaemonSession failed: ${JSON.stringify(spawnResult)}`);
    }
    console.log(`[E2E] DAEMON spawn result: sessionId=${spawnResult.sessionId}  (test sessionId=${sessionId}  match=${spawnResult.sessionId === sessionId})`);
    // Verify the daemon connected to our session (same session ID)
    if (spawnResult.sessionId !== sessionId) {
      logger.debug('[E2E] Warning: daemon session ID differs from test session ID', {
        daemonSessionId: spawnResult.sessionId,
        testSessionId: sessionId,
        note: 'Using daemon session ID for subsequent operations',
      });
      sessionId = spawnResult.sessionId;
    }

    // ── Step 5: Wait for Daemon to register the session ──────────────────
    // Poll listDaemonSessions() until sessionId appears — confirms the daemon
    // has connected its ApiSessionClient and is ready to receive messages.
    logger.debug('[E2E] Waiting for daemon session to be ready...', { sessionId });
    await waitForDaemonSession(sessionId, 20_000);

    logger.debug('[E2E] beforeAll complete', { sessionId, sessionTag, encVariant });
  }, 60_000);

  afterAll(async () => {
    try {
      await stopDaemonSession(sessionId);
      await new Promise(r => setTimeout(r, 500));
    } catch {}

    if (!sessionDeleted) {
      try {
        await fetch(`${configuration.serverUrl}/v1/sessions/${sessionId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }

    appSocket?.disconnect();
  });

  // ──────────────────────────────────────────────────────────────────────────
  it(
    '完整消息生命周期：发送用户消息 → Claude 真实回复 → 验证轮次完整',
    { timeout: 110_000 },
    async () => {
      const traceId = randomUUID();
      const spanId = randomUUID();
      const localId = randomUUID();
      const wireTrace: WireTrace = { tid: traceId, sid: spanId };

      // Encrypt the message the same way the app does (sync.ts → encryptRawRecord).
      // meta mirrors app's sync.ts: permissionMode so daemon auto-approves tool calls,
      // model/fallbackModel/appendSystemPrompt null to signal "use defaults".
      const userMessage = buildUserMessageBody('say hello');
      const encryptedContent = encodeBase64(encrypt(encKey, encVariant, userMessage));

      // Send via v3 POST — mirrors app's flushOutbox in sync.ts including
      // X-Trace-Id / X-Span-Id headers so the server onRequest hook links this
      // HTTP request into the same trace (RFC §7.2).
      const sendRes = await fetch(
        `${configuration.serverUrl}/v3/sessions/${sessionId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Trace-Id': traceId,
            'X-Span-Id': spanId,
          },
          body: JSON.stringify({
            messages: [
              {
                content: encryptedContent,
                localId,
                _trace: wireTrace,
              },
            ],
          }),
        }
      );

      expect(sendRes.status).toBe(200);
      const sendResBody = await sendRes.json();
      expect(sendResBody.messages[0].localId).toBe(localId);
      console.log(`[E2E] MESSAGE SENT  traceId=${traceId}  spanId=${spanId}  localId=${localId}`);
      logger.debug('[E2E] User message sent', { traceId });

      // Wait for Daemon to finish the Claude turn — detect via first decryptable agent reply.
      // (activity.active=false is only emitted when the session fully terminates, not per-turn.)
      await waitForAgentReply(
        collectedUpdates,
        sessionId,
        encKey,
        encVariant,
        90_000
      );
      logger.debug('[E2E] Turn complete signal received (agent reply)');

      // Assert at least one agent reply arrived
      const agentUpdates = collectedUpdates.filter(u => {
        if (u.body?.t !== 'new-message' || u.body?.sid !== sessionId) return false;
        const encContent = u.body?.message?.content?.c;
        if (!encContent) return false;
        try {
          const dec = decrypt(encKey, encVariant, decodeBase64(encContent));
          return dec?.role === 'agent';
        } catch {
          return false;
        }
      });
      expect(agentUpdates.length).toBeGreaterThanOrEqual(1);

      // Decrypt the last agent reply and verify it has role=agent
      const lastAgentUpdate = agentUpdates[agentUpdates.length - 1];
      const encryptedMsgContent = lastAgentUpdate.body?.message?.content?.c;
      expect(encryptedMsgContent).toBeDefined();

      const decrypted = decrypt(encKey, encVariant, decodeBase64(encryptedMsgContent));
      expect(decrypted).toBeDefined();
      expect(decrypted?.role).toBe('agent');

      logger.debug('[E2E] Agent reply decrypted', {
        agentUpdateCount: agentUpdates.length,
        role: decrypted?.role,
      });

      // traceId propagation (best-effort — depends on server version)
      if (lastAgentUpdate._trace) {
        expect(lastAgentUpdate._trace.tid).toBe(traceId);
        logger.debug('[E2E] TraceId propagation verified', { tid: lastAgentUpdate._trace.tid });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  it('归档 session 后 App socket 收到 delete-session 事件', { timeout: 20_000 }, async () => {
    // Stop daemon FIRST so it doesn't try to POST messages after the session is deleted.
    // This avoids the 404 race: daemon mid-flight → POST /v3/.../messages → 404.
    logger.debug('[E2E] Stopping daemon before session delete', { sessionId });
    try {
      await stopDaemonSession(sessionId);
      // Wait for CLI to finish in-flight Claude result processing before deleting session.
      // 500ms is not enough when Claude response arrives right at SIGTERM time (race).
      await new Promise(r => setTimeout(r, 2000));
    } catch {}

    const deleteRes = await fetch(`${configuration.serverUrl}/v1/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    sessionDeleted = true;
    expect(deleteRes.status).toBe(200);
    expect((await deleteRes.json()).success).toBe(true);

    const deleteEvent = await waitForEvent(
      collectedUpdates,
      u => u.body?.t === 'delete-session' && u.body?.sid === sessionId,
      10_000,
      `delete-session for ${sessionId}`
    );
    expect(deleteEvent.body?.sid).toBe(sessionId);
    logger.debug('[E2E] delete-session event received');
  });
});
