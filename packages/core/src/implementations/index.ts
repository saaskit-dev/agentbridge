/**
 * Implementations - re-export all platform implementations
 */

// Crypto
export { NodeCrypto } from './crypto';

// Storage
export { FsStorage, EncryptedFsStorage } from './storage';

// HTTP
export { AxiosHttpClient } from './http';

// WebSocket
export { SocketIoClient, SocketIoServer, SocketIoSocket } from './websocket';

// Process
export { NodeProcess, NodeProcessManager } from './process';

// Agent
export { AcpBackend, createAcpBackendFactory, createAcpBackend, ClaudeBackend } from './agent';
export {
  type CreateAcpBackendOptions,
  createGeminiBackend,
  createCodexBackend,
  createClaudeBackend,
  createOpenCodeBackend,
  createCursorBackend,
  type GeminiBackendOptions,
  type CodexBackendOptions,
  type ClaudeBackendOptions,
  type OpenCodeBackendOptions,
  type CursorBackendOptions,
} from './agent';

// Session update handlers
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
} from './agent';

// Transport
export {
  DefaultTransport,
  GeminiTransport,
  CodexTransport,
  ClaudeAcpTransport,
  OpenCodeTransport,
  CursorTransport,
  defaultTransport,
  cursorTransport,
} from './transport';
