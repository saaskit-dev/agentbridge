/**
 * Agent types - unified implementation
 */
/** Agent identifier */
export type AgentId =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'opencode'
  | 'claude-acp'
  | 'codex-acp';

/** Agent status values */
export type AgentStatus = 'starting' | 'running' | 'idle' | 'stopped' | 'error';

/** Transport type for agent communication */
export type AgentTransport =
  | 'native-claude'
  | 'mcp-codex'
  | 'acp';

/** MCP server configuration */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Agent backend configuration */
export interface AgentBackendConfig {
  cwd: string;
  agentName: AgentId;
  transport: AgentTransport;
  env?: Record<string, string>;
  mcpServers?: Record<string, McpServerConfig>;
}

/** Permission handler result for tool approval */
export interface PermissionResult {
  decision: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

/** Permission handler interface for ACP backends */
export interface AcpPermissionHandler {
  /**
   * Handle a tool permission request
   * @param toolCallId - The unique ID of the tool call
   * @param toolName - The name of the tool being called
   * @param input - The input parameters for the tool
   * @returns Promise resolving to permission result with decision
   */
  handleToolCall(
    toolCallId: string,
    toolName: string,
    input: unknown
  ): Promise<PermissionResult>;
}

/** ACP-specific agent configuration */
export interface AcpAgentConfig extends AgentBackendConfig {
  transport: 'acp';
  command: string;
  args?: string[];
  /** Optional permission handler for tool approval */
  permissionHandler?: AcpPermissionHandler;
  /** Optional transport handler for agent-specific behavior (timeouts, filtering, etc.) */
  transportHandler?: import('../interfaces/transport').ITransportHandler;
  /** Optional callback to check if prompt has change_title instruction */
  hasChangeTitleInstruction?: (prompt: string) => boolean;
}
