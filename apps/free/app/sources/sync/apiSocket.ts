import { io, Socket } from 'socket.io-client';
import { Encryption } from './encryption/encryption';
import { TokenStorage } from '@/auth/tokenStorage';
import { getSessionTrace } from './appTraceStore';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
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

  getStatus(): 'disconnected' | 'connecting' | 'connected' | 'error' {
    return this.currentStatus;
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
    // eslint-disable-next-line no-console
    console.warn('[DEV-DIAG] SyncSocket connecting to:', this.config.endpoint);

    this.socket = io(this.config.endpoint, {
      path: '/v1/updates',
      auth: {
        token: this.config.token,
        clientType: 'user-scoped' as const,
      },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });

    this.setupEventHandlers();
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
   * RPC call for sessions - uses session-specific encryption
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

    let lastError: Error | null = null;
    const MAX_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const result = await this.socket!.emitWithAck('rpc-call', request);

      if (result.ok) {
        const decrypted = (await sessionEncryption.decryptRaw(result.result)) as
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

      const errorMessage =
        typeof result.error === 'string' && result.error.length > 0
          ? result.error
          : 'RPC call failed';
      lastError = new Error(errorMessage);

      // Freshly created sessions can briefly race session-scoped RPC registration.
      if (errorMessage === 'RPC method not available' && attempt < MAX_RETRIES - 1) {
        logger.warn('[apiSocket] sessionRPC target not ready, retrying', {
          sessionId,
          method,
          attempt: attempt + 1,
        });
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }

      throw lastError;
    }

    throw lastError ?? new Error('RPC call failed');
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
      // eslint-disable-next-line no-console
      console.warn('[DEV-DIAG] SyncSocket CONNECTED, id:', this.socket?.id);
      logger.info('[SyncSocket] Connected', {
        recovered: this.socket?.recovered,
        socketId: this.socket?.id,
      });
      this.updateStatus('connected');
      if (!this.socket?.recovered) {
        this.reconnectedListeners.forEach(listener => listener());
      }
    });

    this.socket.on('disconnect', reason => {
      // eslint-disable-next-line no-console
      console.warn('[DEV-DIAG] SyncSocket DISCONNECTED, reason:', reason);
      logger.info('[SyncSocket] Disconnected', { reason });
      this.updateStatus('disconnected');
    });

    // Error events
    this.socket.on('connect_error', error => {
      // eslint-disable-next-line no-console
      console.warn('[DEV-DIAG] SyncSocket connect_error:', String(error));
      logger.warn('[SyncSocket] Connection error', { error: String(error) });
      this.updateStatus('error');
    });

    this.socket.on('error', (error: any) => {
      const message = typeof error === 'object' ? error?.message ?? String(error) : String(error);
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
