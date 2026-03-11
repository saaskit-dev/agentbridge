/**
 * Agent implementations
 */

export { AcpBackend, createAcpBackendFactory } from './acp';
export { ClaudeBackend } from './claude';

// Factories for specific agents
export {
  createGeminiBackend,
  createCodexBackend,
  createClaudeAcpBackend,
  createOpenCodeBackend,
  type GeminiBackendOptions,
  type CodexBackendOptions,
  type ClaudeAcpBackendOptions,
  type OpenCodeBackendOptions,
} from './factories';

// Session update handlers and types
export {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  DEFAULT_RESPONSE_TIMEOUT_MS,
  TOOL_CALL_ACTIVE_TIMEOUT_MS,
  formatDuration,
  formatDurationMinutes,
  parseArgsFromContent,
  extractErrorDetail,
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
  type SessionUpdate,
  type HandlerContext,
  type HandlerResult,
} from './sessionUpdateHandlers';
