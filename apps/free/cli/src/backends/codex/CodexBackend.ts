import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { createCodexBackend } from '@saaskit-dev/agentbridge';
import type { AgentBackend as IAgentBackend, AgentMessage } from '@/agent';
import type { AgentStartOpts } from '@/daemon/sessions/AgentBackend';
import { DiscoveredAcpBackendBase } from '@/backends/acp/DiscoveredAcpBackendBase';
import { mapAcpMessageToNormalized } from '@/backends/acp/mapAcpMessageToNormalized';

const logger = new Logger('backends/codex/CodexBackend');

export class CodexBackend extends DiscoveredAcpBackendBase {
  readonly agentType = 'codex' as const;

  constructor() {
    super(logger);
  }

  protected createAcpBackend(opts: AgentStartOpts): IAgentBackend {
    return createCodexBackend({
      cwd: opts.cwd,
      env: opts.env,
      mcpServers: this.buildFreeMcpServers(opts),
      permissionHandler: this.getPermissionHandler() ?? undefined,
    });
  }

  protected mapRawMessage(msg: AgentMessage) {
    return mapAcpMessageToNormalized(msg);
  }
}
