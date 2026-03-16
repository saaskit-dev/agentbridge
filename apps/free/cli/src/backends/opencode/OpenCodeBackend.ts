import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { createOpenCodeBackend } from '@saaskit-dev/agentbridge';
import type { AgentBackend as IAgentBackend, AgentMessage } from '@/agent';
import type { AgentStartOpts } from '@/daemon/sessions/AgentBackend';
import { DiscoveredAcpBackendBase } from '@/backends/acp/DiscoveredAcpBackendBase';
import { mapOpenCodeRawToNormalized } from './mapOpenCodeRawToNormalized';

const logger = new Logger('backends/opencode/OpenCodeBackend');

export class OpenCodeBackend extends DiscoveredAcpBackendBase {
  readonly agentType = 'opencode' as const;

  constructor() {
    super(logger);
  }

  protected createAcpBackend(opts: AgentStartOpts): IAgentBackend {
    return createOpenCodeBackend({
      cwd: opts.cwd,
      env: opts.env,
      mcpServers: this.buildFreeMcpServers(opts),
      permissionHandler: this.getPermissionHandler() ?? undefined,
    });
  }

  protected mapRawMessage(msg: AgentMessage) {
    return mapOpenCodeRawToNormalized(msg);
  }
}
