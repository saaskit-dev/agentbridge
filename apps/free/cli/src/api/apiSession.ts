import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { io, Socket } from 'socket.io-client';
import { registerCommonHandlers } from '../modules/common/registerCommonHandlers';
import { decryptFromWireString, encryptToWireString } from './encryption';
import { RpcHandlerManager } from './rpc/RpcHandlerManager';
import {
  AgentState,
  ClientToServerEvents,
  Metadata,
  ServerToClientEvents,
  Session,
  Update,
  UserMessage,
  UserMessageSchema,
  Usage,
} from './types';
import { configuration } from '@/configuration';
import type { NormalizedMessage } from '@/daemon/sessions/types';
import { setCurrentTurnTrace, getProcessTraceContext } from '@/telemetry';
import { continueTrace, resumeTrace, injectTrace } from '@saaskit-dev/agentbridge/telemetry';
import type { WireTrace } from './types';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { AsyncLock } from '@/utils/lock';
import { calculateCost } from '@/utils/pricing';
import { InvalidateSync } from '@/utils/sync';
import { backoff, delay } from '@/utils/time';
import type { SessionEnvelope } from '@/sessionProtocol/types';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';
import {
  loadPendingSessionOutbox,
  persistPendingSessionOutbox,
  type PendingOutboxPlaceholder,
} from './sessionOutboxPersistence';

const logger = new Logger('api/apiSession');

/** Race a promise against a timeout. Rejects with an Error if the timeout fires first. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Timeout for socket.emitWithAck calls (ms). */
const ACK_TIMEOUT = 30_000;

/** Extract current process trace context as a WireTrace for socket emits. */
function getWireTrace(): WireTrace | undefined {
  const ctx = getProcessTraceContext();
  if (!ctx) return undefined;
  const obj: Record<string, unknown> = {};
  injectTrace(ctx, obj);
  return obj._trace as WireTrace | undefined;
}
type V3SessionMessage = {
  id: string;
  seq: number;
  content: { t: 'encrypted'; c: string };
  /** RFC §19.3: traceId stored in DB for HTTP sync path trace correlation. */
  traceId?: string;
  createdAt: number;
  updatedAt: number;
};

type PendingOutboxMessage = { content: string; id: string; _trace?: WireTrace };

type PlannedReconnectState = {
  reason: 'server-restart';
  reconnectAfterMs: number;
  startedAt: number;
  deadline: number;
  promise: Promise<void>;
  resolve: () => void;
  timer: NodeJS.Timeout;
};

function decodeUserId(token: string): string | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    return typeof decoded.sub === 'string' ? decoded.sub : undefined;
  } catch {
    return undefined;
  }
}

export class ApiSessionClient extends EventEmitter {
  private readonly token: string;
  private readonly userId: string | undefined;
  readonly sessionId: string;
  private metadata: Metadata | null;
  private metadataVersion: number;
  private agentState: AgentState | null;
  private agentStateVersion: number;
  private capabilities: SessionCapabilities | null;
  private capabilitiesVersion: number;
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private pendingMessages: UserMessage[] = [];
  private pendingMessageCallback: ((message: UserMessage) => void) | null = null;
  private fileTransferCallback:
    | ((payload: { id: string; data: Buffer; mimeType: string; filename?: string }, ack: (result: { ok: boolean }) => void) => void)
    | null = null;
  private fetchAttachmentCallback:
    | ((payload: { id: string; mimeType: string }, ack: (result: { ok: boolean; data?: Buffer; mimeType?: string; error?: string }) => void) => void)
    | null = null;
  readonly rpcHandlerManager: RpcHandlerManager;
  private agentStateLock = new AsyncLock();
  private metadataLock = new AsyncLock();
  private capabilitiesLock = new AsyncLock();
  private encryptionKey: Uint8Array;
  private encryptionVariant: 'legacy' | 'dataKey';
  private lastSeq: number;
  /** True until the first successful connection completes. */
  private isFirstConnect = true;
  private lastConnectedAt: number | null = null;
  private lastDisconnectAt: number | null = null;
  private lastDisconnectReason: string | null = null;
  /** Set by `connect` handler, consumed by `replay` handler.
   *  'recovery' — first connect after creation: only update lastSeq, don't route
   *  'reconnect' — subsequent connect: decrypt and route messages normally */
  private nextReplayMode: 'recovery' | 'reconnect' = 'recovery';
  private pendingOutbox: PendingOutboxMessage[] = [];
  private pendingOutboxRestoreWarnings: PendingOutboxPlaceholder[] = [];
  private readonly sendSync: InvalidateSync;
  private readonly receiveSync: InvalidateSync;
  private readonly outboxPersistenceLock = new AsyncLock();
  private readonly outboxReady: Promise<void>;
  private plannedReconnect: PlannedReconnectState | null = null;
  private readonly lastSeqListeners = new Set<(lastSeq: number) => void>();

