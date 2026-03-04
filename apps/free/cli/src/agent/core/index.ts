/**
 * Core Agent Types and Interfaces
 *
 * Re-exports all core agent abstractions.
 * Types are now sourced from @agentbridge/core via ./fromCore
 *
 * @module core
 */

// ============================================================================
// Core Types - Re-exported from @agentbridge/core via fromCore
// ============================================================================

// Basic identifiers
export type { SessionId, ToolCallId } from './fromCore';

// Agent configuration types
export type {
  AgentId,
  AgentTransport,
  McpServerConfig,
  AgentBackendConfig,
  AcpAgentConfig,
} from './fromCore';

// Agent backend interface (backward compatible alias)
export type {
  AgentBackend,
  IAgentBackend,
  AgentMessage,
  StartSessionResult,
  AgentMessageHandler,
  AgentBackendFactory,
} from './fromCore';

// Transport handler interface
export type {
  ITransportHandler,
  StderrContext,
  StderrResult,
  ToolPattern,
  ToolNameContext,
  TransportHandlerFactory,
} from './fromCore';

// Detailed message types (free-specific convenience interfaces)
export type {
  AgentStatus,
  ModelOutputMessage,
  StatusMessage,
  ToolCallMessage,
  ToolResultMessage,
  PermissionRequestMessage,
  PermissionResponseMessage,
  FsEditMessage,
  TerminalOutputMessage,
  EventMessage,
  TokenCountMessage,
  ExecApprovalRequestMessage,
  PatchApplyBeginMessage,
  PatchApplyEndMessage,
} from './fromCore';

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
} from './fromCore';

// Factory functions from core
export {
  registerAgentFactory,
  createAgent,
  hasAgentFactory,
  listAgentFactories,
  registerTransportHandler,
  createTransportHandler,
  hasTransportHandler,
  // Transport classes (base)
  DefaultTransport,
  defaultTransport,
} from './fromCore';

// Free-specific transport (uses free__ prefix)
export { GeminiTransport, geminiTransport } from '../transport';

// ============================================================================
// AgentRegistry - Free-specific factory registry
// ============================================================================

export { AgentRegistry, agentRegistry } from './AgentRegistry';

export type { AgentFactory, AgentFactoryOptions } from './AgentRegistry';
