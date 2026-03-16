/**
 * Generic RPC handler manager for session and machine clients
 * Manages RPC method registration, encryption/decryption, and handler execution
 */

import { Socket } from 'socket.io-client';
import { RpcHandler, RpcHandlerMap, RpcRequest, RpcHandlerConfig } from './types';
import { encryptToWireString, decryptFromWireString } from '@/api/encryption';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
const defaultLogger = new Logger('api/rpc/RpcHandlerManager');

export class RpcHandlerManager {
  private handlers: RpcHandlerMap = new Map();
  private readonly scopePrefix: string;
  private readonly encryptionKey: Uint8Array;
  private readonly encryptionVariant: 'legacy' | 'dataKey';
  private readonly logger: (message: string, data?: any) => void;
  private socket: Socket | null = null;

  constructor(config: RpcHandlerConfig) {
    this.scopePrefix = config.scopePrefix;
    this.encryptionKey = config.encryptionKey;
    this.encryptionVariant = config.encryptionVariant;
    this.logger = config.logger || ((msg, data) => defaultLogger.debug(msg, data));
  }

  /**
   * Register an RPC handler for a specific method
   * @param method - The method name (without prefix)
   * @param handler - The handler function
   */
  registerHandler<TRequest = any, TResponse = any>(
    method: string,
    handler: RpcHandler<TRequest, TResponse>
  ): void {
    const prefixedMethod = this.getPrefixedMethod(method);

    // Store the handler
    this.handlers.set(prefixedMethod, handler);

    if (this.socket) {
      this.socket.emit('rpc-register', { method: prefixedMethod });
    }
  }

  /**
   * Handle an incoming RPC request
   * @param request - The RPC request data
   * @param callback - The response callback
   */
  async handleRequest(request: RpcRequest): Promise<any> {
    try {
      const handler = this.handlers.get(request.method);

      if (!handler) {
        this.logger('[RPC] [ERROR] Method not found', { method: request.method });
        const errorResponse = { error: 'Method not found' };
        return await encryptToWireString(this.encryptionKey, this.encryptionVariant, errorResponse);
      }

      // Decrypt the incoming params
      const decryptedParams = await decryptFromWireString(
        this.encryptionKey,
        this.encryptionVariant,
        request.params
      );

      // Call the handler
      this.logger('[RPC] Calling handler', { method: request.method });
      const result = await handler(decryptedParams);
      this.logger('[RPC] Handler returned', {
        method: request.method,
        hasResult: result !== undefined,
      });

      // Encrypt and return the response
      const wireResponse = await encryptToWireString(this.encryptionKey, this.encryptionVariant, result);
      this.logger('[RPC] Sending encrypted response', {
        method: request.method,
        responseLength: wireResponse.length,
      });
      return wireResponse;
    } catch (error) {
      this.logger('[RPC] [ERROR] Error handling request', { error });
      const errorResponse = {
        error: safeStringify(error),
      };
      return await encryptToWireString(this.encryptionKey, this.encryptionVariant, errorResponse);
    }
  }

  onSocketConnect(socket: Socket): void {
    this.socket = socket;
    for (const [prefixedMethod] of this.handlers) {
      socket.emit('rpc-register', { method: prefixedMethod });
    }
  }

  onSocketDisconnect(): void {
    this.socket = null;
  }

  /**
   * Get the number of registered handlers
   */
  getHandlerCount(): number {
    return this.handlers.size;
  }

  /**
   * Check if a handler is registered
   * @param method - The method name (without prefix)
   */
  hasHandler(method: string): boolean {
    const prefixedMethod = this.getPrefixedMethod(method);
    return this.handlers.has(prefixedMethod);
  }

  /**
   * Clear all handlers
   */
  clearHandlers(): void {
    this.handlers.clear();
    this.logger('Cleared all RPC handlers');
  }

  /**
   * Get the prefixed method name
   * @param method - The method name
   */
  private getPrefixedMethod(method: string): string {
    return `${this.scopePrefix}:${method}`;
  }
}

/**
 * Factory function to create an RPC handler manager
 */
export function createRpcHandlerManager(config: RpcHandlerConfig): RpcHandlerManager {
  return new RpcHandlerManager(config);
}