  constructor(token: string, session: Session) {
    super();
    this.token = token;
    this.userId = decodeUserId(token);
    this.sessionId = session.id;
    this.metadata = session.metadata;
    this.metadataVersion = session.metadataVersion;
    this.agentState = session.agentState;
    this.agentStateVersion = session.agentStateVersion;
    this.capabilities = session.capabilities ?? null;
    this.capabilitiesVersion = session.capabilitiesVersion ?? 0;
    this.encryptionKey = session.encryptionKey;
    this.encryptionVariant = session.encryptionVariant;
    this.lastSeq = session.lastSeq ?? 0;
    this.sendSync = new InvalidateSync(() => this.flushOutbox());
    this.receiveSync = new InvalidateSync(() => this.fetchMessages());
    this.outboxReady = this.restorePersistedOutbox();

    // Initialize RPC handler manager
    this.rpcHandlerManager = new RpcHandlerManager({
      scopePrefix: this.sessionId,
      encryptionKey: this.encryptionKey,
      encryptionVariant: this.encryptionVariant,
      logger: (msg, data) => logger.debug(msg, data),
    });
    registerCommonHandlers(this.rpcHandlerManager, this.metadata.path);

    //
    // Create socket
    //

    // Auth object with a dynamic lastSeq getter so every reconnect handshake
    // sends the current watermark — not the stale value from construction time.
    const authData: Record<string, unknown> = {
      token: this.token,
      clientType: 'session-scoped' as const,
      sessionId: this.sessionId,
      isDaemon: true,
    };
    Object.defineProperty(authData, 'lastSeq', {
      get: () => this.lastSeq,
      enumerable: true,
    });

    this.socket = io(configuration.serverUrl, {
      auth: authData,
      path: '/v1/updates',
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 60000,
      transports: ['websocket'],
      withCredentials: true,
      autoConnect: false,
    });
    logger.info('[apiSession] socket created', {
      sessionId: this.sessionId,
      serverUrl: configuration.serverUrl,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 60000,
    });

    //
    // Handlers
    //

    this.socket.on('connect', () => {
      const plannedReconnect = this.clearPlannedReconnect();
      this.lastConnectedAt = Date.now();
      logger.info('[CLI] Session connected', {
        userId: this.userId,
        sessionId: this.sessionId,
        traceId: getProcessTraceContext()?.traceId,
        isFirstConnect: this.isFirstConnect,
        lastSeq: this.lastSeq,
        socketId: this.socket.id,
        prevDisconnectReason: this.lastDisconnectReason,
        prevDisconnectAgo: this.lastDisconnectAt ? Date.now() - this.lastDisconnectAt : null,
        resumedAfterServerRestart: !!plannedReconnect,
        restartDowntimeMs: plannedReconnect ? Date.now() - plannedReconnect.startedAt : null,
      });
      // Set replay mode BEFORE clearing flag — replay handler fires after connect
      this.nextReplayMode = this.isFirstConnect ? 'recovery' : 'reconnect';
      this.isFirstConnect = false;
      // lastSeq is now read dynamically via function-based auth — no manual update needed
      this.rpcHandlerManager.onSocketConnect(this.socket);
      // Server sends `replay` event on connection (RFC-010 §3.3), which handles
      // delivering missed messages. Do NOT call receiveSync.invalidate() here —
      // it would trigger a parallel fetchMessages() that processes the same messages
      // as the replay, causing user messages to be routed to the agent twice.
      // Flush any messages that were queued while disconnected
      void this.outboxReady
        .then(() => this.flushRestoredOutboxWarnings())
        .catch(error => {
          logger.error('[apiSession] failed to publish outbox restore warning', undefined, {
            sessionId: this.sessionId,
            error: String(error),
          });
        });
      this.sendSync.invalidate();
    });

    // Set up global RPC request handler
    this.socket.on(
      'rpc-request',
      async (data: { method: string; params: string }, callback: (response: string) => void) => {
        callback(await this.rpcHandlerManager.handleRequest(data));
      }
    );

    this.socket.on('disconnect', reason => {
      this.lastDisconnectReason = reason;
      this.lastDisconnectAt = Date.now();
      const plannedReconnect = this.getPlannedReconnectContext();
      logger.info(
        plannedReconnect
          ? '[CLI] Session disconnected for planned server restart'
          : '[CLI] Session disconnected',
        {
        userId: this.userId,
        sessionId: this.sessionId,
        traceId: getProcessTraceContext()?.traceId,
        reason,
        socketId: this.socket.id,
        connectedDurationMs: this.lastConnectedAt ? Date.now() - this.lastConnectedAt : null,
          ...plannedReconnect,
        }
      );
      this.rpcHandlerManager.onSocketDisconnect();
    });

    this.socket.on('connect_error', error => {
      const payload = {
        userId: this.userId,
        sessionId: this.sessionId,
        traceId: getProcessTraceContext()?.traceId,
        error: error.message,
        socketId: this.socket.id,
        socketConnected: this.socket.connected,
        activeTransport: this.socket.io.engine?.transport?.name,
        lastSeq: this.lastSeq,
        lastDisconnectReason: this.lastDisconnectReason,
        lastDisconnectAgo: this.lastDisconnectAt ? Date.now() - this.lastDisconnectAt : null,
        ...this.getPlannedReconnectContext(),
      };
      if (this.plannedReconnect) {
        logger.info('[CLI] Session reconnecting after planned server restart', payload);
      } else {
        logger.error('[CLI] Session connect failed', undefined, payload);
      }
      this.rpcHandlerManager.onSocketDisconnect();
    });

    this.socket.on(
      'server-draining',
      (data: { reason: 'server-restart'; reconnectAfterMs: number; startedAt: number }) => {
        this.beginPlannedReconnect(data);
        logger.info('[CLI] Session preparing for planned server restart', {
          userId: this.userId,
          sessionId: this.sessionId,
          socketId: this.socket.id,
          reconnectAfterMs: data.reconnectAfterMs,
          startedAt: data.startedAt,
        });
      }
    );

    // Server-driven archive fallback: DB is the source of truth.
    // If the server detects that the session is already archived (active=false)
    // during a keepAlive check, it emits this event so the daemon can shut down.
    this.socket.on('session-archived', (data: { sid: string }) => {
      if (data?.sid === this.sessionId) {
        logger.info('[CLI] Server notified session archived in DB', {
          userId: this.userId,
          sessionId: this.sessionId,
        });
        this.emit('archived');
      }
    });

    // Server replay after reconnection (RFC-010 §3.3)
    this.socket.on(
      'replay',
      async (data: { sessionId: string; messages: any[]; hasMore: boolean }) => {
        if (data?.sessionId !== this.sessionId || !Array.isArray(data.messages)) return;
        const mode = this.nextReplayMode;
        const replayLastSeqBefore = this.lastSeq;
        logger.info('[CLI] Replay received', {
          sessionId: this.sessionId,
          count: data.messages.length,
          hasMore: data.hasMore,
          replayMode: mode,
          lastSeqBefore: replayLastSeqBefore,
        });

        if (mode === 'recovery') {
          // First-connect replay is always historical data from the server.
          // Route suppression avoids re-executing user messages after daemon recovery
          // even if the recovered client temporarily starts with lastSeq === 0.
          let advancedCount = 0;
          for (const message of data.messages) {
            const previousLastSeq = this.lastSeq;
            this.advanceLastSeq(message.seq);
            if (this.lastSeq > previousLastSeq) advancedCount++;
          }
          logger.info('[CLI] Replay processed in recovery mode', {
            sessionId: this.sessionId,
            count: data.messages.length,
            advancedCount,
            lastSeqBefore: replayLastSeqBefore,
            lastSeqAfter: this.lastSeq,
            hasMore: data.hasMore,
          });
          if (data.hasMore) this.fetchRemainingSeqs();
        } else {
          // Reconnect, OR first connect on a brand-new session (lastSeq === 0):
          // agent has no prior history, so route messages so the agent sees them.
          let routedCount = 0;
          let skippedBySeqCount = 0;
          for (const message of data.messages) {
            const messageSeq = typeof message.seq === 'number' ? message.seq : null;
            if (messageSeq != null && messageSeq <= this.lastSeq) {
              skippedBySeqCount++;
              continue;
            }
            if (messageSeq != null) this.advanceLastSeq(messageSeq);
            if (message.content?.t !== 'encrypted') continue;
            if (message.traceId) setCurrentTurnTrace(resumeTrace(message.traceId));
            try {
              const body = await decryptFromWireString(
                this.encryptionKey,
                this.encryptionVariant,
                message.content.c
              );
              this.routeIncomingMessage(body);
              routedCount++;
            } catch (error) {
              logger.error('[CLI] Replay decrypt failed', undefined, {
                sessionId: this.sessionId,
                messageId: message.id,
                error: safeStringify(error),
              });
            }
          }
          logger.info('[CLI] Replay processed in routing mode', {
            sessionId: this.sessionId,
            count: data.messages.length,
            routedCount,
            skippedBySeqCount,
            lastSeqBefore: replayLastSeqBefore,
            lastSeqAfter: this.lastSeq,
            hasMore: data.hasMore,
          });
          if (data.hasMore) this.receiveSync.invalidate();
        }
      }
    );

    // Server events
    this.socket.on('update', async (data: Update) => {
      try {
        logger.debug('[SOCKET] [UPDATE] Received update', {
          userId: this.userId,
          sessionId: this.sessionId,
          type: data.body?.t,
          traceId: (data as any)._trace?.tid,
        });

        if (!data.body) {
          logger.debug('[SOCKET] [UPDATE] [ERROR] No body in update!', {
            userId: this.userId,
            sessionId: this.sessionId,
          });
          return;
        }

        if (data.body.t === 'new-message') {
          // Extract per-message trace context BEFORE any early returns.
          // When lastSeq === 0, we fall back to fetchMessages() polling, but the
          // currentTurnTrace module variable is already set so the polling path
          // benefits from it. Node.js is single-threaded: no other socket event
          // can overwrite currentTurnTrace between here and fetchMessages() running.
          if (data._trace?.tid) {
            const wire = data._trace;
            setCurrentTurnTrace(
              continueTrace({
                traceId: wire.tid,
                sessionId: wire.ses,
                machineId: wire.mid,
              })
            );
          }

          const messageSeq = data.body.message?.seq;
          if (this.lastSeq === 0) {
            this.receiveSync.invalidate();
            return;
          }
          if (
            typeof messageSeq !== 'number' ||
            messageSeq !== this.lastSeq + 1 ||
            data.body.message.content.t !== 'encrypted'
          ) {
            this.receiveSync.invalidate();
            return;
          }
          const c = data.body.message.content.c;
          try {
            const body = await decryptFromWireString(this.encryptionKey, this.encryptionVariant, c);
            logger.debug('[SOCKET] [UPDATE] Processing message (fast path)', {
              userId: this.userId,
              sessionId: this.sessionId,
              seq: messageSeq,
              messageId: data.body.message.id,
              traceId: data._trace?.tid,
            });
            this.routeIncomingMessage(body);
            this.advanceLastSeq(messageSeq);
          } catch (decryptError) {
            logger.error(
              '[SOCKET] Fast-path processing failed, falling back to slow path',
              undefined,
              {
                userId: this.userId,
                sessionId: this.sessionId,
                seq: messageSeq,
                error: safeStringify(decryptError),
              }
            );
            this.receiveSync.invalidate();
          }
        } else if (data.body.t === 'update-session') {
          if (data.body.metadata && data.body.metadata.version > this.metadataVersion) {
            const mv = data.body.metadata.value;
            this.metadata = await decryptFromWireString(
              this.encryptionKey,
              this.encryptionVariant,
              mv
            );
            this.metadataVersion = data.body.metadata.version;
          }
          if (data.body.agentState && data.body.agentState.version > this.agentStateVersion) {
            const sv = data.body.agentState.value;
            this.agentState = sv
              ? await decryptFromWireString(this.encryptionKey, this.encryptionVariant, sv)
              : null;
            this.agentStateVersion = data.body.agentState.version;
          }
          if (data.body.capabilities && data.body.capabilities.version > this.capabilitiesVersion) {
            const cv = data.body.capabilities.value;
            this.capabilities = cv
              ? await decryptFromWireString(this.encryptionKey, this.encryptionVariant, cv)
              : null;
            this.capabilitiesVersion = data.body.capabilities.version;
          }
        } else if (data.body.t === 'update-machine') {
          // Session clients shouldn't receive machine updates - log warning
          logger.debug(
            `[SOCKET] WARNING: Session client received unexpected machine update - ignoring`
          );
        } else {
          // If not a user message, it might be a permission response or other message type
          this.emit('message', data.body);
        }
      } catch (error) {
        logger.debug('[SOCKET] [UPDATE] [ERROR] Error handling update', { error });
      }
    });

    // File transfer from Server (forwarded from App upload)
    this.socket.on('file-transfer', (payload: { id: string; data: Buffer; mimeType: string; filename?: string }, ack: (result: { ok: boolean }) => void) => {
      if (this.fileTransferCallback) {
        this.fileTransferCallback(payload, ack);
      } else {
        // No handler registered yet — reject so the Server can report the error
        ack({ ok: false });
      }
    });

    // Attachment download from Server (forwarded from App request)
    this.socket.on('fetch-attachment', (payload: { id: string; mimeType: string }, ack: (result: { ok: boolean; data?: Buffer; mimeType?: string; error?: string }) => void) => {
      if (this.fetchAttachmentCallback) {
        this.fetchAttachmentCallback(payload, ack);
      } else {
        ack({ ok: false, error: 'no_handler' });
      }
    });

    // DEATH
    this.socket.on('error', error => {
      logger.debug('[API] Socket error:', error);
    });

    //
    // Connect (after short delay to give a time to add handlers)
    //

    this.socket.connect();
  }

