import { io, Socket } from 'socket.io-client';
import { Encryption } from './encryption/encryption';
import { TokenStorage } from '@/auth/tokenStorage';
import { getSessionTrace, sessionLogger } from './appTraceStore';
import { Logger, safeStringify, toError } from '@saaskit-dev/agentbridge/telemetry';
import { storage } from './storage';
const logger = new Logger('app/sync/apiSocket');

//
// Types
//

export interface SyncSocketConfig {
  endpoint: string;
  token: string;
}

export interface SyncSocketState {
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  lastError: Error | null;
}

export type SyncSocketListener = (state: SyncSocketState) => void;
type ReconnectMode = 'foreground' | 'background';

const RECONNECT_DELAYS: Record<ReconnectMode, { min: number; max: number }> = {
  foreground: { min: 1000, max: 5000 },
  background: { min: 5000, max: 30000 },
};

//
// Main Class
//

class ApiSocket {
  // State
  private socket: Socket | null = null;
  private config: SyncSocketConfig | null = null;
  private encryption: Encryption | null = null;
  private messageHandlers: Map<string, (data: any) => void> = new Map();
  private reconnectedListeners: Set<() => void> = new Set();
  private authErrorListeners: Set<(message: string) => void> = new Set();
  private statusListeners: Set<
    (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void
  > = new Set();
  private currentStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  private daemonReadyListeners: Map<string, Set<() => void>> = new Map();
  // Tracks sessions for which daemon-rpc-ready was received before waitForDaemonReady was called.
  // Cleared when the socket reconnects (daemon re-registers fresh).
  private daemonReadySessions: Set<string> = new Set();
  // Diagnostics: last socket disconnect reason and timestamp, plus how long the last connection lasted.
  private lastDisconnectReason: string | null = null;
  private lastDisconnectAt: number | null = null;
  private lastConnectedAt: number | null = null;
  private reconnectMode: ReconnectMode = 'foreground';
  // RFC-010 §3.3: Provider for active session lastSeqs (injected by Sync to avoid circular dep)
  private lastSeqsProvider: (() => Record<string, number>) | null = null;

  getStatus(): 'disconnected' | 'connecting' | 'connected' | 'error' {
    return this.currentStatus;
  }

  /**
   * RFC-010 §3.3: Register a provider that returns { sessionId: lastSeq } for
   * active sessions. Called by Sync at init time to avoid circular dependency.
   */
  setLastSeqsProvider(provider: () => Record<string, number>) {
    this.lastSeqsProvider = provider;
  }

  //
  // Initialization
  //

  initialize(config: SyncSocketConfig, encryption: Encryption) {
    this.config = config;
    this.encryption = encryption;
    this.connect();
  }

  //
  // Connection Management
  //

  connect() {
    if (!this.config || this.socket) {
      return;
    }

    this.updateStatus('connecting');
    logger.debug('[SyncSocket] connecting to', { endpoint: this.config.endpoint });

    const lastSeqs = this.lastSeqsProvider?.() ?? {};
    const reconnectDelay = RECONNECT_DELAYS[this.reconnectMode];
    this.socket = io(this.config.endpoint, {
      path: '/v1/updates',
      auth: {
        token: this.config.token,
        clientType: 'user-scoped' as const,
        ...(Object.keys(lastSeqs).length > 0 ? { lastSeqs } : {}),
      },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: reconnectDelay.min,
      reconnectionDelayMax: reconnectDelay.max,
      reconnectionAttempts: Infinity,
    });

    this.setupEventHandlers();
  }

  resume() {
    if (!this.config) {
      return;
    }

    if (!this.socket) {
      this.connect();
      return;
    }

    this.refreshReconnectAuth();

    if (this.socket.connected) {
      this.updateStatus('connected');
      return;
    }

    this.updateStatus('connecting');
    logger.info('[SyncSocket] Resuming socket connection', {
      socketId: this.socket.id,
      lastDisconnectReason: this.lastDisconnectReason,
      lastDisconnectAgo: this.lastDisconnectAt ? Date.now() - this.lastDisconnectAt : null,
    });
    this.socket.connect();
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.updateStatus('disconnected');
  }

  //
  // Listener Management
  //

  onReconnected = (listener: () => void) => {
    this.reconnectedListeners.add(listener);
    return () => this.reconnectedListeners.delete(listener);
  };

  onAuthError = (listener: (message: string) => void) => {
    this.authErrorListeners.add(listener);
    return () => this.authErrorListeners.delete(listener);
  };

  onStatusChange = (
    listener: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void
  ) => {
    this.statusListeners.add(listener);
    // Immediately notify with current status
    listener(this.currentStatus);
    return () => this.statusListeners.delete(listener);
  };

  //
  // Message Handling
  //

  onMessage(event: string, handler: (data: any) => void) {
    this.messageHandlers.set(event, handler);
    return () => this.messageHandlers.delete(event);
  }

  offMessage(event: string, handler: (data: any) => void) {
    this.messageHandlers.delete(event);
  }

  /**
   * Wait for the daemon to (re)register its RPC methods for the given session.
   * Resolves when daemon-rpc-ready is received; rejects if the session goes offline.
   *
   * No hard timeout here: when the daemon socket drops, the server immediately
   * broadcasts an offline ephemeral to the App (socket.ts disconnect handler),
   * which sets session.status = 'offline' and causes this promise to reject.
   */
  private waitForDaemonReady(sessionId: string, method: string): Promise<void> {
    const log = sessionLogger(logger, sessionId);
    // Fast path: daemon-rpc-ready already arrived before we started waiting
    if (this.daemonReadySessions.has(sessionId)) {
      this.daemonReadySessions.delete(sessionId);
      log.debug('[apiSocket] waitForDaemonReady: fast-path hit (event arrived before wait)', {
        method,
      });
      return Promise.resolve();
    }
    const waitStart = Date.now();
    const socketWasConnected = this.socket?.connected ?? false;
    return new Promise((resolve, reject) => {
      const currentSocket = this.socket;
      const listeners = this.daemonReadyListeners.get(sessionId) ?? new Set();
      const onReady = () => {
        cleanup();
        log.info('[apiSocket] waitForDaemonReady: daemon-rpc-ready received', {
          method,
          waitMs: Date.now() - waitStart,
        });
        resolve();
      };
      listeners.add(onReady);
      this.daemonReadyListeners.set(sessionId, listeners);

      // Cancel wait if the session goes offline — captures the specific reason
      const unsubStatus = storage.subscribe(state => {
        const session = state.sessions[sessionId];
        const status = session?.status;
        if (status === 'offline' || status === 'archived' || status === 'deleted') {
          cleanup();
          log.warn('[apiSocket] waitForDaemonReady: session went offline while waiting', {
            method,
            sessionStatus: status,
            waitMs: Date.now() - waitStart,
            // Was the socket already gone, or did it drop during the wait?
            socketConnectedAtWaitStart: socketWasConnected,
            socketConnectedNow: this.socket?.connected,
            // Last disconnect explains WHY: 'io server disconnect' = server kicked daemon,
            // 'ping timeout' / 'transport close' = daemon process died or network dropped
            lastSocketDisconnectReason: this.lastDisconnectReason,
            lastSocketDisconnectAgo: this.lastDisconnectAt ? Date.now() - this.lastDisconnectAt : null,
          });
          reject(new Error(`Session ${status}`));
        }
      });

      // Also watch for socket-level disconnects during the wait — helps distinguish
      // "daemon never came back" from "lost connection to server entirely"
      const onSocketDisconnect = (reason: string) => {
        log.warn('[apiSocket] waitForDaemonReady: socket disconnected while waiting for daemon', {
          method,
          disconnectReason: reason,
          waitMs: Date.now() - waitStart,
          socketConnectedAtWaitStart: socketWasConnected,
        });
        // Don't reject here — the status subscription will reject when session goes offline.
        // This log exists purely to add the socket disconnect reason to the trace.
      };
      currentSocket?.on('disconnect', onSocketDisconnect);

      // Safety timeout: daemon-rpc-ready may never arrive if the daemon is stuck in a
      // flash-reconnect loop. Reject after 15s so the caller can decide to fallback.
      const timeoutHandle = setTimeout(() => {
        cleanup();
        log.error('[apiSocket] waitForDaemonReady: timed out waiting for daemon', undefined, {
          method,
          waitMs: Date.now() - waitStart,
          socketConnectedAtWaitStart: socketWasConnected,
          socketConnectedNow: this.socket?.connected,
        });
        reject(new Error('daemon_ready_timeout'));
      }, 15000);

      function cleanup() {
        clearTimeout(timeoutHandle);
        listeners.delete(onReady);
        unsubStatus();
        currentSocket?.off('disconnect', onSocketDisconnect);
      }
    });
  }

  /**
   * RPC call for sessions - uses session-specific encryption.
   * On "RPC method not available" (daemon reconnecting), waits for daemon-rpc-ready
   * event instead of busy-polling, then retries once.
   */
  async sessionRPC<R, A>(sessionId: string, method: string, params: A): Promise<R> {
    const sessionEncryption = this.encryption!.getSessionEncryption(sessionId);
    if (!sessionEncryption) {
      throw new Error(`Session encryption not found for ${sessionId}`);
    }

    const request = {
      method: `${sessionId}:${method}`,
      params: await sessionEncryption.encryptRaw(params),
      _trace: getSessionTrace(sessionId),
    };

    const decryptResult = async (result: { ok: true; result: any }): Promise<R> => {
      const decrypted = (await sessionEncryption.decryptRaw(result.result)) as R | { error?: string };
      if (
        decrypted &&
        typeof decrypted === 'object' &&
        'error' in decrypted &&
        typeof decrypted.error === 'string'
      ) {
        throw new Error(decrypted.error);
      }
      return decrypted as R;
    };

    const log = sessionLogger(logger, sessionId);

    let result: any;
    try {
      result = await this.socket!.timeout(5000).emitWithAck('rpc-call', request);
    } catch (err) {
      log.error('[apiSocket] sessionRPC: socket ack timeout on first attempt', undefined, {
        method,
        socketConnected: this.socket?.connected,
        socketId: this.socket?.id,
        socketStatus: this.currentStatus,
        lastDisconnectReason: this.lastDisconnectReason,
        lastDisconnectAgo: this.lastDisconnectAt ? Date.now() - this.lastDisconnectAt : null,
        connectedDurationMs: this.lastConnectedAt ? Date.now() - this.lastConnectedAt : null,
        error: String(err),
      });
      throw err;
    }

    if (result.ok) {
      return decryptResult(result);
    }

    const errorMessage =
      typeof result.error === 'string' && result.error.length > 0 ? result.error : 'RPC call failed';

    if (errorMessage === 'RPC method not available') {
      log.warn('[apiSocket] sessionRPC target not ready, waiting for daemon-rpc-ready', {
        method,
        socketConnected: this.socket?.connected,
        socketStatus: this.currentStatus,
        lastDisconnectReason: this.lastDisconnectReason,
        lastDisconnectAgo: this.lastDisconnectAt ? Date.now() - this.lastDisconnectAt : null,
      });
      await this.waitForDaemonReady(sessionId, method);

      let retry: any;
      try {
        retry = await this.socket!.timeout(5000).emitWithAck('rpc-call', request);
      } catch (err) {
        log.error('[apiSocket] sessionRPC: socket ack timeout on retry after daemon-rpc-ready', undefined, {
          method,
          socketConnected: this.socket?.connected,
          socketId: this.socket?.id,
          socketStatus: this.currentStatus,
          lastDisconnectReason: this.lastDisconnectReason,
          lastDisconnectAgo: this.lastDisconnectAt ? Date.now() - this.lastDisconnectAt : null,
          connectedDurationMs: this.lastConnectedAt ? Date.now() - this.lastConnectedAt : null,
          error: String(err),
        });
        throw err;
      }

      if (retry.ok) {
        return decryptResult(retry);
      }
      const retryError = typeof retry.error === 'string' && retry.error.length > 0 ? retry.error : 'RPC call failed';
      log.error('[apiSocket] sessionRPC: retry after daemon-rpc-ready still failed', undefined, {
        method,
        error: retryError,
        socketConnected: this.socket?.connected,
        socketStatus: this.currentStatus,
      });
      throw new Error(retryError);
    }

    throw new Error(errorMessage);
  }

  /**
   * RPC call for machines - uses legacy/global encryption (for now)
   */
  async machineRPC<R, A>(machineId: string, method: string, params: A): Promise<R> {
    const machineEncryption = this.encryption!.getMachineEncryption(machineId);
    if (!machineEncryption) {
      throw new Error(`Machine encryption not found for ${machineId}`);
    }

    const result = await this.socket!.emitWithAck('rpc-call', {
      method: `${machineId}:${method}`,
      params: await machineEncryption.encryptRaw(params),
      _trace: getSessionTrace(machineId),
    });

    if (result.ok) {
      const decrypted = (await machineEncryption.decryptRaw(result.result)) as
        | R
        | { error?: string };
      if (
        decrypted &&
        typeof decrypted === 'object' &&
        'error' in decrypted &&
        typeof decrypted.error === 'string'
      ) {
        throw new Error(decrypted.error);
      }
      return decrypted as R;
    }
    throw new Error(
      typeof result.error === 'string' && result.error.length > 0 ? result.error : 'RPC call failed'
    );
  }

  send(event: string, data: any) {
    const sessionId = data?.sessionId ?? data?.sid;
    const trace = sessionId ? getSessionTrace(sessionId) : undefined;
    this.socket!.emit(event, trace ? { ...data, _trace: trace } : data);
    return true;
  }

  async emitWithAck<T = any>(event: string, data: any): Promise<T> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    const sessionId = data?.sessionId ?? data?.sid;
    const trace = sessionId ? getSessionTrace(sessionId) : undefined;
    return await this.socket.emitWithAck(event, trace ? { ...data, _trace: trace } : data);
  }

