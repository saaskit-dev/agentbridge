import { createAdapter } from '@socket.io/postgres-adapter';
import { Pool } from 'pg';
import { Server, Socket } from 'socket.io';
import {
  decrementWebSocketConnection,
  incrementWebSocketConnection,
  websocketEventsCounter,
} from '../monitoring/metrics2';
import { rpcHandler } from './socket/rpcHandler';
import { pingHandler } from './socket/pingHandler';
import { sessionUpdateHandler } from './socket/sessionUpdateHandler';
import { machineUpdateHandler } from './socket/machineUpdateHandler';
import { artifactUpdateHandler } from './socket/artifactUpdateHandler';
import { accessKeyHandler } from './socket/accessKeyHandler';
import { streamingHandler } from './socket/streamingHandler';
import { usageHandler } from './socket/usageHandler';
import { Fastify } from './types';
import { auth } from '@/app/auth/auth';
import {
  buildMachineActivityEphemeral,
  ClientConnection,
  eventRouter,
} from '@/app/events/eventRouter';
import { Logger, continueTrace } from '@agentbridge/core/telemetry';
import { runWithTrace } from '@/utils/requestTrace';
import { onShutdown } from '@/utils/shutdown';

const log = new Logger('app/api/socket');
export async function startSocket(app: Fastify) {
  const io = new Server(app.server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      credentials: true,
      allowedHeaders: ['*'],
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 45000,
    pingInterval: 15000,
    path: '/v1/updates',
    allowUpgrades: true,
    upgradeTimeout: 10000,
    connectTimeout: 20000,
    serveClient: false, // Don't serve the client files
  });

  // Enable PostgreSQL adapter for multi-instance support (only when using external PostgreSQL)
  // PGlite doesn't support LISTEN/NOTIFY for cross-process communication
  if (process.env.DATABASE_URL && !process.env.PGLITE_DIR) {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });
      io.adapter(createAdapter(pool));
      log.info('PostgreSQL adapter enabled for multi-instance support');
    } catch (error) {
      log.error(`Failed to initialize PostgreSQL adapter: ${error}`
      );
    }
  } else {
    log.info('Running in single-instance mode (PGlite or no external PostgreSQL)'
    );
  }

  const rpcListeners = new Map<string, Map<string, Socket>>();
  io.on('connection', async socket => {
    log.debug(`New connection attempt from socket: ${socket.id}`
    );
    const token = socket.handshake.auth.token as string;
    const clientType = socket.handshake.auth.clientType as
      | 'session-scoped'
      | 'user-scoped'
      | 'machine-scoped'
      | undefined;
    const sessionId = socket.handshake.auth.sessionId as string | undefined;
    const machineId = socket.handshake.auth.machineId as string | undefined;

    if (!token) {
      log.debug(`No token provided`);
      socket.emit('error', { message: 'Missing authentication token' });
      socket.disconnect();
      return;
    }

    // Validate session-scoped clients have sessionId
    if (clientType === 'session-scoped' && !sessionId) {
      log.debug(`Session-scoped client missing sessionId`);
      socket.emit('error', { message: 'Session ID required for session-scoped clients' });
      socket.disconnect();
      return;
    }

    // Validate machine-scoped clients have machineId
    if (clientType === 'machine-scoped' && !machineId) {
      log.debug(`Machine-scoped client missing machineId`);
      socket.emit('error', { message: 'Machine ID required for machine-scoped clients' });
      socket.disconnect();
      return;
    }

    const verified = await auth.verifyToken(token);
    if (!verified) {
      log.debug(`Invalid token provided`);
      socket.emit('error', { message: 'Invalid authentication token' });
      socket.disconnect();
      return;
    }

    const userId = verified.userId;
    log.info(`Token verified: ${userId}, clientType: ${clientType || 'user-scoped'}, sessionId: ${sessionId || 'none'}, machineId: ${machineId || 'none'}, socketId: ${socket.id}`
    );

    // Store connection based on type
    const metadata = { clientType: clientType || 'user-scoped', sessionId, machineId };
    let connection: ClientConnection;
    if (metadata.clientType === 'session-scoped' && sessionId) {
      connection = {
        connectionType: 'session-scoped',
        socket,
        userId,
        sessionId,
      };
    } else if (metadata.clientType === 'machine-scoped' && machineId) {
      connection = {
        connectionType: 'machine-scoped',
        socket,
        userId,
        machineId,
      };
    } else {
      connection = {
        connectionType: 'user-scoped',
        socket,
        userId,
      };
    }
    eventRouter.addConnection(userId, connection);
    incrementWebSocketConnection(connection.connectionType);

    // Broadcast daemon online status
    if (connection.connectionType === 'machine-scoped') {
      // Broadcast daemon online
      const machineActivity = buildMachineActivityEphemeral(machineId!, true, Date.now());
      eventRouter.emitEphemeral({
        userId,
        payload: machineActivity,
        recipientFilter: { type: 'user-scoped-only' },
      });
    }

    socket.on('disconnect', () => {
      websocketEventsCounter.inc({ event_type: 'disconnect' });

      // Cleanup connections
      eventRouter.removeConnection(userId, connection);
      decrementWebSocketConnection(connection.connectionType);

      log.info(`User disconnected: ${userId}`);

      // Broadcast daemon offline status
      if (connection.connectionType === 'machine-scoped') {
        const machineActivity = buildMachineActivityEphemeral(
          connection.machineId,
          false,
          Date.now()
        );
        eventRouter.emitEphemeral({
          userId,
          payload: machineActivity,
          recipientFilter: { type: 'user-scoped-only' },
        });
      }
    });

    // Propagate _trace from incoming socket events into AsyncLocalStorage so every
    // Logger call inside any handler automatically carries the traceId.
    // This runs before ALL event handlers on this socket — no per-handler changes needed.
    socket.use(([_event, data], next) => {
      const wire = data && typeof data === 'object' ? (data as any)._trace : undefined;
      if (wire && typeof wire.tid === 'string' && typeof wire.sid === 'string') {
        const ctx = continueTrace({
          traceId: wire.tid,
          spanId: wire.sid,
          ...(wire.ses ? { sessionId: wire.ses } : {}),
          ...(wire.mid ? { machineId: wire.mid } : {}),
        });
        runWithTrace(ctx, next);
      } else {
        next();
      }
    });

    // Handlers
    let userRpcListeners = rpcListeners.get(userId);
    if (!userRpcListeners) {
      userRpcListeners = new Map<string, Socket>();
      rpcListeners.set(userId, userRpcListeners);
    }
    rpcHandler(userId, socket, userRpcListeners);
    usageHandler(userId, socket);
    sessionUpdateHandler(userId, socket, connection);
    pingHandler(socket);
    machineUpdateHandler(userId, socket);
    artifactUpdateHandler(userId, socket);
    accessKeyHandler(userId, socket);
    streamingHandler(userId, socket, connection);
    // Ready
    log.info(`User connected: ${userId}`);
  });

  onShutdown('api', async () => {
    await io.close();
  });
}