  getLastSeq(): number {
    return this.lastSeq;
  }

  onLastSeqChanged(listener: (lastSeq: number) => void): () => void {
    this.lastSeqListeners.add(listener);
    return () => {
      this.lastSeqListeners.delete(listener);
    };
  }

  onUserMessage(callback: (data: UserMessage) => void) {
    this.pendingMessageCallback = callback;
    logger.info('[apiSession] onUserMessage callback registered', {
      userId: this.userId,
      sessionId: this.sessionId,
      pendingCount: this.pendingMessages.length,
      traceId: getProcessTraceContext()?.traceId,
    });
    while (this.pendingMessages.length > 0) {
      const msg = this.pendingMessages.shift()!;
      logger.info('[apiSession] draining pending user message', {
        userId: this.userId,
        sessionId: this.sessionId,
        textLen: msg.content.text.length,
        preview: msg.content.text.slice(0, 120),
        remainingPending: this.pendingMessages.length,
        traceId: getProcessTraceContext()?.traceId,
      });
      callback(msg);
    }
  }

  onFileTransfer(
    callback: (
      payload: { id: string; data: Buffer; mimeType: string; filename?: string },
      ack: (result: { ok: boolean }) => void
    ) => void
  ): void {
    this.fileTransferCallback = callback;
    logger.info('[apiSession] onFileTransfer callback registered', {
      sessionId: this.sessionId,
    });
  }

