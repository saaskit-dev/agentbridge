/**
 * @agentbridge/interfaces - Error Types
 * Error types and error handling interfaces
 */

/**
 * Error codes for AgentBridge
 */
export enum ErrorCode {
  // General errors
  UNKNOWN = 'UNKNOWN',
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  PERMISSION_DENIED = 'PERMISSION_DENIED',

  // Encryption errors
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  KEY_DERIVATION_FAILED = 'KEY_DERIVATION_FAILED',
  INVALID_KEY = 'INVALID_KEY',

  // Storage errors
  STORAGE_ERROR = 'STORAGE_ERROR',
  STORAGE_FULL = 'STORAGE_FULL',
  ITEM_NOT_FOUND = 'ITEM_NOT_FOUND',

  // Transport errors
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  CONNECTION_CLOSED = 'CONNECTION_CLOSED',
  SEND_FAILED = 'SEND_FAILED',

  // Protocol errors
  PROTOCOL_ERROR = 'PROTOCOL_ERROR',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  SERIALIZATION_ERROR = 'SERIALIZATION_ERROR',

  // Auth errors
  AUTH_FAILED = 'AUTH_FAILED',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  AUTH_REQUIRED = 'AUTH_REQUIRED',

  // Session errors
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_ERROR = 'SESSION_ERROR',

  // Sync errors
  SYNC_ERROR = 'SYNC_ERROR',
  SYNC_CONFLICT = 'SYNC_CONFLICT',
}

/**
 * IAgentBridgeError - Error interface
 */
export interface IAgentBridgeError extends Error {
  /** Error code */
  code: ErrorCode;
  /** HTTP status code if applicable */
  statusCode?: number;
  /** Original error */
  cause?: Error;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Create an AgentBridge error
 */
export function createError(
  code: ErrorCode,
  message: string,
  options?: {
    cause?: Error;
    statusCode?: number;
    context?: Record<string, unknown>;
  }
): IAgentBridgeError {
  const error = new Error(message) as IAgentBridgeError;
  error.code = code;
  error.name = 'AgentBridgeError';
  if (options?.cause) error.cause = options.cause;
  if (options?.statusCode) error.statusCode = options.statusCode;
  if (options?.context) error.context = options.context;
  return error;
}

/**
 * Check if an error is an AgentBridge error
 */
export function isAgentBridgeError(error: unknown): error is IAgentBridgeError {
  return error instanceof Error && 'code' in error;
}

/**
 * Check if error has a specific code
 */
export function hasErrorCode(error: unknown, code: ErrorCode): boolean {
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
 * IErrorHandler - Error handling interface
 */
export interface IErrorHandler {
  /**
   * Handle an error
   */
  handle(error: unknown): void;

  /**
   * Wrap an error with context
   */
  wrap(error: unknown, context: Record<string, unknown>): IAgentBridgeError;
}