  async emitWithAckTimeout<T = any>(event: string, data: any, timeoutMs: number): Promise<T> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    const sessionId = data?.sessionId ?? data?.sid;
    const trace = sessionId ? getSessionTrace(sessionId) : undefined;
    return await this.socket.timeout(timeoutMs).emitWithAck(event, trace ? { ...data, _trace: trace } : data);
  }

  //
  // HTTP Requests
  //

  async request(path: string, options?: RequestInit): Promise<Response> {
    if (!this.config) {
      throw new Error('SyncSocket not initialized');
    }

    const credentials = await TokenStorage.getCredentials();
    if (!credentials) {
      throw new Error('No authentication credentials');
    }

    const url = `${this.config.endpoint}${path}`;
    const headers = {
      Authorization: `Bearer ${credentials.token}`,
      ...options?.headers,
    };

    return fetch(url, {
      ...options,
      headers,
    });
  }

  //
  // Token Management
  //

  updateToken(newToken: string) {
    if (this.config && this.config.token !== newToken) {
      this.config.token = newToken;

      if (this.socket) {
        this.disconnect();
        this.connect();
      }
    }
  }

  refreshReconnectAuth() {
    if (!this.socket || !this.lastSeqsProvider) {
      return;
    }
    const freshSeqs = this.lastSeqsProvider();
    if (Object.keys(freshSeqs).length > 0) {
      (this.socket.auth as Record<string, unknown>).lastSeqs = freshSeqs;
    } else {
      delete (this.socket.auth as Record<string, unknown>).lastSeqs;
    }
  }

  setReconnectMode(mode: ReconnectMode) {
    if (this.reconnectMode === mode) {
      return;
    }

    this.reconnectMode = mode;
    if (!this.socket) {
      return;
    }

    const delay = RECONNECT_DELAYS[mode];
    const manager = this.socket.io as unknown as {
      reconnectionDelay?: (value: number) => unknown;
      reconnectionDelayMax?: (value: number) => unknown;
      opts?: Record<string, unknown>;
    };

    manager.reconnectionDelay?.(delay.min);
    manager.reconnectionDelayMax?.(delay.max);
    if (manager.opts) {
      manager.opts.reconnectionDelay = delay.min;
      manager.opts.reconnectionDelayMax = delay.max;
    }

    logger.info('[SyncSocket] Updated reconnect mode', {
      mode,
      reconnectionDelay: delay.min,
      reconnectionDelayMax: delay.max,
      connected: this.socket.connected,
    });
  }

  //
  // Private Methods
  //

  private updateStatus(status: 'disconnected' | 'connecting' | 'connected' | 'error') {
    if (this.currentStatus !== status) {
      this.currentStatus = status;
      this.statusListeners.forEach(listener => listener(status));
    }
  }

  private setupEventHandlers() {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      this.lastConnectedAt = Date.now();
      logger.info('[SyncSocket] Connected', {
        recovered: this.socket?.recovered,
        socketId: this.socket?.id,
        prevDisconnectReason: this.lastDisconnectReason,
        prevDisconnectAgo: this.lastDisconnectAt ? Date.now() - this.lastDisconnectAt : null,
      });
      // RFC-010 §3.3: Update lastSeqs for next reconnection attempt so the
      // server replays only messages missed since the most recent seq we know.
      this.refreshReconnectAuth();
      // Daemon re-registers its RPC methods on every connect — stale ready signals are invalid
      this.daemonReadySessions.clear();
      this.updateStatus('connected');
      if (!this.socket?.recovered) {
        this.reconnectedListeners.forEach(listener => listener());
      }
    });

    this.socket.on('disconnect', reason => {
      const connectedDurationMs = this.lastConnectedAt ? Date.now() - this.lastConnectedAt : null;
      this.lastDisconnectReason = reason;
      this.lastDisconnectAt = Date.now();
      logger.info('[SyncSocket] Disconnected', {
        reason,
        connectedDurationMs,
        // 'io server disconnect' = server kicked us (auth expiry, server restart, etc.)
        // 'ping timeout'        = network issue or server overloaded
        // 'transport close'     = TCP/WS connection dropped
        // 'transport error'     = network error during transport
        // 'io client disconnect'= client called disconnect() intentionally
      });
      this.updateStatus('disconnected');
    });

    // Error events
    this.socket.on('connect_error', error => {
      logger.warn('[SyncSocket] Connection error', { error: safeStringify(error) });
      this.updateStatus('error');
    });

    this.socket.on('error', (error: any) => {
      const message =
        typeof error === 'object' && error !== null && 'message' in error
          ? typeof error.message === 'string'
            ? error.message
            : safeStringify(error)
          : safeStringify(error);
      const isAuthError =
        message.includes('authentication') ||
        message.includes('token') ||
        message.includes('auth');

      if (isAuthError) {
        logger.error('[SyncSocket] Auth error — stopping reconnection', { message });
        // Stop reconnection to avoid infinite connect→reject→reconnect loop
        this.socket?.disconnect();
        this.socket = null;
        this.updateStatus('error');
        this.authErrorListeners.forEach(l => l(message));
      } else {
        logger.error('[SyncSocket] Error', toError(error));
        this.updateStatus('error');
      }
    });

    // Daemon RPC ready notifications
    this.socket.on('daemon-rpc-ready', ({ sessionId }: { sessionId: string }) => {
      const listeners = this.daemonReadyListeners.get(sessionId);
      if (listeners && listeners.size > 0) {
        listeners.forEach(cb => cb());
        this.daemonReadyListeners.delete(sessionId);
      } else {
        // No one waiting yet — record that ready arrived so waitForDaemonReady can fast-path
        this.daemonReadySessions.add(sessionId);
      }
    });

    // Message handling
    this.socket.onAny((event, data) => {
      // logger.debug(`📥 SyncSocket: Received event '${event}':`, JSON.stringify(data).substring(0, 200));
      const handler = this.messageHandlers.get(event);
      if (handler) {
        // logger.debug(`📥 SyncSocket: Calling handler for '${event}'`);
        handler(data);
      } else {
        // logger.debug(`📥 SyncSocket: No handler registered for '${event}'`);
      }
    });
  }
}

//
// Singleton Export
//

export const apiSocket = new ApiSocket();
