import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import type { AgentBackend as IAgentBackend, AgentMessage } from '@/agent';
import type { AgentStartOpts } from '@/daemon/sessions/AgentBackend';
import { createGeminiBackend } from '@/agent/factories/gemini';
import { DiscoveredAcpBackendBase } from '@/backends/acp/DiscoveredAcpBackendBase';
import { mapAcpMessageToNormalized } from '@/backends/acp/mapAcpMessageToNormalized';

const logger = new Logger('backends/gemini/GeminiBackend');

export class GeminiBackend extends DiscoveredAcpBackendBase {
  readonly agentType = 'gemini' as const;

  constructor() {
    super(logger);
  }

  protected createAcpBackend(opts: AgentStartOpts): IAgentBackend {
    const { backend } = createGeminiBackend({
      cwd: opts.cwd,
      env: opts.env,
      mcpServers: this.buildFreeMcpServers(opts),
      model: null,
      permissionHandler: this.getPermissionHandler() ?? undefined,
    });

    return backend;
  }

  protected mapRawMessage(msg: AgentMessage) {
    return mapAcpMessageToNormalized(msg);
  }
}
