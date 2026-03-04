/**
 * Socket.IO client implementation
 *
 * Note: socket.io-client is a peer dependency. Make sure to install it:
 * npm install socket.io-client
 */

import type { IWebSocketClient, WebSocketClientOptions } from '../../interfaces/websocket';
import { registerWebSocketClientFactory } from '../../interfaces/websocket';

// Dynamic import to handle optional peer dependency
let io: typeof import('socket.io-client').io | null = null;

async function getIo() {
  if (!io) {
    try {
      io = (await import('socket.io-client')).io;
    } catch {
      throw new Error('socket.io-client is not installed. Run: npm install socket.io-client');
    }
  }
  return io;
}

/**
 * Socket.IO client implementation
 */
class SocketIoClient implements IWebSocketClient {
  private socket: ReturnType<typeof import('socket.io-client').io> | null = null;
  private connected = false;

  async connect(url: string, options?: WebSocketClientOptions): Promise<void> {
    const ioFn = await getIo();

    this.socket = ioFn(url, {
      auth: options?.auth,
      transports: options?.transports ?? ['websocket'],
      path: options?.path,
      timeout: options?.timeout,
    });

    return new Promise((resolve, reject) => {
      this.socket!.on('connect', () => {
        this.connected = true;
        resolve();
      });

      this.socket!.on('connect_error', (err: Error) => {
        reject(err);
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  emit(event: string, data: unknown): void {
    if (!this.socket) {
      throw new Error('Not connected');
    }
    this.socket.emit(event, data);
  }

  on(event: string, handler: (data: unknown) => void): void {
    if (!this.socket) {
      throw new Error('Not connected');
    }
    this.socket.on(event, handler);
  }

  off(event: string, handler?: (data: unknown) => void): void {
    if (!this.socket) {
      return;
    }
    if (handler) {
      this.socket.off(event, handler);
    } else {
      this.socket.off(event);
    }
  }

  async emitWithAck(event: string, data: unknown, timeout?: number): Promise<unknown> {
    if (!this.socket) {
      throw new Error('Not connected');
    }
    const timeoutMs = timeout ?? 30000;
    return this.socket.timeout(timeoutMs).emitWithAck(event, data);
  }

  isConnected(): boolean {
    return this.connected && this.socket?.connected === true;
  }

  id(): string | undefined {
    return this.socket?.id;
  }
}

// Register factory
registerWebSocketClientFactory('socketio', () => new SocketIoClient());

// Export for direct use
export { SocketIoClient };
