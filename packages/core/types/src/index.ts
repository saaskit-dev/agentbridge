/**
 * @agentbridge/types
 * Pure type definitions - zero dependencies
 */

// Permission types
export type {
  PermissionMode,
  ProtocolPermissionMode,
  PermissionRequest,
  PermissionResponse,
  PermissionDecision,
  PermissionResult,
} from './permission';
export { toPermissionMode, toProtocolPermissionMode } from './permission';

// Session types
export type {
  SessionMetadata,
  AgentPermissionRequest,
  CompletedPermissionRequest,
  AgentState,
  SessionOptions,
  Session,
  SessionWithMessages,
} from './session';

// Machine types
export type {
  MachineMetadata,
  DaemonStatus,
  DaemonState,
  Machine,
  // Legacy aliases
  Device,
  DeviceMetadata,
} from './machine';

// Message types
export type {
  ToolPermission,
  ToolCall,
  AgentEvent,
  MessageMeta,
  BaseMessage,
  UserTextMessage,
  AgentTextMessage,
  ToolCallMessage,
  AgentEventMessage,
  Message,
  TodoItem,
  UsageData,
} from './message';
export {
  isUserTextMessage,
  isAgentTextMessage,
  isToolCallMessage,
  isAgentEventMessage,
} from './message';
