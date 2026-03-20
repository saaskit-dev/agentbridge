/**
 * CursorBackend — ACP backend for Cursor Agent.
 *
 * Cursor Agent communicates via standard ACP JSON-RPC over stdio.
 * Key differences from other ACP agents:
 * - Cursor handles file system and terminal operations internally
 *   (does NOT use client-side readTextFile/writeTextFile/createTerminal)
 * - Only sends requestPermission for tool approval
 * - Auth via `cursor-agent login` (pre-authenticated, not in-protocol)
 * - Cursor does NOT support stdio MCP transport — only HTTP/SSE.
 *   We pass the Free MCP HTTP server URL directly instead of the stdio bridge.
 */

import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import type { AgentBackend as IAgentBackend, AgentMessage } from '@/agent';
import type { AgentStartOpts } from '@/daemon/sessions/AgentBackend';
import { DiscoveredAcpBackendBase } from '@/backends/acp/DiscoveredAcpBackendBase';
import { createCursorBackend } from '@/agent/factories/cursor';
import { mapCursorRawToNormalized } from './mapCursorRawToNormalized';

const logger = new Logger('backends/cursor/CursorBackend');

export class CursorBackend extends DiscoveredAcpBackendBase {
  readonly agentType = 'cursor' as const;

  constructor() {
    super(logger);
  }

  protected createAcpBackend(opts: AgentStartOpts): IAgentBackend {
    // Cursor only supports HTTP/SSE MCP, not stdio.
    // Pass the Free MCP server URL as an env var for cursor-agent to discover.
    const env: Record<string, string> = { ...opts.env };
    if (opts.mcpServerUrl) {
      env.FREE_MCP_SERVER_URL = opts.mcpServerUrl;
    }

    return createCursorBackend({
      cwd: opts.cwd,
      env,
      permissionHandler: this.getPermissionHandler() ?? undefined,
    });
  }

  protected mapRawMessage(msg: AgentMessage) {
    return mapCursorRawToNormalized(msg);
  }
}
