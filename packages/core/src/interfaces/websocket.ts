// === WebSocket Client ===

/** WebSocket client options */
export interface WebSocketClientOptions {
  auth?: Record<string, string>;
  transports?: ('websocket' | 'polling')[];
  path?: string;
  timeout?: number;
}

/** WebSocket client factory type */
export type WebSocketClientFactory = (options?: WebSocketClientOptions) => IWebSocketClient;

/** WebSocket client interface */
export interface IWebSocketClient {
  /** Connect to server */
  connect(url: string, options?: WebSocketClientOptions): Promise<void>;

  /** Disconnect from server */
  disconnect(): void;

  /** Emit an event */
  emit(event: string, data: unknown): void;

  /** Register event handler */
  on(event: string, handler: (data: unknown) => void): void;

  /** Remove event handler */
  off(event: string, handler?: (data: unknown) => void): void;

  /** Emit with acknowledgment (RPC style) */
  emitWithAck?(event: string, data: unknown, timeout?: number): Promise<unknown>;

  /** Check if connected */
  isConnected(): boolean;

  /** Get socket ID */
  id?(): string | undefined;
}

// Factory registry
const wsClientFactories = new Map<string, WebSocketClientFactory>();

/** Register a WebSocket client factory */
export function registerWebSocketClientFactory(
  type: string,
  factory: WebSocketClientFactory
): void {
  wsClientFactories.set(type, factory);
}

/** Create a WebSocket client instance */
export function createWebSocketClient(
  type: string,
  options?: WebSocketClientOptions
): IWebSocketClient {
  const factory = wsClientFactories.get(type);
  if (!factory) {
    throw new Error(
      `WebSocket client factory not found: ${type}. Available: ${[...wsClientFactories.keys()].join(', ')}`
    );
  }
  return factory(options);
}

// === WebSocket Server ===

/** Socket wrapper for server-side connections */
export interface ISocket {
  /** Socket ID */
  id: string;

  /** Emit event to this socket */
  emit(event: string, data: unknown): void;

  /** Register event handler */
  on(event: string, handler: (data: unknown) => void): void;

  /** Disconnect this socket */
  disconnect(): void;

  /** User data attached to socket */
  data: Record<string, unknown>;

  /** Emit with timeout (for RPC) */
  timeout(ms: number): {
    emitWithAck(event: string, data: unknown): Promise<unknown>;
  };

  /** Join a room */
  join?(room: string): void;

  /** Leave a room */
  leave?(room: string): void;
}

/** WebSocket server options */
export interface WebSocketServerOptions {
  path?: string;
  pingTimeout?: number;
  pingInterval?: number;
}

/** WebSocket server factory type */
export type WebSocketServerFactory = (options?: WebSocketServerOptions) => IWebSocketServer;

/** WebSocket server interface */
export interface IWebSocketServer {
  /** Attach to HTTP server */
  attach(httpServer: unknown): void;

  /** Start listening on port */
  start(port: number): Promise<void>;

  /** Stop the server */
  stop(): Promise<void>;

  /** Handle new connections */
  onConnection(handler: (socket: ISocket) => void): void;

  /** Emit to all connected sockets */
  emit(event: string, data: unknown): void;

  /** Emit to a specific room */
  to(room: string): {
    emit(event: string, data: unknown): void;
  };

  /** Get all sockets in a room */
  in?(room: string): ISocket[];
}

// Factory registry
const wsServerFactories = new Map<string, WebSocketServerFactory>();

/** Register a WebSocket server factory */
export function registerWebSocketServerFactory(
  type: string,
  factory: WebSocketServerFactory
): void {
  wsServerFactories.set(type, factory);
}

/** Create a WebSocket server instance */
export function createWebSocketServer(
  type: string,
  options?: WebSocketServerOptions
): IWebSocketServer {
  const factory = wsServerFactories.get(type);
  if (!factory) {
    throw new Error(
      `WebSocket server factory not found: ${type}. Available: ${[...wsServerFactories.keys()].join(', ')}`
    );
  }
  return factory(options);
}

