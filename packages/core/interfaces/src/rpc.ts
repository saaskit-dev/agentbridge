/**
 * @agentbridge/interfaces - RPC Interface
 * Remote Procedure Call interface
 */

import type { ServerConnection } from './event';

/**
 * RPC call message
 */
export interface RpcCallMessage {
  id: string;
  method: string;
  params: string;
}

/**
 * RPC result message
 */
export interface RpcResultMessage {
  id: string;
  result?: string;
  error?: { code: number; message: string };
}

/**
 * RPC handler function type
 */
export type RpcHandler<T = unknown, R = unknown> = (params: T) => Promise<R>;

/**
 * IRpcClient - RPC client interface
 */
export interface IRpcClient {
  /**
   * Call a remote method
   */
  call<T = unknown, R = unknown>(method: string, params: T, timeout?: number): Promise<R>;

  /**
   * Check if a method is available
   */
  isMethodAvailable(method: string): boolean;
}

/**
 * IRpcServer - RPC server interface
 */
export interface IRpcServer {
  /**
   * Register a method handler
   */
  registerMethod<T = unknown, R = unknown>(method: string, handler: RpcHandler<T, R>): void;

  /**
   * Unregister a method handler
   */
  unregisterMethod(method: string): void;

  /**
   * Check if a method is registered
   */
  isMethodRegistered(method: string): boolean;

  /**
   * Get list of registered methods
   */
  getRegisteredMethods(): string[];

  /**
   * Handle incoming call
   */
  handleCall(callerId: string, message: RpcCallMessage): Promise<RpcResultMessage>;
}

/**
 * IRpcHandler - Handle RPC requests between connections
 *
 * Implementations can use:
 * - In-memory (current)
 * - Redis-backed for distributed RPC
 * - Message queue based
 * - Mock for testing
 */
export interface IRpcHandler {
  /**
   * Handle RPC registration from a connection
   */
  handleRegister(connection: ServerConnection, methods: string[]): void;

  /**
   * Handle RPC unregistration from a connection
   */
  handleUnregister(connection: ServerConnection, methods: string[]): void;

  /**
   * Handle RPC call request
   */
  handleCall(
    callerConnection: ServerConnection,
    message: RpcCallMessage
  ): Promise<void>;

  /**
   * Handle RPC result response
   */
  handleResult(connection: ServerConnection, message: RpcResultMessage): void;

  /**
   * Clean up all registrations for a connection
   */
  cleanupConnection(connection: ServerConnection): void;

  /**
   * Get registered methods for a user
   */
  getRegisteredMethods(userId: string): string[];

  /**
   * Check if a method is registered for a user
   */
  isMethodRegistered(userId: string, method: string): boolean;
}

/**
 * RPC factory function type
 */
export type RpcHandlerFactory = () => IRpcHandler;

const rpcHandlerFactories = new Map<string, RpcHandlerFactory>();

/**
 * Register an RPC handler factory
 */
export function registerRpcHandlerFactory(type: string, factory: RpcHandlerFactory): void {
  rpcHandlerFactories.set(type, factory);
}

/**
 * Create an RPC handler instance
 */
export function createRpcHandler(type = 'default'): IRpcHandler {
  const factory = rpcHandlerFactories.get(type);
  if (!factory) {
    throw new Error(`Unknown RPC handler type: ${type}. Available: ${getRegisteredRpcHandlerTypes().join(', ')}`);
  }
  return factory();
}

/**
 * Get list of registered RPC handler types
 */
export function getRegisteredRpcHandlerTypes(): string[] {
  return Array.from(rpcHandlerFactories.keys());
}
