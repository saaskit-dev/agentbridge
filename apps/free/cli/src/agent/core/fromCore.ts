/**
 * fromCore.ts - Re-exports types from @agentbridge/core
 *
 * This file provides a migration path from free's local types to the core package.
 * During migration, files can import from './fromCore' instead of local definitions.
 * Once all imports are migrated, the local type files can be removed.
 *
 * @module fromCore
 */

// ============================================================================
// Core Types - Re-exported from @agentbridge/core
// ============================================================================

// Basic identifiers - import for local use then re-export
import type { SessionId as SessionIdType, ToolCallId as ToolCallIdType } from '@agentbridge/core';
export type { SessionId, ToolCallId } from '@agentbridge/core';

// Agent configuration types
export type {
  AgentId,
  AgentTransport,
  McpServerConfig,
  AgentBackendConfig,
  AcpAgentConfig,
} from '@agentbridge/core';

// Agent backend interface
export type {
  IAgentBackend,
  AgentMessage,
  StartSessionResult,
  AgentMessageHandler,
  AgentBackendFactory,
} from '@agentbridge/core';

// Transport handler interface
export type {
  ITransportHandler,
  StderrContext,
  StderrResult,
  ToolPattern,
  ToolNameContext,
  TransportHandlerFactory,
} from '@agentbridge/core';

// Type guards
export {
  isModelOutputMessage,
  isStatusMessage,
  isToolCallMessage,
  isToolResultMessage,
  isPermissionRequestMessage,
  isPermissionResponseMessage,
  isEventMessage,
  getMessageText,
} from '@agentbridge/core';

// Factory functions
export { registerAgentFactory, createAgent, hasAgentFactory, listAgentFactories } from '@agentbridge/core';
export { registerTransportHandler, createTransportHandler, hasTransportHandler } from '@agentbridge/core';

// Transport implementations (base class only - GeminiTransport is free-specific)
export { DefaultTransport, defaultTransport } from '@agentbridge/core';

// ============================================================================
// Free-specific Types - Kept locally until core has them
// ============================================================================

/**
 * Agent status values
 * TODO: Consider moving to core if generally useful
 */
export type AgentStatus = 'starting' | 'running' | 'idle' | 'stopped' | 'error';

/**
 * Named message type interfaces for convenience
 * These are extracted from AgentMessage union for easier typing
 */

export interface ModelOutputMessage {
  type: 'model-output';
  textDelta?: string;
  fullText?: string;
}

export interface StatusMessage {
  type: 'status';
  status: AgentStatus;
  detail?: string;
}

export interface ToolCallMessage {
  type: 'tool-call';
  toolName: string;
  args: Record<string, unknown>;
  callId: ToolCallIdType;
}

export interface ToolResultMessage {
  type: 'tool-result';
  toolName: string;
  result: unknown;
  callId: ToolCallIdType;
}

export interface PermissionRequestMessage {
  type: 'permission-request';
  id: string;
  reason: string;
  payload: unknown;
}

export interface PermissionResponseMessage {
  type: 'permission-response';
  id: string;
  approved: boolean;
}

export interface FsEditMessage {
  type: 'fs-edit';
  description: string;
  diff?: string;
  path?: string;
}

export interface TerminalOutputMessage {
  type: 'terminal-output';
  data: string;
}

export interface EventMessage {
  type: 'event';
  name: string;
  payload: unknown;
}

export interface TokenCountMessage {
  type: 'token-count';
  [key: string]: unknown;
}

export interface ExecApprovalRequestMessage {
  type: 'exec-approval-request';
  call_id: string;
  [key: string]: unknown;
}

export interface PatchApplyBeginMessage {
  type: 'patch-apply-begin';
  call_id: string;
  auto_approved?: boolean;
  changes: Record<string, unknown>;
}

export interface PatchApplyEndMessage {
  type: 'patch-apply-end';
  call_id: string;
  stdout?: string;
  stderr?: string;
  success: boolean;
}

// ============================================================================
// Type Aliases for Backward Compatibility
// ============================================================================

/**
 * Backward compatibility: Alias IAgentBackend to AgentBackend
 * This allows existing code to continue using 'AgentBackend' type name
 */
export type AgentBackend = import('@agentbridge/core').IAgentBackend;
