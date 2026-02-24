/**
 * @agentbridge/interfaces - Transport Interface
 * Platform-agnostic transport interface for network communication
 */

/**
 * Connection status
 */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

/**
 * Encrypted payload for transport
 */
export interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
  keyId?: string;
}

/**
 * RPC request
 */
export interface RPCRequest {
  id: string;
  method: string;
  params: unknown;
}

/**
 * RPC response
 */
export interface RPCResponse<T = unknown> {
  id: string;
  result?: T;
  error?: { code: number; message: string };
}

/**
 * Transport events
 */
export interface TransportEvents {
  'status': (status: ConnectionStatus) => void;
  'message': (data: unknown) => void;
  'encrypted': (payload: EncryptedPayload) => void;
  'rpc:request': (request: RPCRequest) => void;
  'rpc:response': (response: RPCResponse) => void;
  'error': (error: Error) => void;
}

/**
 * ITransport - Platform-agnostic transport interface
 *
 * This interface abstracts the underlying communication layer.
 * Implementations can use:
 * - Socket.IO (browser, Node.js)
 * - Native WebSocket (browser)
 * - Mock Transport (testing)
 * - Custom protocols
 */
export interface ITransport {
  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus;

  /**
   * Connect to server
   */
  connect(): Promise<void>;

  /**
   * Disconnect from server
   */
  disconnect(): Promise<void>;

  /**
   * Send raw message
   */
  send(event: string, data: unknown): void;

  /**
   * Send encrypted payload
   */
  sendEncrypted(payload: EncryptedPayload): void;

  /**
   * Send RPC request and wait for response
   */
  rpc<T = unknown, R = unknown>(method: string, params: T, timeout?: number): Promise<R>;

  /**
   * Respond to RPC request
   */
  respondRPC<T = unknown>(requestId: string, result?: T, error?: { code: number; message: string }): void;

  /**
   * Join a room (for session/machine scoping)
   */
  joinRoom(room: string): void;

  /**
   * Leave a room
   */
  leaveRoom(room: string): void;

  /**
   * Subscribe to events
   */
  addEventListener(event: string, handler: (...args: unknown[]) => void): void;

  /**
   * Unsubscribe from events
   */
  removeEventListener(event: string, handler: (...args: unknown[]) => void): void;

  /**
   * Subscribe to server events (returns unsubscribe function)
   */
  subscribe(event: string, callback: (...args: unknown[]) => void): () => void;
}

/**
 * Transport options
 */
export interface TransportOptions {
  /** Server URL */
  serverUrl: string;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect interval in ms */
  reconnectInterval?: number;
  /** Connection timeout in ms */
  timeout?: number;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Custom transport implementation name */
  transportType?: string;
}

/**
 * Transport factory function type
 */
export type TransportFactory = (options: TransportOptions) => ITransport;

const transportFactories = new Map<string, TransportFactory>();

/**
 * Register a transport factory
 */
export function registerTransportFactory(type: string, factory: TransportFactory): void {
  transportFactories.set(type, factory);
}

/**
 * Create a transport instance
 */
export function createTransport(options: TransportOptions): ITransport {
  const type = options.transportType || 'socketio';
  const factory = transportFactories.get(type);

  if (!factory) {
    throw new Error(`Unknown transport type: ${type}. Available: ${getRegisteredTransports().join(', ')}`);
  }

  return factory(options);
}

/**
 * Get list of registered transport types
 */
export function getRegisteredTransports(): string[] {
  return Array.from(transportFactories.keys());
}

/**
 * Check if a transport type is registered
 */
export function isTransportRegistered(type: string): boolean {
  return transportFactories.has(type);
}

/**
 * Clear all registered transport factories (for testing)
 */
export function clearTransportFactories(): void {
  transportFactories.clear();
}
