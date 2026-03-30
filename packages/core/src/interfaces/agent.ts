/**
 * AgentBackend interface
 *
 * Universal interface for AI agent backends (Claude, Codex, Gemini, etc.)
 */

import type {
  AgentId,
  AgentTransport,
  McpServerConfig,
  AgentBackendConfig,
  AcpAgentConfig,
} from '../types/agent';
import type { ToolCallId, AgentMessage } from '../types/messages';

/**
 * A content block in an ACP prompt.
 * Structurally compatible with ContentBlock from @agentclientprotocol/sdk.
 * Defined locally to avoid cross-package type identity issues.
 */
export type PromptContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; text?: string; blob?: string; mimeType?: string } }
  | { type: 'resource_link'; uri: string; name?: string; mimeType?: string | null; [key: string]: unknown };

// Re-export types
export type { AgentId, AgentTransport, McpServerConfig, AgentBackendConfig, AcpAgentConfig };
export type { ToolCallId, AgentMessage };

/** Unique identifier for an agent session */
export type SessionId = string;

/** Result of starting a session */
export interface StartSessionResult {
  sessionId: SessionId;
}

/** Handler function type for agent messages */
export type AgentMessageHandler = (msg: AgentMessage) => void;

/** Agent backend factory type */
export type AgentBackendFactory = (config: AgentBackendConfig) => IAgentBackend;

/**
 * Universal interface for agent backends.
 */
export interface IAgentBackend {
  /**
   * Start a new agent session.
   */
  startSession(initialPrompt?: string): Promise<StartSessionResult>;

  /**
   * Send a prompt to an existing session.
   * Accepts a list of content blocks (text + optional resource_link for image attachments).
   * Optional `meta._meta` is injected into the ACP PromptRequest for W3C trace context.
   */
  sendPrompt(sessionId: SessionId, prompt: PromptContentBlock[], meta?: { _meta?: Record<string, unknown> }): Promise<void>;

  /**
   * Cancel the current operation in a session.
   */
  cancel(sessionId: SessionId): Promise<void>;

  /**
   * Register a handler for agent messages.
   */
  onMessage(handler: AgentMessageHandler): void;

  /**
   * Remove a previously registered message handler.
   */
  offMessage?(handler: AgentMessageHandler): void;

  /**
   * Respond to a permission request.
   */
  respondToPermission?(requestId: string, approved: boolean): Promise<void>;

  /**
   * Wait for the current response to complete.
   */
  waitForResponseComplete?(timeoutMs?: number): Promise<void>;

  /**
   * Return the StopReason from the last completed prompt turn.
   * ACP spec values: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled'
   */
  getLastStopReason?(): string | null;

  /**
   * Check if the agent supports session loading (resume).
   */
  supportsLoadSession?(): boolean;

  /**
   * Load an existing session to resume a previous conversation.
   */
  loadSession?(
    sessionId: string,
    cwd: string,
    mcpServers?: Array<{
      name: string;
      command: string;
      args?: string[];
    }>
  ): Promise<{ sessionId: string }>;

  /**
   * Clean up resources and close the backend.
   */
  dispose(): Promise<void>;
}

// ============================================================================
// Factory Registry
// ============================================================================

// Factory registry
const agentFactories = new Map<AgentId, AgentBackendFactory>();

/** Register an agent backend factory */
export function registerAgentFactory(type: AgentId, factory: AgentBackendFactory): void {
  agentFactories.set(type, factory);
}

/** Create an agent backend instance */
export function createAgent(type: AgentId, config: AgentBackendConfig): IAgentBackend {
  const factory = agentFactories.get(type);
  if (!factory) {
    throw new Error(
      `Agent factory not found: ${type}. Available: ${[...agentFactories.keys()].join(', ')}`
    );
  }
  return factory(config);
}

/** Check if an agent factory is registered */
export function hasAgentFactory(type: AgentId): boolean {
  return agentFactories.has(type);
}

/** Get list of registered agent types */
export function listAgentFactories(): AgentId[] {
  return Array.from(agentFactories.keys());
}

// ============================================================================
// Type Guards for AgentMessage
// ============================================================================

/** Type guard for model output messages */
export function isModelOutputMessage(
  msg: AgentMessage
): msg is { type: 'model-output'; textDelta?: string; fullText?: string } {
  return msg.type === 'model-output';
}

/** Type guard for status messages */
export function isStatusMessage(msg: AgentMessage): msg is {
  type: 'status';
  status: 'starting' | 'running' | 'idle' | 'stopped' | 'error';
  detail?: string;
} {
  return msg.type === 'status';
}

/** Type guard for tool call messages */
export function isToolCallMessage(msg: AgentMessage): msg is {
  type: 'tool-call';
  toolName: string;
  args: Record<string, unknown>;
  callId: ToolCallId;
} {
  return msg.type === 'tool-call';
}

/** Type guard for tool result messages */
export function isToolResultMessage(
  msg: AgentMessage
): msg is { type: 'tool-result'; toolName: string; result: unknown; callId: ToolCallId } {
  return msg.type === 'tool-result';
}

/** Type guard for permission request messages */
export function isPermissionRequestMessage(
  msg: AgentMessage
): msg is { type: 'permission-request'; id: string; reason: string; payload: unknown } {
  return msg.type === 'permission-request';
}

/** Type guard for permission response messages */
export function isPermissionResponseMessage(
  msg: AgentMessage
): msg is { type: 'permission-response'; id: string; approved: boolean } {
  return msg.type === 'permission-response';
}

/** Type guard for event messages */
export function isEventMessage(
  msg: AgentMessage
): msg is { type: 'event'; name: string; payload: unknown } {
  return msg.type === 'event';
}

/** Extract text content from a model output message */
export function getMessageText(msg: {
  type: 'model-output';
  textDelta?: string;
  fullText?: string;
}): string {
  return msg.textDelta ?? msg.fullText ?? '';
}
