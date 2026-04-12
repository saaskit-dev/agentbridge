import { createAdapter } from '@socket.io/postgres-adapter';
import { Pool } from 'pg';
import { sendSilentReconnectPush } from '@/app/push/pushSender';
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
import { attachmentHandler } from './socket/attachmentHandler';
import { replayMissedMessages } from './socket/replayHandler';
import {
  buildMachineRoom,
  buildSessionRoom,
  buildUserRoom,
  hasRemainingConnections,
} from './socket/connectionRooms';
import { Fastify } from './types';
import { auth } from '@/app/auth/auth';
import {
  buildMachineActivityEphemeral,
  buildSessionActivityEphemeral,
  ClientConnection,
  eventRouter,
} from '@/app/events/eventRouter';
import { Logger, continueTrace, createTrace } from '@saaskit-dev/agentbridge/telemetry';
import { runWithTrace } from '@/utils/requestTrace';
import {
  onShutdown,
  SHUTDOWN_PHASE,
  shouldDrainWebSocketsGracefully,
} from '@/utils/shutdown';
import { db } from '@/storage/db';
import { delay } from '@/utils/delay';
import { productionCorsOrigins } from './cors';

const log = new Logger('app/api/socket');
const SERVER_DRAIN_BROADCAST_MS = 1500;

// Track in-flight disconnect DB operations so the APP phase can drain them
// before the STORAGE phase closes PGlite.
const inFlightDisconnects = new Set<Promise<void>>();

