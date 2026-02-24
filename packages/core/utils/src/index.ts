/**
 * @agentbridge/utils
 * Utility functions for AgentBridge SDK
 */

// Encoding utilities
export {
  decodeBase64,
  encodeBase64,
  decodeHex,
  encodeHex,
  encodeUTF8,
  decodeUTF8,
  normalizeNFKD,
} from './encoding';

// Async lock
export { AsyncLock, createLock } from './lock';

// Backoff
export { backoff, createBackoff } from './backoff';
export type { BackoffFunction, BackoffOptions } from './backoff';

// Message queue
export {
  MessageQueue,
  SimpleMessageQueue,
} from './queue';
export type {
  MessageHashFunction,
  QueuedMessage,
  WaitResult,
  MessageQueueOptions,
} from './queue';

// Error utilities
export {
  AgentBridgeError,
  EncryptionError,
  StorageError,
  TransportError,
  ProtocolError,
  AuthError,
  PermissionError,
  SessionError,
  wrapError,
  isAgentBridgeError,
  hasErrorCode,
  getErrorMessage,
  createError,
} from './error';

// Singleton utilities
export {
  getSingleton,
  getSingletonSync,
  hasSingleton,
  clearSingleton,
  clearAllSingletons,
  getSingletonKeys,
} from './singleton';
export type { SingletonFactory } from './singleton';
