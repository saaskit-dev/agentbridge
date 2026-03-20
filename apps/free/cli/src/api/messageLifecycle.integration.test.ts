/**
 * Self-contained integration test for the message lifecycle:
 *   test client -> server HTTP -> server socket fanout -> test session client
 *
 * This intentionally does not depend on a real daemon or a real model provider.
 * It validates the transport and encryption path end-to-end using the same
 * session/auth primitives as the CLI.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import {
  decryptFromWireString,
  encryptToWireString,
} from '@/api/encryption';
import { configuration } from '@/configuration';
import { readCredentials } from '@/persistence';
import type { Session, UpdateSessionBody } from '@/api/types';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import {
  ensureLocalServerAndCredentials,
  stopSpawnedProcess,
} from '@/test-helpers/integrationEnvironment';
import { FakeAppClient } from '@/test-helpers/FakeAppClient';

const logger = new Logger('api/messageLifecycle.integration.test');

function waitForEvent<T>(
  events: T[],
  predicate: (event: T) => boolean,
  timeoutMs: number,
  description: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const idx = events.findIndex(predicate);
      if (idx !== -1) {
        const [match] = events.splice(idx, 1);
        resolve(match);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`waitForEvent timeout (${timeoutMs}ms): ${description}`));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

describe('Message Lifecycle Integration', { timeout: 45_000 }, () => {
  let serverProcess: import('node:child_process').ChildProcess | null = null;
  let appClient: FakeAppClient;
  let session: Session;
  let sessionId: string;
  let token: string;
  let encKey: Uint8Array;
  let encVariant: 'legacy' | 'dataKey';
  let userSocket: Socket;
  let sessionSocket: Socket;
  const userUpdates: any[] = [];
  const sessionUpdates: any[] = [];

  beforeAll(async () => {
    await ensureLocalServerAndCredentials();

    const creds = await readCredentials();
    if (!creds) throw new Error('Missing test credentials');
    token = creds.token;

    appClient = await FakeAppClient.create(creds);
    await appClient.connectUserSocket();

    session = await appClient.createSession({
      id: randomUUID(),
    });

    sessionId = session.id;
    encKey = session.encryptionKey;
    encVariant = session.encryptionVariant;

    userSocket = io(configuration.serverUrl, {
      path: '/v1/updates',
      auth: {
        token,
        clientType: 'user-scoped',
      },
      transports: ['websocket'],
      reconnection: false,
    });

    sessionSocket = io(configuration.serverUrl, {
      path: '/v1/updates',
      auth: {
        token,
        clientType: 'session-scoped',
        sessionId,
      },
      transports: ['websocket'],
      reconnection: false,
    });

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        userSocket.on('connect', resolve);
        userSocket.on('connect_error', (error) =>
          reject(new Error(`user socket connect failed: ${error.message}`))
        );
      }),
      new Promise<void>((resolve, reject) => {
        sessionSocket.on('connect', resolve);
        sessionSocket.on('connect_error', (error) =>
          reject(new Error(`session socket connect failed: ${error.message}`))
        );
      }),
    ]);

    userSocket.on('update', (data) => {
      userUpdates.push(data);
    });
    sessionSocket.on('update', (data) => {
      sessionUpdates.push(data);
    });

    logger.info('[integration] sockets connected', { sessionId });
  }, 30_000);

  afterAll(async () => {
    userSocket?.disconnect();
    sessionSocket?.disconnect();
    await appClient?.disconnect();
    if (sessionId) {
      try {
        await fetch(`${configuration.serverUrl}/v1/sessions/${sessionId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {
        // ignore cleanup failures
      }
    }
  });

  it('broadcasts encrypted user and agent messages to both user-scoped and session-scoped sockets', async () => {
    const userMessage = {
      role: 'user',
      content: { type: 'text', text: 'say hello from integration test' },
      meta: {
        sentFrom: 'test',
        permissionMode: 'read-only' as const,
      },
    };
    const userLocalId = `user-${randomUUID()}`;
    const { response: userResponse } = await appClient.sendUserTextMessage(
      session,
      userMessage.content.text,
      {
        id: userLocalId,
        meta: userMessage.meta,
      }
    );

    expect(userResponse.status).toBe(200);

    await waitForEvent(
      userUpdates,
      (event) => event.body?.t === 'new-message' && event.body?.sid === sessionId,
      10_000,
      'user-scoped new-message'
    );
    await waitForEvent(
      sessionUpdates,
      (event) => event.body?.t === 'new-message' && event.body?.sid === sessionId,
      10_000,
      'session-scoped new-message'
    );

    const agentLocalId = `agent-${randomUUID()}`;
    const agentMessage = {
      role: 'agent',
      content: [{ type: 'text', text: 'hello from fake agent' }],
    };
    const encryptedAgentContent = await encryptToWireString(encKey, encVariant, agentMessage);

    const agentResponse = await fetch(
      `${configuration.serverUrl}/v3/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ id: agentLocalId, content: encryptedAgentContent }],
        }),
      }
    );

    expect(agentResponse.status).toBe(200);

    const agentUpdate = await waitForEvent(
      userUpdates,
      (event) =>
        event.body?.t === 'new-message' &&
        event.body?.sid === sessionId &&
        !!event.body?.message?.content?.c,
      10_000,
      'agent reply new-message'
    );

    const decryptedAgent = await decryptFromWireString(
      encKey,
      encVariant,
      agentUpdate.body.message.content.c
    );
    expect(decryptedAgent?.role).toBe('agent');
    expect(decryptedAgent?.content?.[0]?.text).toBe('hello from fake agent');
  });

  it('fetches and decrypts persisted messages via FakeAppClient', async () => {
    const text = `persisted-message-${randomUUID()}`;
    const { response } = await appClient.sendUserTextMessage(session, text);
    expect(response.status).toBe(200);

    const fetched = await appClient.fetchMessages(session);
    let persisted: unknown = undefined;
    for (const message of fetched.messages) {
      const decryptedMessage = await appClient.decryptSessionMessage(session, message) as any;
      if (decryptedMessage?.role === 'user' && decryptedMessage?.content?.text === text) {
        persisted = message;
        break;
      }
    }

    expect(persisted).toBeDefined();
  });

  it('persists and broadcasts capability updates without relying on the app UI', async () => {
    const cliSocket = io(configuration.serverUrl, {
      path: '/v1/updates',
      auth: {
        token,
        clientType: 'session-scoped',
        sessionId,
      },
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      cliSocket.once('connect', () => resolve());
      cliSocket.once('connect_error', (error) =>
        reject(new Error(`cli socket connect failed: ${error.message}`))
      );
    });

    const capabilities: SessionCapabilities = {
      models: {
        available: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }],
        current: 'claude-sonnet-4-5',
      },
      modes: {
        available: [{ id: 'default', name: 'Default' }],
        current: 'default',
      },
      commands: [
        { id: 'explain', name: '/explain', description: 'Explain current plan' },
      ],
    };

    const encryptedCapabilities = await encryptToWireString(
      session.encryptionKey,
      session.encryptionVariant,
      capabilities
    );

    const ack = await cliSocket.emitWithAck('update-capabilities', {
      sid: sessionId,
      expectedVersion: session.capabilitiesVersion ?? 0,
      capabilities: encryptedCapabilities,
    });

    expect(ack).toEqual({
      result: 'success',
      version: (session.capabilitiesVersion ?? 0) + 1,
      capabilities: encryptedCapabilities,
    });

    const update = await appClient.waitForUpdate(
      (event) =>
        event.body?.t === 'update-session' &&
        (event.body as any)?.id === sessionId &&
        (event.body as any)?.capabilities?.version === (session.capabilitiesVersion ?? 0) + 1,
      10_000,
      'capabilities update broadcast'
    );

    expect(update.body.t).toBe('update-session');
    const decryptedCapabilities = await appClient.decryptCapabilities(
      session,
      update.body as UpdateSessionBody
    );
    expect(decryptedCapabilities).toEqual(capabilities);

    session.capabilitiesVersion = (session.capabilitiesVersion ?? 0) + 1;
    session.capabilities = decryptedCapabilities;
    cliSocket.disconnect();
  });

  it('emits delete-session to user-scoped sockets when the session is deleted', async () => {
    const response = await fetch(`${configuration.serverUrl}/v1/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);

    const deleteEvent = await waitForEvent(
      userUpdates,
      (event) => event.body?.t === 'delete-session' && event.body?.sid === sessionId,
      10_000,
      'delete-session update'
    );
    expect(deleteEvent.body?.sid).toBe(sessionId);

    sessionId = '';
  });
});