export async function startSocket(app: Fastify) {
  const io = new Server(app.server, {
    cors: {
      origin: process.env.APP_ENV === 'development' ? true : productionCorsOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id', 'X-Socket-Id'],
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 45000,
    pingInterval: 15000,
    path: '/v1/updates',
    allowUpgrades: true,
    upgradeTimeout: 10000,
    connectTimeout: 20000,
    serveClient: false, // Don't serve the client files
    // Required for binary image uploads from the App (up to 8 MB post-compression + protocol overhead)
    maxHttpBufferSize: 10 * 1024 * 1024,
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
      log.error(`Failed to initialize PostgreSQL adapter: ${error}`);
    }
  } else {
    log.info('Running in single-instance mode (PGlite or no external PostgreSQL)');
  }

  const rpcListeners = new Map<string, Map<string, Socket>>();
  io.on('connection', async socket => {
    log.debug(`New connection attempt from socket: ${socket.id}`);
    const token = socket.handshake.auth.token as string;
    const clientType = socket.handshake.auth.clientType as
      | 'session-scoped'
      | 'user-scoped'
      | 'machine-scoped'
      | undefined;
    const sessionId = socket.handshake.auth.sessionId as string | undefined;
    const machineId = socket.handshake.auth.machineId as string | undefined;
    const isDaemon = socket.handshake.auth.isDaemon === true;

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
      log.warn('Socket auth failed — invalid token', {
        clientType,
        sessionId: sessionId ?? 'none',
        machineId: machineId ?? 'none',
        tokenSuffix: token.slice(-12),
      });
      socket.emit('error', { message: 'Invalid authentication token' });
      socket.disconnect();
      return;
    }

    const userId = verified.userId;
    log.info(
      `Token verified: ${userId}, clientType: ${clientType || 'user-scoped'}, sessionId: ${sessionId || 'none'}, machineId: ${machineId || 'none'}, socketId: ${socket.id}`
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
        isDaemon,
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
    await socket.join(buildUserRoom(userId));
    if (connection.connectionType === 'session-scoped') {
      await socket.join(buildSessionRoom(userId, connection.sessionId));
    } else if (connection.connectionType === 'machine-scoped') {
      await socket.join(buildMachineRoom(userId, connection.machineId));
    }

    // Broadcast daemon online status
    if (connection.connectionType === 'machine-scoped') {
      // Broadcast daemon online
      const machineActivity = buildMachineActivityEphemeral(machineId!, true, Date.now());
      eventRouter.emitEphemeral({
        userId,
        payload: machineActivity,
        recipientFilter: { type: 'user-scoped-only' },
      });
      log.debug('[connect] machine online broadcast', { userId, machineId: machineId });
    }

    socket.on('disconnect', reason => {
      websocketEventsCounter.inc({ event_type: 'disconnect' });

      // Cleanup connections
      eventRouter.removeConnection(userId, connection);
      decrementWebSocketConnection(connection.connectionType);

      log.info(`User disconnected: ${userId}`);
      log.info('[disconnect] connection removed', {
        userId,
        connectionType: connection.connectionType,
        socketId: socket.id,
        reason,
        ...(connection.connectionType === 'session-scoped'
          ? { sessionId: connection.sessionId, isDaemon: connection.isDaemon === true }
          : {}),
        ...(connection.connectionType === 'machine-scoped'
          ? { machineId: connection.machineId }
          : {}),
      });

      const work = (async () => {
        const t0 = Date.now();
        const gracefulDrain = shouldDrainWebSocketsGracefully();
        log.debug('[disconnect] db-write start', {
          userId,
          connectionType: connection.connectionType,
          gracefulDrain,
        });

        if (gracefulDrain) {
          log.info('[disconnect] server draining, skipping disconnect side-effects', {
            userId,
            connectionType: connection.connectionType,
            socketId: socket.id,
            reason,
            ...(connection.connectionType === 'session-scoped'
              ? { sessionId: connection.sessionId }
              : {}),
            ...(connection.connectionType === 'machine-scoped'
              ? { machineId: connection.machineId }
              : {}),
          });
          return;
        }

        // Broadcast daemon offline status and update database
        if (connection.connectionType === 'machine-scoped') {
          const hasRemainingMachineConnection = await hasRemainingConnections(
            io,
            buildMachineRoom(userId, connection.machineId)
          );
          if (hasRemainingMachineConnection) {
            log.info('[disconnect] machine still connected elsewhere, skipping inactive transition', {
              userId,
              machineId: connection.machineId,
              socketId: socket.id,
              reason,
            });
            return;
          }

          const now = Date.now();
          // Update database
          try {
            await db.machine.updateMany({
              where: {
                accountId: userId,
                id: connection.machineId,
              },
              data: { active: false, lastActiveAt: new Date(now) },
            });
            log.debug('[disconnect] machine marked inactive', {
              userId,
              machineId: connection.machineId,
            });
          } catch (error) {
            log.error(`[disconnect] error updating machine active status: ${error}`);
          }
          // Broadcast ephemeral event
          const machineActivity = buildMachineActivityEphemeral(connection.machineId, false, now);
          eventRouter.emitEphemeral({
            userId,
            payload: machineActivity,
            recipientFilter: { type: 'user-scoped-only' },
          });
        }

        // Broadcast session offline status and update database
        if (connection.connectionType === 'session-scoped') {
          const hasRemainingSessionConnection = await hasRemainingConnections(
            io,
            buildSessionRoom(userId, connection.sessionId)
          );
          if (hasRemainingSessionConnection) {
            log.info('[disconnect] session still connected elsewhere, skipping offline transition', {
              userId,
              sessionId: connection.sessionId,
              socketId: socket.id,
              reason,
            });
            return;
          }

          const now = Date.now();
          // Update database
          try {
            await db.session.updateMany({
              where: {
                id: connection.sessionId,
                accountId: userId,
              },
              data: { status: 'offline', lastActiveAt: new Date(now) },
            });
            log.debug('[disconnect] session marked offline', {
              userId,
              sessionId: connection.sessionId,
            });
          } catch (error) {
            log.error(`[disconnect] error updating session active status: ${error}`);
          }
          // Broadcast ephemeral event
          const sessionActivity = buildSessionActivityEphemeral(
            connection.sessionId,
            false,
            now,
            false
          );
          eventRouter.emitEphemeral({
            userId,
            payload: sessionActivity,
            recipientFilter: { type: 'user-scoped-only' },
          });
        }

        if (connection.connectionType === 'user-scoped') {
          const isUnexpected = reason === 'transport close' || reason === 'ping timeout';
          if (isUnexpected) {
            log.info('[disconnect] user-scoped connection dropped unexpectedly, attempting reconnect push', {
              userId,
              socketId: socket.id,
              reason,
            });
            await sendSilentReconnectPush(userId);
          }
        }

        log.debug('[disconnect] db-write done', {
          userId,
          connectionType: connection.connectionType,
          ms: Date.now() - t0,
        });
      })().catch(error => {
        log.error('[disconnect] unexpected async error', {
          userId,
          connectionType: connection.connectionType,
          error: String(error),
        });
      });

      inFlightDisconnects.add(work);
      work.finally(() => inFlightDisconnects.delete(work));
    });

    // Propagate _trace from incoming socket events into AsyncLocalStorage so every
    // Logger call inside any handler automatically carries the traceId.
    // This runs before ALL event handlers on this socket — no per-handler changes needed.
    //
    // For session-scoped connections, also inject the connection-level sessionId so that
    // events without a _trace (e.g. heartbeats) still get sessionId in their log entries,
    // making all server-side logs searchable by sessionId in New Relic (same field as daemon).
    const connectionSessionId =
      connection.connectionType === 'session-scoped' ? connection.sessionId : undefined;
    socket.use(([_event, data], next) => {
      const wire = data && typeof data === 'object' ? (data as any)._trace : undefined;
      if (wire && typeof wire.tid === 'string') {
        const ctx = continueTrace({
          traceId: wire.tid,
          sessionId: wire.ses ?? connectionSessionId,
          ...(wire.mid ? { machineId: wire.mid } : {}),
        });
        runWithTrace(ctx, next);
      } else if (connectionSessionId) {
        const ctx = createTrace({ sessionId: connectionSessionId });
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
    attachmentHandler(userId, socket, connection);

    // Replay missed messages after reconnection (RFC-010 §3.3)
    replayMissedMessages(userId, socket, connection).catch(error => {
      log.error('[replay] error during missed message replay', { userId, error: String(error) });
    });

    // Ready
    log.info(`User connected: ${userId}`);
  });

  onShutdown(
    'socket.io',
    async () => {
      log.info('[shutdown] socket.io close: start');
      if (shouldDrainWebSocketsGracefully()) {
        const connectedSockets = io.sockets.sockets.size;
        log.info('[shutdown] socket.io drain: notifying clients', {
          connectedSockets,
          reconnectAfterMs: SERVER_DRAIN_BROADCAST_MS,
        });
        io.emit('server-draining', {
          reason: 'server-restart',
          reconnectAfterMs: SERVER_DRAIN_BROADCAST_MS,
          startedAt: Date.now(),
        });
        await delay(SERVER_DRAIN_BROADCAST_MS);
      }
      await io.close();
      log.info('[shutdown] socket.io close: done');
    },
    SHUTDOWN_PHASE.NETWORK
  );

  // Wait for all in-flight disconnect DB writes before DB closes (Phase 2).
  onShutdown('socket.io-disconnect-drain', async () => {
    const count = inFlightDisconnects.size;
    log.info(`[shutdown] disconnect-drain: waiting for ${count} in-flight disconnect handlers`);
    if (count > 0) {
      await Promise.all([...inFlightDisconnects]);
    }
    log.info('[shutdown] disconnect-drain: done');
  });
}
