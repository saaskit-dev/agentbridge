/**
 * ACP Module - Agent Client Protocol implementations
 *
 * This module re-exports `@saaskit-dev/agentbridge` ACP types and session handlers
 * so consumers have a single import path; implementations live in core only.
 */

// Core ACP backend
export {
  AcpBackend,
  createAcpBackend,
  type CreateAcpBackendOptions,
  type AcpPermissionHandler,
} from '@saaskit-dev/agentbridge';

// Session update handlers (same module as AcpBackend — no duplicate CLI copy)
export {
  type SessionUpdate,
  type HandlerContext,
  type HandlerResult,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  DEFAULT_RESPONSE_TIMEOUT_MS,
  TOOL_CALL_ACTIVE_TIMEOUT_MS,
  HANDLED_SESSION_UPDATE_TYPES,
  shouldLogUnhandledSessionUpdate,
  parseArgsFromContent,
  extractErrorDetail,
  formatDuration,
  formatDurationMinutes,
  handleAgentMessageChunk,
  handleAgentThoughtChunk,
  startToolCall,
  completeToolCall,
  failToolCall,
  handleToolCallUpdate,
  handleToolCall,
  handleLegacyMessageChunk,
  handlePlanUpdate,
  handleThinkingUpdate,
} from '@saaskit-dev/agentbridge';

// Legacy aliases for backwards compatibility
export { AcpBackend as AcpSdkBackend } from '@saaskit-dev/agentbridge';
export type { CreateAcpBackendOptions as AcpSdkBackendOptions } from '@saaskit-dev/agentbridge';
