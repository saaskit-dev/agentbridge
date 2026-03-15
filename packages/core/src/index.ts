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

// Server capabilities
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

// Interfaces
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
  // Type guards
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

// Implementations
export { NodeCrypto } from './implementations';
export { FsStorage, EncryptedFsStorage } from './implementations';
export { AxiosHttpClient } from './implementations';
export { SocketIoClient, SocketIoServer, SocketIoSocket } from './implementations';
export { NodeProcess, NodeProcessManager } from './implementations';
export { AcpBackend, createAcpBackendFactory, createAcpBackend, ClaudeBackend } from './implementations';
export {
  createGeminiBackend,
  createCodexBackend,
  createClaudeAcpBackend,
  createOpenCodeBackend,
  type CreateAcpBackendOptions,
  type GeminiBackendOptions,
  type CodexBackendOptions,
  type ClaudeAcpBackendOptions,
  type OpenCodeBackendOptions,
} from './implementations';

// Transport handlers
export {
  DefaultTransport,
  GeminiTransport,
  CodexTransport,
  ClaudeAcpTransport,
  OpenCodeTransport,
  defaultTransport,
} from './implementations';

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
} from './implementations';

// Encryption
export type { Encryptor, Decryptor, Cipher } from './encryption';
export { SecretBoxEncryption, BoxEncryption, AES256Encryption } from './encryption';
export { SessionEncryption, MachineEncryption, EncryptionCache } from './encryption';
export type { DecryptedMessage } from './encryption';
export {
  wireEncode,
  wireDecode,
  wireEncodeBatch,
  wireDecodeBatch,
  tryParsePlaintext,
  wireDecodeBytes,
  wireDecodeBatchBytes,
} from './encryption';

// Utils - Encoding
export {
  encodeBase64,
  encodeBase64Url,
  decodeBase64,
  decodeBase64Url,
  encodeUtf8,
  decodeUtf8,
  encodeHex,
  decodeHex,
} from './utils';

// Utils - Crypto
export { hmacSha512, deriveKey, deriveSecretKeyTreeRoot, deriveSecretKeyTreeChild } from './utils';
export type { KeyTreeState } from './utils';

// Utils - Concurrency
export { AsyncLock } from './utils';

// Utils - File
export { atomicFileWrite, atomicWriteJson } from './utils';

// Utils - JSON
export { deterministicStringify, hashObject, deepEqual, objectKey } from './utils';
export type { DeterministicJsonOptions } from './utils';

// Utils - Message Queue
// Utils - Message Queues
export {
  ModeAwareMessageQueue,
  AsyncIterableQueue,
  PushableAsyncIterable,
  createPushableAsyncIterable,
} from './utils';

// Utils - Stringify
export { safeStringify, toError } from './utils';

// Utils - Environment Variables
export { expandEnvVars, expandEnvironmentVariables, getUndefinedVars } from './utils';

// Utils - System (Caffeinate)
export { startCaffeinate, stopCaffeinate, isCaffeinateRunning } from './utils';
export type { CaffeinateOptions } from './utils';

// Utils - Tmux
export {
  isTmuxAvailable,
  isInsideTmux,
  getTmuxEnvironment,
  getSessionName,
  getWindowIndex,
  getPaneIndex,
  execTmux,
  newSession,
  attachSession,
  killSession,
  listSessions,
  sendKeys,
  splitWindow,
  selectPane,
  resizePane,
  setOption,
  renameSession,
  renameWindow,
  capturePane,
  sessionExists,
} from './utils';
export type {
  TmuxControlSequence,
  TmuxEnvironment,
  TmuxCommandResult,
  TmuxSessionInfo,
} from './utils';

// Types
export type { ModelMode, SessionUsage, GitStatus } from './types';
