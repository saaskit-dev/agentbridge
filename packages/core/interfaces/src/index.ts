/**
 * @agentbridge/interfaces
 * Interface definitions for AgentBridge SDK
 */

// Runtime
export type { RuntimeType, RuntimeCapabilities, Runtime, RuntimeFactory } from './runtime';
export { registerRuntimeFactory, createRuntime, getRegisteredRuntimeTypes, detectRuntimeType } from './runtime';

// Crypto
export type {
  KeyPair,
  EncryptedData,
  EncryptedForRecipient,
  SessionKeys,
  EncryptionVariant,
  IBox,
  ISecretBox,
  ISign,
  IHash,
  IAES,
  IKDF,
  ICrypto,
} from './crypto';

// KeyTree
export type { KeyTreeNode, IKeyTree, KeyTreeOptions, KeyTreeFactory } from './keytree';
export { registerKeyTreeFactory, createKeyTree, getRegisteredKeyTreeTypes } from './keytree';

// Encryption
export type {
  IEncryptionProvider,
  IKeyDerivation,
  IEncryption,
} from './encryption';
export {
  registerEncryptionProvider,
  createEncryption,
  getRegisteredEncryptionProviders,
  clearEncryptionProviders,
} from './encryption';

// Storage
export type { IStorage, ISecureStorage, IBlobStorage, StorageOptions, StorageFactory } from './storage';
export {
  registerStorageFactory,
  createStorage,
  getRegisteredStorageTypes,
  InMemoryStorage,
} from './storage';

// Transport
export type {
  ConnectionStatus,
  EncryptedPayload,
  RPCRequest,
  RPCResponse,
  TransportEvents,
  ITransport,
  TransportOptions,
  TransportFactory,
} from './transport';
export {
  registerTransportFactory,
  createTransport,
  getRegisteredTransports,
  isTransportRegistered,
  clearTransportFactories,
} from './transport';

// Event
export type {
  ConnectionType,
  SessionScopedConnection,
  UserScopedConnection,
  MachineScopedConnection,
  ClientConnection,
  RecipientFilter,
  UpdateEvent,
  NewMessageEvent,
  NewSessionEvent,
  UpdateSessionEvent,
  UpdateAccountEvent,
  NewMachineEvent,
  UpdateMachineEvent,
  DeleteSessionEvent,
  NewArtifactEvent,
  UpdateArtifactEvent,
  DeleteArtifactEvent,
  RelationshipUpdatedEvent,
  NewFeedPostEvent,
  KVBatchUpdateEvent,
  EphemeralEvent,
  ActivityEvent,
  MachineActivityEvent,
  UsageEvent,
  MachineStatusEvent,
  UpdatePayload,
  EphemeralPayload,
  ServerConnection,
  IEventRouter,
} from './event';

// Sync
export type { SyncEvents, IInvalidateSync, ISyncEngine, SyncEngineFactory } from './sync';
export {
  registerSyncEngineFactory,
  createSyncEngineInstance,
  getRegisteredSyncEngineTypes,
  clearSyncEngineFactories,
} from './sync';

// Auth
export type {
  Credentials,
  AuthChallenge,
  AuthResponse,
  UserInfo,
  IAuthVerifier,
  IAuth,
  AuthFactory,
} from './auth';
export { registerAuthFactory, createAuth, getRegisteredAuthTypes } from './auth';

// RPC
export type {
  RpcCallMessage,
  RpcResultMessage,
  RpcHandler,
  IRpcClient,
  IRpcServer,
  IRpcHandler,
  RpcHandlerFactory,
} from './rpc';
export {
  registerRpcHandlerFactory,
  createRpcHandler,
  getRegisteredRpcHandlerTypes,
} from './rpc';

// Database
export type {
  QueryOptions,
  QueryResult,
  IDatabaseTransaction,
  IDatabase,
  DatabaseConfig,
  DatabaseFactory,
} from './database';
export { registerDatabaseFactory, createDatabase, getRegisteredDatabaseTypes } from './database';

// Logger
export type { LogLevel, LogEntry, LogHandler, ILogger, LoggerOptions, LoggerFactory } from './logger';
export {
  registerLoggerFactory,
  createLogger,
  getRegisteredLoggerTypes,
  ConsoleLogger,
} from './logger';

// Errors
export { ErrorCode } from './errors';
export type { IAgentBridgeError, IErrorHandler } from './errors';
export {
  createError,
  isAgentBridgeError,
  hasErrorCode,
  getErrorMessage,
} from './errors';
