import type { Credentials } from '@/persistence';
import { ApiSessionClient } from '@/api/apiSession';
import type { Session, UserMessage, Metadata, AgentState } from '@/api/types';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';
import type { NormalizedMessage } from '@/daemon/sessions/types';

export class FakeCliSessionClient {
  static async create(credentials: Credentials, session: Session): Promise<FakeCliSessionClient> {
    const client = new ApiSessionClient(credentials.token, session);
    return new FakeCliSessionClient(client);
  }

  private readonly client: ApiSessionClient;
  private readonly userMessages: UserMessage[] = [];
  private readonly inboundMessages: unknown[] = [];

  private constructor(client: ApiSessionClient) {
    this.client = client;
    this.client.onUserMessage(message => {
      this.userMessages.push(message);
    });
    this.client.on('message', message => {
      this.inboundMessages.push(message);
    });
  }

  async waitForUserMessage(
    predicate: (message: UserMessage) => boolean,
    timeoutMs: number,
    description: string
  ): Promise<UserMessage> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const match = this.userMessages.find(predicate);
      if (match) return match;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(
      `FakeCliSessionClient waitForUserMessage timeout (${timeoutMs}ms): ${description}`
    );
  }

  async waitForInboundMessage(
    predicate: (message: unknown) => boolean,
    timeoutMs: number,
    description: string
  ): Promise<unknown> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const match = this.inboundMessages.find(predicate);
      if (match) return match;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(
      `FakeCliSessionClient waitForInboundMessage timeout (${timeoutMs}ms): ${description}`
    );
  }

  async sendNormalizedMessage(
    message: Pick<NormalizedMessage, 'role' | 'content'> & Partial<NormalizedMessage>
  ): Promise<string> {
    return this.client.sendNormalizedMessage(message);
  }

  updateMetadata(handler: (metadata: Metadata) => Metadata): void {
    this.client.updateMetadata(handler);
  }

  updateAgentState(handler: (state: AgentState) => AgentState): void {
    this.client.updateAgentState(handler);
  }

  updateCapabilities(capabilities: SessionCapabilities | null): void {
    this.client.updateCapabilities(capabilities);
  }

  keepAlive(thinking: boolean, mode: 'local' | 'remote'): void {
    this.client.keepAlive(thinking, mode);
  }

  async flush(): Promise<void> {
    await this.client.flush();
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
