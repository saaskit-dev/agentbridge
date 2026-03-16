import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { createClaudeAcpBackend } from '@saaskit-dev/agentbridge';
import type { AgentBackend as IAgentBackend, AgentMessage } from '@/agent';
import type { AgentStartOpts } from '@/daemon/sessions/AgentBackend';
import { DiscoveredAcpBackendBase } from '@/backends/acp/DiscoveredAcpBackendBase';
import { mapClaudeAcpRawToNormalized } from './mapClaudeAcpRawToNormalized';

const logger = new Logger('backends/claude-acp/ClaudeAcpBackend');

export class ClaudeAcpBackend extends DiscoveredAcpBackendBase {
  readonly agentType = 'claude-acp' as const;

  constructor() {
    super(logger);
  }

  protected createAcpBackend(opts: AgentStartOpts): IAgentBackend {
    return createClaudeAcpBackend({
      cwd: opts.cwd,
      env: opts.env,
      mcpServers: this.buildFreeMcpServers(opts),
      permissionHandler: this.getPermissionHandler() ?? undefined,
    });
  }

  protected mapRawMessage(msg: AgentMessage) {
    return mapClaudeAcpRawToNormalized(msg);
  }
}