  onFetchAttachment(
    callback: (
      payload: { id: string; mimeType: string },
      ack: (result: { ok: boolean; data?: Buffer; mimeType?: string; error?: string }) => void
    ) => void
  ): void {
    this.fetchAttachmentCallback = callback;
    logger.info('[apiSession] onFetchAttachment callback registered', {
      sessionId: this.sessionId,
    });
  }

  private routeIncomingMessage(message: unknown) {
    const userResult = UserMessageSchema.safeParse(message);
    if (userResult.success) {
      const traceId = getProcessTraceContext()?.traceId;
      logger.debug('[apiSession] routing user message to callback', {
        userId: this.userId,
        sessionId: this.sessionId,
        hasCallback: !!this.pendingMessageCallback,
        textLen: userResult.data.content.text.length,
        preview: userResult.data.content.text.slice(0, 120),
        permissionMode: userResult.data.meta?.permissionMode,
        model: userResult.data.meta?.model,
        traceId,
      });
      if (this.pendingMessageCallback) {
        logger.info('[apiSession] invoking user message callback', {
          userId: this.userId,
          sessionId: this.sessionId,
          textLen: userResult.data.content.text.length,
          preview: userResult.data.content.text.slice(0, 120),
          traceId,
        });
        this.pendingMessageCallback(userResult.data);
      } else {
        this.pendingMessages.push(userResult.data);
        logger.info('[apiSession] queued user message until callback registration', {
          userId: this.userId,
          sessionId: this.sessionId,
          textLen: userResult.data.content.text.length,
          preview: userResult.data.content.text.slice(0, 120),
          pendingCount: this.pendingMessages.length,
          traceId,
        });
      }
      return;
    }
    this.emit('message', message);
  }

