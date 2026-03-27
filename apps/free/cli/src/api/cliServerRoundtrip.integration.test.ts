import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configuration } from '@/configuration';
import type { Session, UpdateSessionBody } from '@/api/types';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';
import { readCredentials, type Credentials } from '@/persistence';
import {
  ensureLocalServerAndCredentials,
  stopSpawnedProcess,
} from '@/test-helpers/integrationEnvironment';
import { FakeAppClient } from '@/test-helpers/FakeAppClient';
import { FakeCliSessionClient } from '@/test-helpers/FakeCliSessionClient';

describe('CLI <-> Server roundtrip integration', { timeout: 45_000 }, () => {
  let serverProcess: import('node:child_process').ChildProcess | null = null;
  let appClient: FakeAppClient;
  let cliClient: FakeCliSessionClient;
  let session: Session;
  let sessionId: string;
  let token: string;

  beforeAll(async () => {
    await ensureLocalServerAndCredentials();

    const credentials = await readCredentials();
    if (!credentials) throw new Error('Missing test credentials');
    token = credentials.token;

    appClient = await FakeAppClient.create(credentials);
    await appClient.connectUserSocket();

    session = await appClient.createSession({
      id: randomUUID(),
    });
    sessionId = session.id;

    cliClient = await FakeCliSessionClient.create(credentials, session);
  });

  afterAll(async () => {
    await cliClient?.close();
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

    // Server is managed by globalSetup — no stopSpawnedProcess needed
  });

  it('delivers app user messages into the real CLI session client', async () => {
    const text = `cli-inbound-${randomUUID()}`;
    const { ack } = await appClient.sendUserTextMessage(session, text, {
      meta: {
        sentFrom: 'integration-test',
        permissionMode: 'read-only',
      },
    });
    expect(ack.ok).toBe(true);

    const message = await cliClient.waitForUserMessage(
      candidate => candidate.content.text === text,
      10_000,
      'app message delivered to cli'
    );

    expect(message.role).toBe('user');
    expect(message.meta?.sentFrom).toBe('integration-test');
  });

  it('persists cli agent output and broadcasts it back to the app substitute', async () => {
    const replyText = `cli-agent-reply-${randomUUID()}`;

    // Discard stale broadcasts from previous tests so waitForUpdate only matches fresh events.
    appClient.drainUpdates();

    cliClient.sendNormalizedMessage({
      id: `agent-${randomUUID()}`,
      createdAt: Date.now(),
      isSidechain: false,
      role: 'agent',
      content: [
        {
          type: 'text',
          text: replyText,
          uuid: randomUUID(),
          parentUUID: null,
        },
      ],
    });
    await cliClient.flush();

    const update = await appClient.waitForUpdate(
      event =>
        event.body?.t === 'new-message' &&
        event.body.sid === sessionId &&
        !!event.body.message?.content?.c,
      10_000,
      'cli agent reply broadcast'
    );

    if (update.body.t !== 'new-message') {
      throw new Error(`Expected new-message update, got ${update.body.t}`);
    }

    const decrypted = (await appClient.decryptSessionMessage(
      session,
      update.body.message as any
    )) as any;
    expect(decrypted?.content?.[0]?.text).toBe(replyText);
  });

  it('persists cli session updates for metadata, state, and capabilities', async () => {
    const nextMetadataVersion = session.metadataVersion + 1;
    const nextStateVersion = session.agentStateVersion + 1;
    const nextCapabilitiesVersion = (session.capabilitiesVersion ?? 0) + 1;
    const capabilities: SessionCapabilities = {
      commands: [
        {
          id: 'review-plan',
          name: '/review-plan',
          description: 'Review the active plan',
        },
      ],
      modes: {
        available: [{ id: 'plan', name: 'Plan' }],
        current: 'plan',
      },
    };

    cliClient.updateMetadata(metadata => ({
      ...metadata,
      summary: {
        text: 'CLI metadata update from integration test',
        updatedAt: Date.now(),
      },
    }));
    cliClient.updateAgentState(state => ({
      ...state,
      status: 'working',
      source: 'integration-test',
    }));
    cliClient.updateCapabilities(capabilities);

    const metadataUpdate = await appClient.waitForUpdate(
      event =>
        event.body?.t === 'update-session' &&
        event.body.id === sessionId &&
        event.body.metadata?.version === nextMetadataVersion,
      10_000,
      'metadata update broadcast'
    );
    const agentStateUpdate = await appClient.waitForUpdate(
      event =>
        event.body?.t === 'update-session' &&
        event.body.id === sessionId &&
        event.body.agentState?.version === nextStateVersion,
      10_000,
      'agent state update broadcast'
    );
    const capabilitiesUpdate = await appClient.waitForUpdate(
      event =>
        event.body?.t === 'update-session' &&
        event.body.id === sessionId &&
        event.body.capabilities?.version === nextCapabilitiesVersion,
      10_000,
      'capabilities update broadcast'
    );

    const decryptedMetadata = await appClient.decryptMetadata(
      session,
      metadataUpdate.body as UpdateSessionBody
    );
    const decryptedAgentState = (await appClient.decryptAgentState(
      session,
      agentStateUpdate.body as UpdateSessionBody
    )) as Record<string, unknown> | null;
    const decryptedCapabilities = await appClient.decryptCapabilities(
      session,
      capabilitiesUpdate.body as UpdateSessionBody
    );

    expect(decryptedMetadata?.summary?.text).toBe('CLI metadata update from integration test');
    expect(decryptedAgentState?.status).toBe('working');
    expect(decryptedAgentState?.source).toBe('integration-test');
    expect(decryptedCapabilities).toEqual(capabilities);

    session.metadataVersion = nextMetadataVersion;
    session.agentStateVersion = nextStateVersion;
    session.capabilitiesVersion = nextCapabilitiesVersion;
    session.metadata = decryptedMetadata ?? session.metadata;
    session.agentState = decryptedAgentState ?? session.agentState;
    session.capabilities = decryptedCapabilities;
  });

  it('messages sent to session A do not appear in session B', async () => {
    // 1. Create two fresh sessions (A and B)
    const sessionA = await appClient.createSession({ id: randomUUID() });
    const sessionB = await appClient.createSession({ id: randomUUID() });

    // 2. Create CLI clients for each session
    const cliA = await FakeCliSessionClient.create(
      { token } as Credentials,
      sessionA
    );
    const cliB = await FakeCliSessionClient.create(
      { token } as Credentials,
      sessionB
    );

    try {
      // 3. Send a message to session A
      const textA = `isolation-A-${randomUUID()}`;
      appClient.drainUpdates();

      cliA.sendNormalizedMessage({
        id: `agent-${randomUUID()}`,
        createdAt: Date.now(),
        isSidechain: false,
        role: 'agent',
        content: [
          {
            type: 'text',
            text: textA,
            uuid: randomUUID(),
            parentUUID: null,
          },
        ],
      });
      await cliA.flush();

      // 4. Wait for the broadcast confirming session A received the message
      await appClient.waitForUpdate(
        event =>
          event.body?.t === 'new-message' &&
          event.body.sid === sessionA.id &&
          !!event.body.message?.content?.c,
        10_000,
        'session A agent message broadcast'
      );

      // 5. Fetch messages for session B — should be empty
      const sessionBMessages1 = await appClient.fetchMessages(sessionB);
      expect(sessionBMessages1.messages).toHaveLength(0);

      // 6. Send a message to session B
      const textB = `isolation-B-${randomUUID()}`;
      appClient.drainUpdates();

      cliB.sendNormalizedMessage({
        id: `agent-${randomUUID()}`,
        createdAt: Date.now(),
        isSidechain: false,
        role: 'agent',
        content: [
          {
            type: 'text',
            text: textB,
            uuid: randomUUID(),
            parentUUID: null,
          },
        ],
      });
      await cliB.flush();

      await appClient.waitForUpdate(
        event =>
          event.body?.t === 'new-message' &&
          event.body.sid === sessionB.id &&
          !!event.body.message?.content?.c,
        10_000,
        'session B agent message broadcast'
      );

      // 7. Fetch messages for session A — should only have the first message
      const sessionAMessages = await appClient.fetchMessages(sessionA);
      expect(sessionAMessages.messages).toHaveLength(1);
      const decryptedA = (await appClient.decryptSessionMessage(
        sessionA,
        sessionAMessages.messages[0]
      )) as any;
      expect(decryptedA?.content?.[0]?.text).toBe(textA);

      // 8. Fetch messages for session B — should only have the second message
      const sessionBMessages2 = await appClient.fetchMessages(sessionB);
      expect(sessionBMessages2.messages).toHaveLength(1);
      const decryptedB = (await appClient.decryptSessionMessage(
        sessionB,
        sessionBMessages2.messages[0]
      )) as any;
      expect(decryptedB?.content?.[0]?.text).toBe(textB);
    } finally {
      // Clean up the two extra sessions and clients
      await cliA.close();
      await cliB.close();

      for (const s of [sessionA, sessionB]) {
        try {
          await fetch(`${configuration.serverUrl}/v1/sessions/${s.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch {
          // ignore cleanup failures
        }
      }
    }
  });
});
