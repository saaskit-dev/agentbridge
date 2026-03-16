/**
 * Core types - re-export all types
 */

export type {
  PermissionMode,
  ModelMode,
  SessionMetadata,
  AgentState,
  EncryptionVariant,
  Session,
  SessionOptions,
  SessionUsage,
} from './session';

export type {
  MessageMeta,
  UserMessage,
  AgentMessageContent,
  MessageContent,
  SessionMessageContent,
  SessionMessage,
  MessageRole,
} from './message';

export type { MachineMetadata, DaemonState, Machine, GitStatus } from './machine';

export type {
  AgentId,
  AgentStatus,
  AgentTransport,
  McpServerConfig,
  AgentBackendConfig,
  AcpPermissionHandler,
  AcpAgentConfig,
} from './agent';

// Server capabilities
export type {
  ServerType,
  BasicCapabilities,
  EnhancedCapabilities,
  ServerCapabilities,
} from './capabilities';
export {
  DEFAULT_CAPABILITIES,
  hasCapability,
  supportsTextDelta,
  supportsThinkingDelta,
  getServerDescription,
} from './capabilities';
