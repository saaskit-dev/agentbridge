export type { ICrypto, EncryptedData, KeyPair, CryptoFactory } from './crypto';
export { registerCryptoFactory, createCrypto } from './crypto';

export type { IStorage, StorageOptions, StorageFactory } from './storage';
export type { ISecureStorage, SecureStorageOptions, SecureStorageFactory } from './storage';
export { registerStorageFactory, createStorage } from './storage';
export { registerSecureStorageFactory, createSecureStorage } from './storage';

export type { IHttpClient, HttpClientOptions, HttpClientFactory, RequestConfig, HttpResponse } from './http';
export { registerHttpClientFactory, createHttpClient } from './http';

export type {
  IWebSocketClient, WebSocketClientOptions, WebSocketClientFactory,
  IWebSocketServer, WebSocketServerOptions, WebSocketServerFactory,
  ISocket,
  ServerToClientEvents, ClientToServerEvents,
  Update, EphemeralPayload, RpcResponse, OptimisticCallback,
} from './websocket';
export { registerWebSocketClientFactory, createWebSocketClient } from './websocket';
export { registerWebSocketServerFactory, createWebSocketServer } from './websocket';

export type {
  IAgentBackend, AgentMessage, SessionId, ToolCallId,
  StartSessionResult, AgentMessageHandler, AgentBackendFactory,
} from './agent';
export type {
  AgentId, AgentTransport, McpServerConfig, AgentBackendConfig, AcpAgentConfig,
} from './agent';
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
} from './agent';

export type {
  ITransportHandler, StderrContext, StderrResult, ToolPattern, ToolNameContext,
  TransportHandlerFactory,
} from './transport';
export { registerTransportHandler, createTransportHandler, hasTransportHandler } from './transport';

export type { IProcessManager, IProcess, SpawnOptions, ExecResult, ProcessManagerFactory } from './process';
export { registerProcessManagerFactory, createProcessManager } from './process';

export type {
  UpdateEvent, NewMessageEvent, NewSessionEvent, UpdateSessionEvent,
  NewMachineEvent, UpdateMachineEvent, DeleteSessionEvent, KvBatchUpdateEvent,
  EphemeralEvent, ActivityEvent, MachineStatusEvent, UsageEvent,
  RpcRequestEvent, RpcCallEvent, RpcRegisteredEvent, RpcErrorEvent,
} from './events';
