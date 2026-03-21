import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { createClaudeBackend } from '@saaskit-dev/agentbridge';
import type { AgentBackend as IAgentBackend, AgentMessage } from '@/agent';
import type { AgentStartOpts } from '@/daemon/sessions/AgentBackend';
import { DiscoveredAcpBackendBase } from '@/backends/acp/DiscoveredAcpBackendBase';
import { mapClaudeRawToNormalized } from './mapClaudeRawToNormalized';

const logger = new Logger('backends/claude/ClaudeBackend');

export class ClaudeBackend extends DiscoveredAcpBackendBase {
  readonly agentType = 'claude' as const;

  constructor() {
    super(logger);
  }

  protected createAcpBackend(opts: AgentStartOpts): IAgentBackend {
    return createClaudeBackend({
      cwd: opts.cwd,
      env: opts.env,
      mcpServers: this.buildFreeMcpServers(opts),
      permissionHandler: this.getPermissionHandler() ?? undefined,
    });
  }

  protected mapRawMessage(msg: AgentMessage) {
    return mapClaudeRawToNormalized(msg);
  }
}