// === WebSocket Event Types ===

import type { WireTrace } from '../telemetry/types.js';
export type { WireTrace };

/** Update event from server */
export interface Update {
  id: string;
  seq: number;
  body: {
    t: string;
    [key: string]: unknown;
  };
  createdAt: number;
  _trace?: WireTrace;
}

/** Ephemeral event payload */
export interface EphemeralPayload {
  type: 'activity' | 'machine-activity' | 'usage' | 'machine-status';
  [key: string]: unknown;
  _trace?: WireTrace;
}

/** RPC response */
export interface RpcResponse {
  ok: boolean;
  result?: string;
  error?: string;
}

/** Optimistic concurrency callback response */
export type OptimisticCallback =
  | { result: 'error' }
  | { result: 'version-mismatch'; version: number; [key: string]: unknown }
  | { result: 'success'; version: number; [key: string]: unknown };

/** Server to client events */
export interface ServerToClientEvents {
  update: (data: Update) => void;
  'rpc-request': (
    data: { method: string; params: string; _trace?: WireTrace },
    callback: (response: string) => void
  ) => void;
  'rpc-registered': (data: { method: string; _trace?: WireTrace }) => void;
  'rpc-unregistered': (data: { method: string; _trace?: WireTrace }) => void;
  'rpc-error': (data: { type: string; error: string; _trace?: WireTrace }) => void;
  ephemeral: (data: EphemeralPayload) => void;
  auth: (data: { success: boolean; user: string }) => void;
  error: (data: { message: string }) => void;
}

/** Client to server events */
export interface ClientToServerEvents {
  message: (data: { sid: string; message: unknown; localId?: string; _trace?: WireTrace }) => void;
  'session-alive': (data: {
    sid: string;
    time: number;
    thinking?: boolean;
    mode?: 'local' | 'remote';
    _trace?: WireTrace;
  }) => void;
  'session-end': (data: { sid: string; time: number; _trace?: WireTrace }) => void;
  'update-metadata': (
    data: { sid: string; expectedVersion: number; metadata: string; _trace?: WireTrace },
    callback: OptimisticCallback
  ) => void;
  'update-state': (
    data: { sid: string; expectedVersion: number; agentState: string | null; _trace?: WireTrace },
    callback: OptimisticCallback
  ) => void;
  ping: (callback: () => void) => void;
  'rpc-register': (data: { method: string; _trace?: WireTrace }) => void;
  'rpc-unregister': (data: { method: string; _trace?: WireTrace }) => void;
  'rpc-call': (
    data: { method: string; params: string; _trace?: WireTrace },
    callback: (response: RpcResponse) => void
  ) => void;
  'usage-report': (data: {
    key: string;
    sessionId: string;
    tokens: { total: number; [key: string]: number };
    cost: { total: number; [key: string]: number };
    _trace?: WireTrace;
  }) => void;
  'machine-alive': (data: { machineId: string; time: number; _trace?: WireTrace }) => void;
  'machine-update-metadata': (
    data: { machineId: string; metadata: string; expectedVersion: number; _trace?: WireTrace },
    callback: OptimisticCallback
  ) => void;
  'machine-update-state': (
    data: { machineId: string; daemonState: string; expectedVersion: number; _trace?: WireTrace },
    callback: OptimisticCallback
  ) => void;
  /** CLI → Server: streaming text delta for typewriter effect (RFC §7.1) */
  'streaming:text-delta': (data: {
    sessionId: string;
    messageId: string;
    delta: string;
    timestamp: number;
    _trace?: WireTrace;
  }) => void;
  /** CLI → Server: signals that text streaming has finished */
  'streaming:text-complete': (data: {
    sessionId: string;
    messageId: string;
    fullText: string;
    timestamp: number;
    _trace?: WireTrace;
  }) => void;
  /** CLI → Server: streaming thinking/reasoning delta (RFC §7.1) */
  'streaming:thinking-delta': (data: {
    sessionId: string;
    messageId: string;
    delta: string;
    timestamp: number;
    _trace?: WireTrace;
  }) => void;
}
