import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { io, type Socket } from 'socket.io-client';
import { ApiClient } from '@/api/api';
import {
  decryptFromWireString,
  encryptToWireString,
} from '@/api/encryption';
import type {
  Metadata,
  Session,
  Update,
  UserMessage,
  SessionMessage,
  UpdateSessionBody,
  AgentState,
} from '@/api/types';
import { configuration } from '@/configuration';
import type { Credentials } from '@/persistence';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';

type V3SessionMessage = SessionMessage & {
  traceId?: string;
};

type V3GetSessionMessagesResponse = {
  messages: V3SessionMessage[];
  hasMore: boolean;
};

function defaultSessionMetadata(): Metadata {
  return {
    path: '/tmp',
    host: os.hostname(),
    homeDir: os.homedir(),
    freeHomeDir: configuration.freeHomeDir,
    freeLibDir: process.cwd(),
    freeToolsDir: process.cwd(),
    startedBy: 'cli',
  };
}

export class FakeAppClient {
  static async create(credentials: Credentials): Promise<FakeAppClient> {
    const api = await ApiClient.create(credentials);
    return new FakeAppClient(credentials, api);
  }

  private readonly credentials: Credentials;
  private readonly api: ApiClient;
  private userSocket: Socket | null = null;
  private readonly updates: Update[] = [];

  private constructor(credentials: Credentials, api: ApiClient) {
    this.credentials = credentials;
    this.api = api;
  }

  get token(): string {
    return this.credentials.token;
  }

  get receivedUpdates(): Update[] {
    return this.updates;
  }

  async createSession(opts?: {
    id?: string;
    metadata?: Metadata;
    state?: Session['agentState'];
  }): Promise<Session> {
    const session = await this.api.getOrCreateSession({
      id: opts?.id ?? randomUUID(),
      metadata: opts?.metadata ?? defaultSessionMetadata(),
      state: opts?.state ?? null,
    });

    if (!session) {
      throw new Error('Failed to create fake app session');
    }

    return session;
  }

  async connectUserSocket(): Promise<void> {
    if (this.userSocket?.connected) return;

    const socket = io(configuration.serverUrl, {
      path: '/v1/updates',
      auth: {
        token: this.credentials.token,
        clientType: 'user-scoped',
      },
      transports: ['websocket'],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error) =>
        reject(new Error(`FakeAppClient user socket connect failed: ${error.message}`))
      );
    });

    socket.on('update', (data) => {
      this.updates.push(data);
    });

    this.userSocket = socket;
  }

  async disconnect(): Promise<void> {
    this.userSocket?.disconnect();
    this.userSocket = null;
    this.updates.length = 0;
  }

  async sendUserTextMessage(
    session: Session,
    text: string,
    opts?: {
      id?: string;
      meta?: UserMessage['meta'];
    }
  ): Promise<{ id: string; ack: { ok: boolean; messages?: any[]; error?: string } }> {
    if (!this.userSocket?.connected) {
      throw new Error('FakeAppClient user socket not connected');
    }
    const id = opts?.id ?? `fake-app-msg-${randomUUID()}`;
    const payload: UserMessage = {
      role: 'user',
      content: { type: 'text', text },
      ...(opts?.meta ? { meta: opts.meta } : {}),
    };
    const encryptedContent = await encryptToWireString(
      session.encryptionKey, session.encryptionVariant, payload
    );

    const ack = await this.userSocket.timeout(30000).emitWithAck('send-messages', {
      sessionId: session.id,
      messages: [{ id, content: encryptedContent }],
    });

    return { id, ack };
  }

  async fetchMessages(
    session: Session,
    opts?: { afterSeq?: number; limit?: number }
  ): Promise<V3GetSessionMessagesResponse> {
    if (!this.userSocket?.connected) {
      throw new Error('FakeAppClient user socket not connected');
    }

    const ack = await this.userSocket.timeout(30000).emitWithAck('fetch-messages', {
      sessionId: session.id,
      after_seq: opts?.afterSeq ?? 0,
      limit: opts?.limit ?? 100,
    });

    if (!ack.ok) {
      throw new Error(`Failed to fetch session messages: ${ack.error}`);
    }

    return { messages: ack.messages ?? [], hasMore: ack.hasMore ?? false };
  }

  async decryptSessionMessage(session: Session, message: SessionMessage): Promise<unknown> {
    return decryptFromWireString(
      session.encryptionKey,
      session.encryptionVariant,
      message.content.c
    );
  }

  async decryptCapabilities(
    session: Session,
    body: UpdateSessionBody
  ): Promise<SessionCapabilities | null> {
    if (!body.capabilities?.value) {
      return null;
    }

    return await decryptFromWireString(
      session.encryptionKey,
      session.encryptionVariant,
      body.capabilities.value
    ) as SessionCapabilities | null;
  }

  async decryptMetadata(session: Session, body: UpdateSessionBody): Promise<Metadata | null> {
    if (!body.metadata?.value) {
      return null;
    }

    return await decryptFromWireString(
      session.encryptionKey,
      session.encryptionVariant,
      body.metadata.value
    ) as Metadata | null;
  }

  async decryptAgentState(session: Session, body: UpdateSessionBody): Promise<AgentState | null> {
    if (!body.agentState?.value) {
      return null;
    }

    return await decryptFromWireString(
      session.encryptionKey,
      session.encryptionVariant,
      body.agentState.value
    ) as AgentState | null;
  }

  /** Discard all accumulated updates so subsequent waitForUpdate calls only see fresh events. */
  drainUpdates(): void {
    this.updates.length = 0;
  }

  async waitForUpdate(
    predicate: (update: Update) => boolean,
    timeoutMs: number,
    description: string
  ): Promise<Update> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const idx = this.updates.findIndex(predicate);
      if (idx !== -1) {
        const [match] = this.updates.splice(idx, 1);
        return match;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`FakeAppClient waitForUpdate timeout (${timeoutMs}ms): ${description}`);
  }
}
