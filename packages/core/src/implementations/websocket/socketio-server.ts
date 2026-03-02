/**
 * Socket.IO server implementation
 * 
 * Note: socket.io is a peer dependency. Make sure to install it:
 * npm install socket.io
 */

import type { Server, Socket } from 'socket.io';
import type {
  IWebSocketServer,
  WebSocketServerOptions,
  ISocket,
} from '../../interfaces/websocket';
import { registerWebSocketServerFactory } from '../../interfaces/websocket';

// Dynamic import to handle optional peer dependency
let ServerClass: typeof Server | null = null;

async function getServerClass() {
  if (!ServerClass) {
    try {
      ServerClass = (await import('socket.io')).Server;
    } catch {
      throw new Error('socket.io is not installed. Run: npm install socket.io');
    }
  }
  return ServerClass;
}

/**
 * Socket wrapper for server-side connections
 */
class SocketIoSocket implements ISocket {
  private rawSocket: any;

  constructor(socket: any) {
    this.rawSocket = socket;
  }

  get id(): string {
    return this.rawSocket.id;
  }

  get data(): Record<string, unknown> {
    return this.rawSocket.data ?? {};
  }

  set data(value: Record<string, unknown>) {
    this.rawSocket.data = value;
  }

  emit(event: string, data: unknown): void {
    this.rawSocket.emit(event, data);
  }

  on(event: string, handler: (data: unknown) => void): void {
    this.rawSocket.on(event, handler);
  }

  disconnect(): void {
    this.rawSocket.disconnect();
  }

  timeout(ms: number): { emitWithAck(event: string, data: unknown): Promise<unknown> } {
    return this.rawSocket.timeout(ms);
  }

  join(room: string): void {
    this.rawSocket.join(room);
  }

  leave(room: string): void {
    this.rawSocket.leave(room);
  }
}

/**
 * Socket.IO server implementation
 */
class SocketIoServer implements IWebSocketServer {
  private io: Server | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private httpServer: any = null;

  constructor(private options?: WebSocketServerOptions) {}

  attach(httpServer: unknown): void {
    this.httpServer = httpServer;
  }

  private async ensureServer(): Promise<Server> {
    if (!this.io) {
      const Server = await getServerClass();
      this.io = new Server(this.httpServer, {
        path: this.options?.path,
        pingTimeout: this.options?.pingTimeout,
        pingInterval: this.options?.pingInterval,
      });
    }
    return this.io;
  }

  async start(port: number): Promise<void> {
    const io = await this.ensureServer();
    if (!this.httpServer) {
      // If no http server attached, listen directly
      io.listen(port);
    }
  }

  async stop(): Promise<void> {
    if (this.io) {
      this.io.close();
      this.io = null;
    }
  }

  onConnection(handler: (socket: ISocket) => void): void {
    this.ensureServer().then((io) => {
      io.on('connection', (rawSocket: Socket) => {
        handler(new SocketIoSocket(rawSocket));
      });
    });
  }

  emit(event: string, data: unknown): void {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  to(room: string): { emit(event: string, data: unknown): void } {
    if (this.io) {
      return {
        emit: (event: string, data: unknown) => {
          this.io!.to(room).emit(event, data);
        },
      };
    }
    return {
      emit: () => {},
    };
  }

  in(room: string): ISocket[] {
    if (!this.io) {
      return [];
    }
    const sockets = this.io.sockets.adapter.rooms.get(room);
    if (!sockets) {
      return [];
    }
    return Array.from(sockets)
      .map((id) => this.io!.sockets.sockets.get(id))
      .filter((s) => s !== undefined)
      .map((s) => new SocketIoSocket(s));
  }
}

// Register factory
registerWebSocketServerFactory('socketio', (options) => new SocketIoServer(options));

// Export for direct use
export { SocketIoClient } from './socketio-client';
export { SocketIoServer, SocketIoSocket };