  private async fetchMessages() {
    await this.waitForOperationalSocket();
    let afterSeq = this.lastSeq;
    while (true) {
      let ack: { ok: boolean; messages?: V3SessionMessage[]; hasMore?: boolean; error?: string };
      try {
        ack = await this.socket.timeout(60000).emitWithAck('fetch-messages', {
          sessionId: this.sessionId,
          after_seq: afterSeq,
          limit: 100,
        });
      } catch (err: any) {
        logger.error('[API] fetchMessages WS failed', undefined, {
          userId: this.userId,
          sessionId: this.sessionId,
          traceId: getProcessTraceContext()?.traceId,
          error: safeStringify(err),
        });
        throw err;
      }

      if (!ack.ok) {
        if (ack.error === 'Session not found') {
          logger.debug('[API] fetchMessages: session not found, stopping sync', {
            userId: this.userId,
            sessionId: this.sessionId,
          });
          this.receiveSync.stop();
          return;
        }
        throw new Error(`fetch-messages failed: ${ack.error}`);
      }

      const messages = Array.isArray(ack.messages) ? ack.messages : [];
      let maxSeq = afterSeq;

      for (const message of messages) {
        if (message.seq > maxSeq) {
          maxSeq = message.seq;
        }

        if (message.content?.t !== 'encrypted') {
          continue;
        }

        if (message.traceId) {
          setCurrentTurnTrace(resumeTrace(message.traceId));
        }

        try {
          const c = message.content.c;
          const body = await decryptFromWireString(this.encryptionKey, this.encryptionVariant, c);
          this.routeIncomingMessage(body);
        } catch (error) {
          logger.error('[CLI] Message processing failed', undefined, {
            userId: this.userId,
            sessionId: this.sessionId,
            messageId: message.id,
            seq: message.seq,
            traceId: message.traceId,
            error: safeStringify(error),
          });
        }
      }

      this.advanceLastSeq(maxSeq);
      const hasMore = !!ack.hasMore;
      if (hasMore && maxSeq === afterSeq) {
        logger.debug('[API] fetchMessages pagination stalled, stopping to avoid infinite loop', {
          userId: this.userId,
          sessionId: this.sessionId,
          traceId: getProcessTraceContext()?.traceId,
          afterSeq,
        });
        break;
      }
      afterSeq = maxSeq;
      if (!hasMore) {
        break;
      }
    }
  }

  /**
   * Fetch remaining messages after replay to bring lastSeq up to date.
   * Only updates lastSeq — does NOT route messages to the agent.
   */
  /** Max pages when catching up lastSeq during recovery. */
  private static readonly MAX_SEQ_CATCHUP_PAGES = 50;

  private async fetchRemainingSeqs() {
    await this.waitForOperationalSocket();
    let afterSeq = this.lastSeq;
    let pages = 0;
    while (pages < ApiSessionClient.MAX_SEQ_CATCHUP_PAGES) {
      pages++;
      let ack: { ok: boolean; messages?: V3SessionMessage[]; hasMore?: boolean; error?: string };
      try {
        ack = await this.socket.timeout(60000).emitWithAck('fetch-messages', {
          sessionId: this.sessionId,
          after_seq: afterSeq,
          limit: 100,
        });
      } catch (err: any) {
        logger.error('[API] fetchRemainingSeqs failed', undefined, {
          sessionId: this.sessionId,
          error: safeStringify(err),
        });
        return;
      }
      if (!ack.ok) return;

      const messages = Array.isArray(ack.messages) ? ack.messages : [];
      let maxSeq = afterSeq;
      for (const message of messages) {
        if (message.seq > maxSeq) maxSeq = message.seq;
      }
      this.advanceLastSeq(maxSeq);

      const hasMore = !!ack.hasMore;
      if (!hasMore || maxSeq === afterSeq) break;
      afterSeq = maxSeq;
    }
    logger.debug('[API] fetchRemainingSeqs done', {
      sessionId: this.sessionId,
      lastSeq: this.lastSeq,
      pages,
    });
  }

  /** Server accepts at most 100 messages per batch. */
  private static readonly FLUSH_BATCH_SIZE = 100;

  private async flushOutbox() {
    await this.outboxReady;
    if (this.pendingOutbox.length === 0) {
      return;
    }
    await this.waitForOperationalSocket();

    // Drain in batches via WebSocket emitWithAck (RFC-010).
    while (this.pendingOutbox.length > 0) {
      const batch = this.pendingOutbox.slice(0, ApiSessionClient.FLUSH_BATCH_SIZE);
      logger.debug('[apiSession] flushing outbox', {
        userId: this.userId,
        sessionId: this.sessionId,
        count: batch.length,
        total: this.pendingOutbox.length,
        ids: batch.map(m => m.id),
        traceIds: batch.map(m => m._trace?.tid).filter(Boolean),
      });

      let ack: { ok: boolean; messages?: Array<{ id: string; seq: number }>; error?: string };
      try {
        ack = await this.socket.timeout(60000).emitWithAck('send-messages', {
          sessionId: this.sessionId,
          messages: batch,
        });
      } catch (err: unknown) {
        const errorMessage = safeStringify(err);
        logger.error('[apiSession] outbox flush failed', undefined, {
          userId: this.userId,
          sessionId: this.sessionId,
          traceId: getProcessTraceContext()?.traceId,
          count: batch.length,
          ids: batch.map(m => m.id),
          error: errorMessage,
        });
        throw err;
      }

      if (!ack.ok) {
        if (ack.error === 'Session not found') {
          this.sendSync.stop();
          return;
        }
        throw new Error(`send-messages failed: ${ack.error}`);
      }

      this.pendingOutbox.splice(0, batch.length);
      await this.persistCurrentOutbox();

      const messages = Array.isArray(ack.messages) ? ack.messages : [];
      const maxSeq = messages.reduce(
        (acc, message) => (message.seq > acc ? message.seq : acc),
        this.lastSeq
      );
      this.advanceLastSeq(maxSeq);
      logger.debug('[apiSession] outbox batch flushed', {
        userId: this.userId,
        sessionId: this.sessionId,
        count: batch.length,
        remaining: this.pendingOutbox.length,
        ids: batch.map(m => m.id),
        traceIds: batch.map(m => m._trace?.tid).filter(Boolean),
      });
    }
  }

  private async enqueueMessage(content: unknown): Promise<string> {
    await this.outboxReady;
    const encrypted = await encryptToWireString(
      this.encryptionKey,
      this.encryptionVariant,
      content
    );
    const trace = getWireTrace();
    const id = randomUUID();
    this.pendingOutbox.push({
      content: encrypted,
      id,
      ...(trace ? { _trace: trace } : {}),
    });
    await this.persistCurrentOutbox();
    logger.debug('[apiSession] message enqueued', {
      userId: this.userId,
      sessionId: this.sessionId,
      id,
      outboxSize: this.pendingOutbox.length,
      traceId: trace?.tid,
    });
    this.sendSync.invalidate();
    return id;
  }


