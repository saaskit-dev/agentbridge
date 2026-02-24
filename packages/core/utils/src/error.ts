/**
 * @agentbridge/utils - Error Utilities
 * Error handling and wrapping utilities
 */

/**
 * Base error class for AgentBridge
 */
export class AgentBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'AgentBridgeError';
  }
}

/**
 * Encryption related errors
 */
export class EncryptionError extends AgentBridgeError {
  constructor(message: string, cause?: Error) {
    super(message, 'ENCRYPTION_ERROR', cause);
    this.name = 'EncryptionError';
  }
}

/**
 * Storage related errors
 */
export class StorageError extends AgentBridgeError {
  constructor(message: string, cause?: Error) {
    super(message, 'STORAGE_ERROR', cause);
    this.name = 'StorageError';
  }
}

/**
 * Network/transport related errors
 */
export class TransportError extends AgentBridgeError {
  constructor(message: string, cause?: Error) {
    super(message, 'TRANSPORT_ERROR', cause);
    this.name = 'TransportError';
  }
}

/**
 * Protocol/encoding related errors
 */
export class ProtocolError extends AgentBridgeError {
  constructor(message: string, cause?: Error) {
    super(message, 'PROTOCOL_ERROR', cause);
    this.name = 'ProtocolError';
  }
}

/**
 * Authentication related errors
 */
export class AuthError extends AgentBridgeError {
  constructor(message: string, cause?: Error) {
    super(message, 'AUTH_ERROR', cause);
    this.name = 'AuthError';
  }
}

/**
 * Permission related errors
 */
export class PermissionError extends AgentBridgeError {
  constructor(message: string, cause?: Error) {
    super(message, 'PERMISSION_ERROR', cause);
    this.name = 'PermissionError';
  }
}

/**
 * Session related errors
 */
export class SessionError extends AgentBridgeError {
  constructor(message: string, cause?: Error) {
    super(message, 'SESSION_ERROR', cause);
    this.name = 'SessionError';
  }
}

/**
 * Wrap an unknown error into an AgentBridgeError
 */
export function wrapError(error: unknown, ErrorClass: typeof AgentBridgeError = AgentBridgeError): AgentBridgeError {
  if (error instanceof AgentBridgeError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;

  // Handle different constructor signatures:
  // - AgentBridgeError: (message, code, cause?)
  // - Subclasses (EncryptionError, etc.): (message, cause?)
  if (ErrorClass === AgentBridgeError) {
    return new AgentBridgeError(message, 'WRAPPED_ERROR', cause);
  }

  // Use double cast through unknown for subclasses
  const AnyErrorClass = ErrorClass as unknown as new (msg: string, cause?: Error) => AgentBridgeError;
  return new AnyErrorClass(message, cause);
}

/**
 * Check if an error is an AgentBridgeError
 */
export function isAgentBridgeError(error: unknown): error is AgentBridgeError {
  return error instanceof AgentBridgeError;
}

/**
 * Check if an error has a specific code
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return isAgentBridgeError(error) && error.code === code;
}

/**
 * Get error message safely
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Create an error with cause chain
 */
export function createError<T extends AgentBridgeError>(
  ErrorClass: new (message: string, code: string, cause?: Error) => T,
  message: string,
  code: string,
  cause?: unknown
): T {
  const causeError = cause instanceof Error ? cause : undefined;
  return new ErrorClass(message, code, causeError);
}
