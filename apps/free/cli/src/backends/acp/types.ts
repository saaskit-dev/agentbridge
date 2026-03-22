import type { NewSessionResponse, SessionUpdate } from '@agentclientprotocol/sdk';
import type { AgentBackend as IAgentBackend } from '@/agent';

export interface CapabilityAwareAcpBackend extends IAgentBackend {
  onSessionStarted?(handler: (response: NewSessionResponse) => void): void;
  onSessionUpdate?(handler: (update: SessionUpdate) => void): void;
  setSessionMode?(sessionId: string, modeId: string): Promise<unknown>;
  setSessionModel?(sessionId: string, modelId: string): Promise<unknown>;
  setSessionConfigOption?(
    sessionId: string,
    optionId: string,
    value: string
  ): Promise<{
    configOptions?: NewSessionResponse['configOptions'];
  }>;
  supportsLoadSession?(): boolean;
  loadSession?(
    sessionId: string,
    cwd: string,
    mcpServers?: Array<{
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }>
  ): Promise<{ sessionId: string }>;
}