  /**
   * Legacy Claude session-protocol envelope used by local Claude JSONL/session sync.
   * The daemon/app main path should prefer sendNormalizedMessage().
   */
  async sendSessionProtocolMessage(envelope: SessionEnvelope) {
    const content = {
      role: envelope.role,
      content: {
        type: 'session',
        data: envelope,
      },
      meta: {
        sentFrom: 'cli',
      },
    };

    await this.enqueueMessage(content);
  }

  /**
   * Send a normalized message (pre-formatted with role and content).
   * Used by AgentSession to pipe backend output directly.
   */
  async sendNormalizedMessage(
    msg: Pick<NormalizedMessage, 'role' | 'content'> & Partial<NormalizedMessage>
  ): Promise<string> {
    return this.enqueueMessage(msg);
  }


  async sendSessionEvent(
    event:
      | {
          type: 'switch';
          mode: 'local' | 'remote';
        }
      | {
          type: 'message';
          message: string;
        }
      | {
          type: 'permission-mode-changed';
          mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
        }
      | {
          type: 'ready';
          stopReason?: string;
        },
    id?: string
  ) {
    if (event.type === 'permission-mode-changed') {
      await this.enqueueMessage({
        role: 'agent',
        content: {
          id: id ?? randomUUID(),
          type: 'event',
          data: event,
        },
      });
      return;
    }

    await this.sendNormalizedMessage({
      id: id ?? randomUUID(),
      createdAt: Date.now(),
      isSidechain: false,
      role: 'event',
      content: event,
    });
  }

  /**
   * Send a ping message to keep the connection alive
   */
  keepAlive(thinking: boolean, mode: 'local' | 'remote') {
    if (!this.socket.connected) {
      return;
    }
    logger.debug(`[API] Sending keep alive message: ${thinking}`);
    this.socket.volatile.emit('session-alive', {
      sid: this.sessionId,
      time: Date.now(),
      thinking,
      mode,
      _trace: getWireTrace(),
    });
  }

  /**
   * Send session death message
   */
  sendSessionDeath() {
    this.socket.emit('session-end', {
      sid: this.sessionId,
      time: Date.now(),
      _trace: getWireTrace(),
    });
  }

  /**
   * Send usage data to the server
   */
  sendUsageData(
    usage: Usage,
    options?: {
      model?: string;
      key?: string;
      timestamp?: number;
      agentType?: string;
      startedBy?: 'cli' | 'daemon' | 'app';
      localOnly?: boolean;
    }
  ) {
    const { model, key = 'claude-session', timestamp, agentType, startedBy, localOnly } =
      options ?? {};
    // Calculate total tokens
    const totalTokens =
      usage.input_tokens +
      usage.output_tokens +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0);

    const costs = calculateCost(usage, model);

