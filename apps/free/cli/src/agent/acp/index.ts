/**
 * ACP Module - Agent Client Protocol implementations
 *
 * This module exports all ACP-related functionality including
 * the core AcpBackend and factory helpers.
 */

// Core ACP backend
export {
  AcpBackend,
  createAcpBackend,
  type CreateAcpBackendOptions,
  type AcpPermissionHandler,
} from '@saaskit-dev/agentbridge';

// Session update handlers (for testing and extension)
export {
  type SessionUpdate,
  type HandlerContext,
  type HandlerResult,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  parseArgsFromContent,
  extractErrorDetail,
  formatDuration,
  formatDurationMinutes,
  handleAgentMessageChunk,
  handleAgentThoughtChunk,
  handleToolCallUpdate,
  handleToolCall,
  handleLegacyMessageChunk,
  handlePlanUpdate,
  handleThinkingUpdate,
} from './sessionUpdateHandlers';

// Legacy aliases for backwards compatibility
export { AcpBackend as AcpSdkBackend } from '@saaskit-dev/agentbridge';
export type { CreateAcpBackendOptions as AcpSdkBackendOptions } from '@saaskit-dev/agentbridge';
