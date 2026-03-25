/**
 * Platform-agnostic exports for use in React Native / browser environments.
 *
 * This entry point MUST NOT import anything from `node:*` modules.
 * CLI and Server should continue using the main `"."` entry point.
 *
 * App should import from `@saaskit-dev/agentbridge/common` instead of
 * `@saaskit-dev/agentbridge` to avoid pulling Node.js code into the bundle.
 */

// Types
export type {
  PermissionMode,
  SessionMetadata,
  AgentState,
  EncryptionVariant,
  Session,
  SessionOptions,
} from './types';

export type {
  MessageMeta,
  UserMessage,
  AgentMessageContent,
  MessageContent,
  SessionMessageContent,
  SessionMessage,
  MessageRole,
} from './types';

export type { MachineMetadata, DaemonState, Machine } from './types';

export type {
  AgentId,
  AgentStatus,
  AgentTransport,
  McpServerConfig,
  AgentBackendConfig,
  AcpPermissionHandler,
  AcpAgentConfig,
} from './types';

export type {
  ServerType,
  BasicCapabilities,
  EnhancedCapabilities,
  ServerCapabilities,
} from './types';
export {
  DEFAULT_CAPABILITIES,
  hasCapability,
  supportsTextDelta,
  supportsThinkingDelta,
  getServerDescription,
} from './types';

export type { ModelMode, SessionUsage, GitStatus } from './types';

// Interfaces (type-only, platform-agnostic)
export type { ICrypto, EncryptedData, KeyPair, CryptoFactory } from './interfaces';
export { registerCryptoFactory, createCrypto } from './interfaces';

export type {
  IStorage,
  StorageOptions,
  StorageFactory,
  ISecureStorage,
  SecureStorageOptions,
  SecureStorageFactory,
} from './interfaces';
export { registerStorageFactory, createStorage } from './interfaces';
export { registerSecureStorageFactory, createSecureStorage } from './interfaces';

export type {
  IHttpClient,
  HttpClientOptions,
  HttpClientFactory,
  RequestConfig,
  HttpResponse,
} from './interfaces';
export { registerHttpClientFactory, createHttpClient } from './interfaces';

export type {
  IWebSocketClient,
  WebSocketClientOptions,
  WebSocketClientFactory,
  IWebSocketServer,
  WebSocketServerOptions,
  WebSocketServerFactory,
  ISocket,
  ServerToClientEvents,
  ClientToServerEvents,
  Update,
  EphemeralPayload,
  RpcResponse,
  OptimisticCallback,
  WireTrace,
} from './interfaces';
export { registerWebSocketClientFactory, createWebSocketClient } from './interfaces';
export { registerWebSocketServerFactory, createWebSocketServer } from './interfaces';

export type {
  IAgentBackend,
  AgentMessage,
  SessionId,
  ToolCallId,
  StartSessionResult,
  AgentMessageHandler,
  AgentBackendFactory,
} from './interfaces';
export {
  registerAgentFactory,
  createAgent,
  hasAgentFactory,
  listAgentFactories,
  isModelOutputMessage,
  isStatusMessage,
  isToolCallMessage,
  isToolResultMessage,
  isPermissionRequestMessage,
  isPermissionResponseMessage,
  isEventMessage,
  getMessageText,
} from './interfaces';

export type {
  ITransportHandler,
  StderrContext,
  StderrResult,
  ToolPattern,
  ToolNameContext,
  TransportHandlerFactory,
} from './interfaces';
export {
  registerTransportHandler,
  createTransportHandler,
  hasTransportHandler,
} from './interfaces';

export type {
  IProcessManager,
  IProcess,
  SpawnOptions,
  ExecResult,
  ProcessManagerFactory,
} from './interfaces';
export { registerProcessManagerFactory, createProcessManager } from './interfaces';

export type {
  UpdateEvent,
  NewMessageEvent,
  NewSessionEvent,
  UpdateSessionEvent,
  NewMachineEvent,
  UpdateMachineEvent,
  DeleteSessionEvent,
  KvBatchUpdateEvent,
  EphemeralEvent,
  ActivityEvent,
  MachineStatusEvent,
  UsageEvent,
  RpcRequestEvent,
  RpcCallEvent,
  RpcRegisteredEvent,
  RpcErrorEvent,
  UpdatePayload,
} from './interfaces';

// Encryption (pure tweetnacl, no Node deps)
export type { Encryptor, Decryptor, Cipher } from './encryption';
export { SecretBoxEncryption, BoxEncryption, AES256Encryption } from './encryption';
export { SessionEncryption, MachineEncryption, EncryptionCache } from './encryption';
export type { DecryptedMessage } from './encryption';

// Utils — platform-agnostic only (NO caffeinate, fileAtomic, tmux, crypto/hmac, deterministicJson)
export { safeStringify, toError } from './utils/stringify';
export {
  encodeBase64,
  encodeBase64Url,
  decodeBase64,
  decodeBase64Url,
  encodeUtf8,
  decodeUtf8,
  encodeHex,
  decodeHex,
} from './utils/encoding';
export { AsyncLock } from './utils/asyncLock';
export { ModeAwareMessageQueue } from './utils/modeAwareMessageQueue';
export { AsyncIterableQueue } from './utils/asyncIterableQueue';
export { PushableAsyncIterable, createPushableAsyncIterable } from './utils/pushableAsyncIterable';
export { expandEnvVars, expandEnvironmentVariables, getUndefinedVars } from './utils/expandEnvVars';

// Session update handlers (platform-agnostic message processing)
export {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  DEFAULT_RESPONSE_TIMEOUT_MS,
  TOOL_CALL_ACTIVE_TIMEOUT_MS,
  HANDLED_SESSION_UPDATE_TYPES,
  shouldLogUnhandledSessionUpdate,
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
} from './implementations/agent/sessionUpdateHandlers';