    // Transform Claude usage format to backend expected format
    const usageReport = {
      key,
      sessionId: this.sessionId,
      timestamp,
      agentType,
      model,
      startedBy,
      tokens: {
        total: totalTokens,
        input: usage.input_tokens,
        output: usage.output_tokens,
        cache_creation: usage.cache_creation_input_tokens || 0,
        cache_read: usage.cache_read_input_tokens || 0,
        ...(usage.context_used_tokens != null
          ? { context_used: Number(usage.context_used_tokens) }
          : {}),
        ...(usage.context_window_size != null
          ? { context_window: Number(usage.context_window_size) }
          : {}),
      },
      cost: {
        total: costs.total,
        input: costs.input,
        output: costs.output,
      },
      ...(localOnly ? { localOnly: true } : {}),
    };
    logger.debug('[SOCKET] Sending usage data', { userId: this.userId, sessionId: this.sessionId });
    this.socket.emit('usage-report', { ...usageReport, _trace: getWireTrace() });
  }

  /**
   * Update session metadata
   * @param handler - Handler function that returns the updated metadata
   */
  updateMetadata(handler: (metadata: Metadata) => Metadata) {
    this.metadataLock
      .inLock(async () => {
        await backoff(async () => {
          await this.waitForOperationalSocket();
          const updated = handler(this.metadata!);
          const answer = await withTimeout(
            this.socket.emitWithAck('update-metadata', {
              sid: this.sessionId,
              expectedVersion: this.metadataVersion,
              metadata: await encryptToWireString(
                this.encryptionKey,
                this.encryptionVariant,
                updated
              ),
              _trace: getWireTrace(),
            }),
            ACK_TIMEOUT,
            'update-metadata'
          );
          if (answer.result === 'success') {
            const am = answer.metadata;
            this.metadata = await decryptFromWireString(
              this.encryptionKey,
              this.encryptionVariant,
              am
            );
            this.metadataVersion = answer.version;
          } else if (answer.result === 'version-mismatch') {
            if (answer.version > this.metadataVersion) {
              this.metadataVersion = answer.version;
              const am = answer.metadata;
              this.metadata = await decryptFromWireString(
                this.encryptionKey,
                this.encryptionVariant,
                am
              );
            }
            throw new Error('Metadata version mismatch');
          } else if (answer.result === 'error') {
            // Hard error - ignore
          }
        });
      })
      .catch(e => {
        logger.error('[apiSession] updateMetadata failed after backoff exhaustion', undefined, {
          error: String(e),
        });
      });
  }

  /**
   * Update session agent state
   * @param handler - Handler function that returns the updated agent state
   */
  updateAgentState(handler: (metadata: AgentState) => AgentState) {
    logger.debug('Updating agent state', {
      userId: this.userId,
      sessionId: this.sessionId,
      traceId: getProcessTraceContext()?.traceId,
    });
    this.agentStateLock
      .inLock(async () => {
        await backoff(async () => {
          await this.waitForOperationalSocket();
          const updated = handler(this.agentState || {});
          const answer = await withTimeout(
            this.socket.emitWithAck('update-state', {
              sid: this.sessionId,
              expectedVersion: this.agentStateVersion,
              _trace: getWireTrace(),
              agentState: updated
                ? await encryptToWireString(this.encryptionKey, this.encryptionVariant, updated)
                : null,
            }),
            ACK_TIMEOUT,
            'update-state'
          );
          if (answer.result === 'success') {
            const as = answer.agentState;
            this.agentState = as
              ? await decryptFromWireString(this.encryptionKey, this.encryptionVariant, as)
              : null;
            this.agentStateVersion = answer.version;
            logger.debug('Agent state updated', {
              userId: this.userId,
              sessionId: this.sessionId,
              traceId: getProcessTraceContext()?.traceId,
            });
          } else if (answer.result === 'version-mismatch') {
            if (answer.version > this.agentStateVersion) {
              this.agentStateVersion = answer.version;
              const as = answer.agentState;
              this.agentState = as
                ? await decryptFromWireString(this.encryptionKey, this.encryptionVariant, as)
                : null;
            }
            throw new Error('Agent state version mismatch');
          } else if (answer.result === 'error') {
            // Hard error - ignore
          }
        });
      })
      .catch(e => {
        logger.error('[apiSession] updateAgentState failed after backoff exhaustion', undefined, {
          error: String(e),
        });
      });
  }

  updateCapabilities(capabilities: SessionCapabilities | null) {
    this.capabilitiesLock
      .inLock(async () => {
        await backoff(async () => {
          await this.waitForOperationalSocket();
          const answer = await withTimeout(
            this.socket.emitWithAck('update-capabilities', {
              sid: this.sessionId,
              expectedVersion: this.capabilitiesVersion,
              _trace: getWireTrace(),
              capabilities: capabilities
                ? await encryptToWireString(
                    this.encryptionKey,
                    this.encryptionVariant,
                    capabilities
                  )
                : null,
            }),
            ACK_TIMEOUT,
            'update-capabilities'
          );
          if (answer.result === 'success') {
            const cv = answer.capabilities;
            this.capabilities = cv
              ? await decryptFromWireString(this.encryptionKey, this.encryptionVariant, cv)
              : null;
            this.capabilitiesVersion = answer.version;
          } else if (answer.result === 'version-mismatch') {
            if (answer.version > this.capabilitiesVersion) {
              this.capabilitiesVersion = answer.version;
              const cv = answer.capabilities;
              this.capabilities = cv
                ? await decryptFromWireString(this.encryptionKey, this.encryptionVariant, cv)
                : null;
            }
            throw new Error('Capabilities version mismatch');
          }
        });
      })
      .catch(e => {
        logger.error('[apiSession] updateCapabilities failed after backoff exhaustion', undefined, {
          error: String(e),
        });
      });
  }

  // ============================================================
  // STREAMING METHODS (Typewriter Effect)
  // ============================================================

  /**
   * Send streaming text delta for typewriter effect
   * Only works if server supports textDelta capability.
   */
  sendStreamingTextDelta(messageId: string, delta: string): void {
    if (!this.socket.connected) {
      return;
    }
    const ctx = getProcessTraceContext();
    const wireTrace: Record<string, unknown> = {};
    if (ctx) injectTrace(ctx, wireTrace);
    this.socket.emit('streaming:text-delta', {
      type: 'text_delta',
      sessionId: this.sessionId,
      messageId,
      delta,
      timestamp: Date.now(),
      _trace: wireTrace._trace as WireTrace | undefined,
    });
  }

  /**
   * Send streaming text complete event
   * Signals that text streaming has finished.
   */
  sendStreamingTextComplete(messageId: string, fullText: string): void {
    if (!this.socket.connected) {
      return;
    }
    const ctx = getProcessTraceContext();
    const wireTrace: Record<string, unknown> = {};
    if (ctx) injectTrace(ctx, wireTrace);
    this.socket.emit('streaming:text-complete', {
      type: 'text_complete',
      sessionId: this.sessionId,
      messageId,
      fullText,
      timestamp: Date.now(),
      _trace: wireTrace._trace as WireTrace | undefined,
    });
  }

  /**
   * Send streaming thinking delta
   * Only works if server supports thinkingDelta capability.
   */
  sendStreamingThinkingDelta(messageId: string, delta: string): void {
    if (!this.socket.connected) {
      return;
    }
    const ctx = getProcessTraceContext();
    const wireTrace: Record<string, unknown> = {};
    if (ctx) injectTrace(ctx, wireTrace);
    this.socket.emit('streaming:thinking-delta', {
      type: 'thinking_delta',
      sessionId: this.sessionId,
      messageId,
      delta,
      timestamp: Date.now(),
      _trace: wireTrace._trace as WireTrace | undefined,
    });
  }

  /**
   * Wait for socket buffer to flush
   */
  async flush(): Promise<void> {
    // Wait for HTTP outbox to drain (works regardless of WebSocket state).
    await Promise.race([this.sendSync.invalidateAndAwait(), delay(10000)]);
    // If socket is connected, also wait for a round-trip ping to confirm the
    // server has processed everything. Skip this when disconnected — HTTP flush above
    // is the authoritative delivery path and has already completed.
    if (!this.socket.connected) {
      return;
    }
    return new Promise(resolve => {
      this.socket.emit('ping', () => {
        resolve();
      });
      setTimeout(() => {
        resolve();
      }, 10000);
    });
  }

  async close() {
    logger.debug('[API] socket.close() called');
    setCurrentTurnTrace(undefined);
    await this.outboxReady;
    await this.persistCurrentOutbox();
    this.sendSync.stop();
    this.receiveSync.stop();
    this.socket.close();
  }

  private buildRestoreWarningMessage(placeholders: PendingOutboxPlaceholder[]): string {
    const total = placeholders.length;
    const oversizedCount = placeholders.filter(
      placeholder => placeholder.reason === 'message_too_large'
    ).length;
    const serializationFailureCount = total - oversizedCount;

    const parts: string[] = [];
    if (oversizedCount > 0) {
      parts.push(
        `${oversizedCount} offline queued message${oversizedCount === 1 ? '' : 's'} were too large to save`
      );
    }
    if (serializationFailureCount > 0) {
      parts.push(
        `${serializationFailureCount} offline queued message${serializationFailureCount === 1 ? '' : 's'} could not be serialized`
      );
    }

    const summary = parts.join('; ');
    return `${summary}. Those messages were not restored after daemon recovery. Please resend them.`;
  }

  private async flushRestoredOutboxWarnings(): Promise<void> {
    if (this.pendingOutboxRestoreWarnings.length === 0) {
      return;
    }

    const placeholders = this.pendingOutboxRestoreWarnings.slice();
    const warningMessage = this.buildRestoreWarningMessage(placeholders);
    await this.sendSessionEvent({
      type: 'message',
      message: warningMessage,
    });
    this.pendingOutboxRestoreWarnings = [];
    logger.warn('[apiSession] published outbox restore warning', {
      sessionId: this.sessionId,
      placeholderCount: placeholders.length,
      placeholderReasons: placeholders.map(placeholder => placeholder.reason),
      originalMessageIds: placeholders.map(placeholder => placeholder.originalMessageId),
    });
  }

  private async restorePersistedOutbox(): Promise<void> {
    const restored = await loadPendingSessionOutbox(this.sessionId);
    if (restored.length === 0) {
      return;
    }

    const pendingMessages: PendingOutboxMessage[] = [];
    const placeholders: PendingOutboxPlaceholder[] = [];
    for (const entry of restored) {
      if ('type' in entry && entry.type === 'persisted-outbox-placeholder') {
        placeholders.push(entry);
      } else {
        pendingMessages.push(entry as PendingOutboxMessage);
      }
    }

    this.pendingOutbox.push(...pendingMessages);
    this.pendingOutboxRestoreWarnings.push(...placeholders);
    logger.info('[apiSession] restored persisted outbox', {
      sessionId: this.sessionId,
      restoredCount: pendingMessages.length,
      placeholderCount: placeholders.length,
      ids: pendingMessages.map(message => message.id),
      placeholderIds: placeholders.map(placeholder => placeholder.originalMessageId),
    });
  }

  private async persistCurrentOutbox(): Promise<void> {
    await this.outboxPersistenceLock.inLock(async () => {
      await persistPendingSessionOutbox(this.sessionId, this.pendingOutbox);
    });
  }

  private beginPlannedReconnect(data: {
    reason: 'server-restart';
    reconnectAfterMs: number;
    startedAt: number;
  }): void {
    const reconnectAfterMs = Math.max(0, data.reconnectAfterMs);
    const deadline = Date.now() + reconnectAfterMs + 15_000;
    if (this.plannedReconnect && this.plannedReconnect.deadline >= deadline) {
      return;
    }

    const previous = this.clearPlannedReconnect();
    const state = {} as PlannedReconnectState;
    state.reason = data.reason;
    state.reconnectAfterMs = reconnectAfterMs;
    state.startedAt = data.startedAt;
    state.deadline = deadline;
    state.promise = new Promise<void>(resolve => {
      state.resolve = resolve;
    });
    state.timer = setTimeout(() => {
      if (this.plannedReconnect !== state) {
        return;
      }
      logger.warn('[CLI] Planned server restart window elapsed', {
        sessionId: this.sessionId,
        reconnectAfterMs: state.reconnectAfterMs,
        startedAt: state.startedAt,
      });
      this.clearPlannedReconnect();
    }, Math.max(0, deadline - Date.now()));
    state.timer.unref?.();
    this.plannedReconnect = state;

    if (previous) {
      logger.info('[CLI] Replaced stale planned reconnect state', {
        sessionId: this.sessionId,
        previousStartedAt: previous.startedAt,
        nextStartedAt: data.startedAt,
      });
    }
  }

  private clearPlannedReconnect(): PlannedReconnectState | null {
    const plannedReconnect = this.plannedReconnect;
    if (!plannedReconnect) {
      return null;
    }
    this.plannedReconnect = null;
    clearTimeout(plannedReconnect.timer);
    plannedReconnect.resolve();
    return plannedReconnect;
  }

  private getPlannedReconnectContext():
    | {
        plannedReconnectReason: 'server-restart';
        plannedReconnectRemainingMs: number;
        plannedReconnectStartedAt: number;
      }
    | undefined {
    if (!this.plannedReconnect) {
      return undefined;
    }
    return {
      plannedReconnectReason: this.plannedReconnect.reason,
      plannedReconnectRemainingMs: Math.max(0, this.plannedReconnect.deadline - Date.now()),
      plannedReconnectStartedAt: this.plannedReconnect.startedAt,
    };
  }

  private async waitForOperationalSocket(): Promise<void> {
    if (this.plannedReconnect) {
      await this.plannedReconnect.promise;
    }
  }

  private advanceLastSeq(nextSeq: number): void {
    if (!Number.isFinite(nextSeq) || nextSeq <= this.lastSeq) {
      return;
    }
    this.lastSeq = nextSeq;
    for (const listener of this.lastSeqListeners) {
      try {
        listener(this.lastSeq);
      } catch (error) {
        logger.warn('[apiSession] lastSeq listener failed', {
          sessionId: this.sessionId,
          error: safeStringify(error),
        });
      }
    }
  }
}
