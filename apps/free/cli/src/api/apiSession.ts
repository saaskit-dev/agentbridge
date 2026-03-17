import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import axios from 'axios';
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
import { RawJSONLines } from '@/claude/types';
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
import type { SessionTurnEndStatus } from '@/sessionProtocol/types';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';
import {

  closeClaudeTurnWithStatusNormalized,
  mapClaudeLogMessageToNormalizedMessages,
  type ClaudeSessionProtocolState,
} from '@/claude/utils/sessionProtocolMapper';

const logger = new Logger('api/apiSession');

/** Race a promise against a timeout. Rejects with an Error if the timeout fires first. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
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
/**
 * ACP (Agent Communication Protocol) message data types.
 * This is the unified format for all agent messages - CLI adapts each provider's format to ACP.
 */
export type ACPMessageData =
  // Core message types
  | { type: 'message'; message: string }
  | { type: 'reasoning'; message: string }
  | { type: 'thinking'; text: string }
  // Tool interactions
  | { type: 'tool-call'; callId: string; name: string; input: unknown; id: string }
  | { type: 'tool-result'; callId: string; output: unknown; id: string; isError?: boolean }
  // File operations
  | {
      type: 'file-edit';
      description: string;
      filePath: string;
      diff?: string;
      oldContent?: string;
      newContent?: string;
      id: string;
    }
  // Terminal/command output
  | { type: 'terminal-output'; data: string; callId: string }
  // Task lifecycle events
  | { type: 'task_started'; id: string }
  | { type: 'task_complete'; id: string }
  | { type: 'turn_aborted'; id: string }
  // Permissions
  | {
      type: 'permission-request';
      permissionId: string;
      toolName: string;
      description: string;
      options?: unknown;
    }
  // Usage/metrics
  | { type: 'token_count'; [key: string]: unknown };

export type ACPProvider = 'gemini' | 'codex' | 'claude' | 'opencode';

type V3SessionMessage = {
  id: string;
  seq: number;
  content: { t: 'encrypted'; c: string };
  /** RFC §19.3: traceId stored in DB for HTTP sync path trace correlation. */
  traceId?: string;
  createdAt: number;
  updatedAt: number;
};

type V3GetSessionMessagesResponse = {
  messages: V3SessionMessage[];
  hasMore: boolean;
};

type V3PostSessionMessagesResponse = {
  messages: Array<{
    id: string;
    seq: number;
    createdAt: number;
    updatedAt: number;
  }>;
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
  readonly rpcHandlerManager: RpcHandlerManager;
  private agentStateLock = new AsyncLock();
  private metadataLock = new AsyncLock();
  private capabilitiesLock = new AsyncLock();
  private encryptionKey: Uint8Array;
  private encryptionVariant: 'legacy' | 'dataKey';
  private claudeSessionProtocolState: ClaudeSessionProtocolState = {
    currentTurnId: null,
    uuidToProviderSubagent: new Map<string, string>(),
    taskPromptToSubagents: new Map<string, string[]>(),
    providerSubagentToSessionSubagent: new Map<string, string>(),
    subagentTitles: new Map<string, string>(),
    bufferedSubagentMessages: new Map<string, RawJSONLines[]>(),
    hiddenParentToolCalls: new Set<string>(),
    startedSubagents: new Set<string>(),
    activeSubagents: new Set<string>(),
  };
  private lastSeq = 0;
  private pendingOutbox: Array<{ content: string; id: string; _trace?: WireTrace }> = [];
  private readonly sendSync: InvalidateSync;
  private readonly receiveSync: InvalidateSync;

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
    this.sendSync = new InvalidateSync(() => this.flushOutbox());
    this.receiveSync = new InvalidateSync(() => this.fetchMessages());

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

    this.socket = io(configuration.serverUrl, {
      auth: {
        token: this.token,
        clientType: 'session-scoped' as const,
        sessionId: this.sessionId,
      },
      path: '/v1/updates',
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket'],
      withCredentials: true,
      autoConnect: false,
    });
    logger.info('[apiSession] socket created', {
      sessionId: this.sessionId,
      serverUrl: configuration.serverUrl,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    //
    // Handlers
    //

    this.socket.on('connect', () => {
      logger.info('[CLI] Session connected', { userId: this.userId, sessionId: this.sessionId, traceId: getProcessTraceContext()?.traceId });
      this.rpcHandlerManager.onSocketConnect(this.socket);
      this.receiveSync.invalidate();
      // Flush any messages that were queued while disconnected
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
      logger.info('[CLI] Session disconnected', { userId: this.userId, sessionId: this.sessionId, traceId: getProcessTraceContext()?.traceId, reason });
      this.rpcHandlerManager.onSocketDisconnect();
    });

    this.socket.on('connect_error', error => {
      logger.error('[CLI] Session connect failed', undefined, { userId: this.userId, sessionId: this.sessionId, traceId: getProcessTraceContext()?.traceId, error: error.message });
      this.rpcHandlerManager.onSocketDisconnect();
    });

    // Server-driven archive fallback: DB is the source of truth.
    // If the server detects that the session is already archived (active=false)
    // during a keepAlive check, it emits this event so the daemon can shut down.
    this.socket.on('session-archived', (data: { sid: string }) => {
      if (data?.sid === this.sessionId) {
        logger.info('[CLI] Server notified session archived in DB', { userId: this.userId, sessionId: this.sessionId });
        this.emit('archived');
      }
    });

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
          logger.debug('[SOCKET] [UPDATE] [ERROR] No body in update!', { userId: this.userId, sessionId: this.sessionId });
          return;
        }

        if (data.body.t === 'new-message') {
          // Extract per-message trace context BEFORE any early returns.
          // When lastSeq === 0, we fall back to fetchMessages() polling, but the
          // currentTurnTrace module variable is already set so the polling path
          // benefits from it. Node.js is single-threaded: no other socket event
          // can overwrite currentTurnTrace between here and fetchMessages() running.
          if (data._trace?.tid && data._trace?.sid) {
            const wire = data._trace;
            setCurrentTurnTrace(continueTrace({
              traceId: wire.tid,
              spanId: wire.sid,
              sessionId: wire.ses,
              machineId: wire.mid,
            }));
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
            this.lastSeq = messageSeq;
          } catch (decryptError) {
            logger.error('[SOCKET] Fast-path decrypt failed, falling back to slow path', undefined, {
              userId: this.userId,
              sessionId: this.sessionId,
              seq: messageSeq,
              error: safeStringify(decryptError),
            });
            this.receiveSync.invalidate();
          }
        } else if (data.body.t === 'update-session') {
          if (data.body.metadata && data.body.metadata.version > this.metadataVersion) {
            const mv = data.body.metadata.value;
            this.metadata = await decryptFromWireString(this.encryptionKey, this.encryptionVariant, mv);
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

    // DEATH
    this.socket.on('error', error => {
      logger.debug('[API] Socket error:', error);
    });

    //
    // Connect (after short delay to give a time to add handlers)
    //

    this.socket.connect();
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

  private authHeaders() {
    const ctx = getProcessTraceContext();
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      // RFC §7.2: carry trace context in HTTP headers so server can correlate logs
      ...(ctx ? { 'X-Trace-Id': ctx.traceId, 'X-Span-Id': ctx.spanId } : {}),
    };
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
    let afterSeq = this.lastSeq;
    while (true) {
      let response: Awaited<ReturnType<typeof axios.get<V3GetSessionMessagesResponse>>>;
      try {
        response = await axios.get<V3GetSessionMessagesResponse>(
          `${configuration.serverUrl}/v3/sessions/${encodeURIComponent(this.sessionId)}/messages`,
          {
            params: {
              after_seq: afterSeq,
              limit: 100,
            },
            headers: this.authHeaders(),
            timeout: 60000,
          }
        );
      } catch (err: any) {
        // Session deleted on the server — stop polling permanently, don't retry.
        if (err?.response?.status === 404) {
          logger.debug('[API] fetchMessages: session not found (404), stopping sync', {
            userId: this.userId,
            sessionId: this.sessionId,
            traceId: getProcessTraceContext()?.traceId,
          });
          this.receiveSync.stop();
          return;
        }
        throw err;
      }

      const messages = Array.isArray(response.data.messages) ? response.data.messages : [];
      let maxSeq = afterSeq;

      for (const message of messages) {
        if (message.seq > maxSeq) {
          maxSeq = message.seq;
        }

        if (message.content?.t !== 'encrypted') {
          continue;
        }

        // RFC §19.3: restore trace context from DB-stored traceId for HTTP sync path
        if (message.traceId) {
          setCurrentTurnTrace(resumeTrace(message.traceId));
        }

        try {
          const c = message.content.c;
          const body = await decryptFromWireString(this.encryptionKey, this.encryptionVariant, c);
          this.routeIncomingMessage(body);
        } catch (error) {
          logger.error('[CLI] Message decrypt failed', undefined, {
            userId: this.userId,
            sessionId: this.sessionId,
            messageId: message.id,
            seq: message.seq,
            traceId: message.traceId,
            error: safeStringify(error),
          });
        }
      }

      this.lastSeq = Math.max(this.lastSeq, maxSeq);
      const hasMore = !!response.data.hasMore;
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

  /** Server accepts at most 100 messages per POST. */
  private static readonly FLUSH_BATCH_SIZE = 100;

  private async flushOutbox() {
    if (this.pendingOutbox.length === 0) {
      return;
    }

    // Skip flush if socket is disconnected - wait for reconnection
    if (!this.socket.connected) {
      logger.debug('[apiSession] skipping outbox flush - socket disconnected', {
        userId: this.userId,
        sessionId: this.sessionId,
        count: this.pendingOutbox.length,
      });
      return;
    }

    // Drain in batches — server schema limits each POST to 100 messages.
    while (this.pendingOutbox.length > 0) {
      if (!this.socket.connected) {
        logger.warn('[apiSession] socket disconnected mid-flush, will resume later', {
          sessionId: this.sessionId,
          remaining: this.pendingOutbox.length,
        });
        return;
      }

      const batch = this.pendingOutbox.slice(0, ApiSessionClient.FLUSH_BATCH_SIZE);
      logger.debug('[apiSession] flushing outbox', {
        userId: this.userId,
        sessionId: this.sessionId,
        count: batch.length,
        total: this.pendingOutbox.length,
        ids: batch.map(m => m.id),
        traceIds: batch.map(m => m._trace?.tid).filter(Boolean),
      });

      let response: Awaited<ReturnType<typeof axios.post<V3PostSessionMessagesResponse>>>;
      try {
        response = await axios.post<V3PostSessionMessagesResponse>(
          `${configuration.serverUrl}/v3/sessions/${encodeURIComponent(this.sessionId)}/messages`,
          {
            messages: batch,
          },
          {
            headers: {
              ...this.authHeaders(),
              'X-Socket-Id': this.socket.id ?? '',
            },
            timeout: 60000,
          }
        );
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        const errorMessage = safeStringify(err);
        logger.error('[apiSession] outbox flush failed', undefined, {
          userId: this.userId,
          sessionId: this.sessionId,
          traceId: getProcessTraceContext()?.traceId,
          count: batch.length,
          ids: batch.map(m => m.id),
          status,
          error: errorMessage,
        });
        // Session deleted on the server — stop sending permanently, don't retry.
        if (status === 404) {
          this.sendSync.stop();
          return;
        }
        // Don't retry if socket disconnected after we started
        if (!this.socket.connected) {
          logger.debug('[apiSession] socket disconnected during flush, stopping retry', {
            sessionId: this.sessionId,
          });
          return;
        }
        throw err;
      }

      this.pendingOutbox.splice(0, batch.length);

      const messages = Array.isArray(response.data.messages) ? response.data.messages : [];
      const maxSeq = messages.reduce(
        (acc, message) => (message.seq > acc ? message.seq : acc),
        this.lastSeq
      );
      this.lastSeq = maxSeq;
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
    const encrypted = await encryptToWireString(this.encryptionKey, this.encryptionVariant, content);
    const trace = getWireTrace();
    const id = randomUUID();
    this.pendingOutbox.push({
      content: encrypted,
      id,
      ...(trace ? { _trace: trace } : {}),
    });
    logger.debug('[apiSession] message enqueued', {
      userId: this.userId,
      sessionId: this.sessionId,
      id,
      outboxSize: this.pendingOutbox.length,
      traceId: trace?.tid,
      spanId: trace?.sid,
    });
    this.sendSync.invalidate();
    return id;
  }

  /**
   * Send message to session
   * @param body - Message body (can be MessageContent or raw content for agent messages)
   */
  async sendClaudeSessionMessage(body: RawJSONLines) {
    const mapped = mapClaudeLogMessageToNormalizedMessages(body, this.claudeSessionProtocolState);
    this.claudeSessionProtocolState.currentTurnId = mapped.currentTurnId;
    for (const message of mapped.messages) {
      await this.sendNormalizedMessage(message);
    }
    // Track usage from assistant messages
    if (body.type === 'assistant' && body.message?.usage) {
      try {
        this.sendUsageData(body.message.usage, body.message.model);
      } catch (error) {
        logger.debug('[SOCKET] Failed to send usage data', { userId: this.userId, sessionId: this.sessionId, error: safeStringify(error) });
      }
    }

    // Update metadata with summary if this is a summary message
    if (body.type === 'summary' && 'summary' in body && 'leafUuid' in body) {
      this.updateMetadata(metadata => ({
        ...metadata,
        summary: {
          text: body.summary,
          updatedAt: Date.now(),
        },
      }));
    }
  }

  async closeClaudeSessionTurn(status: SessionTurnEndStatus = 'completed') {
    const mapped = closeClaudeTurnWithStatusNormalized(this.claudeSessionProtocolState, status);
    this.claudeSessionProtocolState.currentTurnId = mapped.currentTurnId;
    for (const message of mapped.messages) {
      await this.sendNormalizedMessage(message);
    }
    // Turn is complete — clear the per-message trace so idle logs don't inherit it.
    setCurrentTurnTrace(undefined);
  }

  /**
   * Legacy transport wrapper kept for older tests and compatibility paths.
   * The daemon/app main path should prefer sendNormalizedMessage().
   */
  async sendCodexMessage(body: any) {
    const content = {
      role: 'agent',
      content: {
        type: 'codex',
        data: body, // This wraps the entire Claude message
      },
      meta: {
        sentFrom: 'cli',
      },
    };
    await this.enqueueMessage(content);
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
  async sendNormalizedMessage(msg: Pick<NormalizedMessage, 'role' | 'content'> & Partial<NormalizedMessage>): Promise<string> {
    return this.enqueueMessage(msg);
  }

  /**
   * Send a generic agent message to the session using ACP (Agent Communication Protocol) format.
   * Works for any agent type (Gemini, Codex, Claude, etc.) - CLI normalizes to unified ACP format.
   *
   * @param provider - The agent provider sending the message (e.g., 'gemini', 'codex', 'claude')
   * @param body - The message payload (type: 'message' | 'reasoning' | 'tool-call' | 'tool-result')
   */
  /**
   * Legacy ACP wrapper kept for compatibility. New daemon output should already
   * be normalized before reaching ApiSessionClient.
   */
  async sendAgentMessage(provider: 'gemini' | 'codex' | 'claude' | 'opencode', body: ACPMessageData) {
    const content = {
      role: 'agent',
      content: {
        type: 'acp',
        provider,
        data: body,
      },
      meta: {
        sentFrom: 'cli',
      },
    };

    const id = await this.enqueueMessage(content);
    logger.debug(`[SOCKET] Sending ACP message from ${provider}`, {
      userId: this.userId,
      sessionId: this.sessionId,
      id,
      type: body.type,
    });
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
    this.socket.emit('session-end', { sid: this.sessionId, time: Date.now(), _trace: getWireTrace() });
  }

  /**
   * Send usage data to the server
   */
  sendUsageData(usage: Usage, model?: string) {
    // Calculate total tokens
    const totalTokens =
      usage.input_tokens +
      usage.output_tokens +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0);

    const costs = calculateCost(usage, model);

    // Transform Claude usage format to backend expected format
    const usageReport = {
      key: 'claude-session',
      sessionId: this.sessionId,
      tokens: {
        total: totalTokens,
        input: usage.input_tokens,
        output: usage.output_tokens,
        cache_creation: usage.cache_creation_input_tokens || 0,
        cache_read: usage.cache_read_input_tokens || 0,
      },
      cost: {
        total: costs.total,
        input: costs.input,
        output: costs.output,
      },
    };
    logger.debug('[SOCKET] Sending usage data', { userId: this.userId, sessionId: this.sessionId });
    this.socket.emit('usage-report', { ...usageReport, _trace: getWireTrace() });
  }

  /**
   * Update session metadata
   * @param handler - Handler function that returns the updated metadata
   */
  updateMetadata(handler: (metadata: Metadata) => Metadata) {
    this.metadataLock.inLock(async () => {
      await backoff(async () => {
        const updated = handler(this.metadata!);
        const answer = await withTimeout(
          this.socket.emitWithAck('update-metadata', {
            sid: this.sessionId,
            expectedVersion: this.metadataVersion,
            metadata: await encryptToWireString(this.encryptionKey, this.encryptionVariant, updated),
            _trace: getWireTrace(),
          }),
          ACK_TIMEOUT,
          'update-metadata',
        );
        if (answer.result === 'success') {
          const am = answer.metadata;
          this.metadata = await decryptFromWireString(this.encryptionKey, this.encryptionVariant, am);
          this.metadataVersion = answer.version;
        } else if (answer.result === 'version-mismatch') {
          if (answer.version > this.metadataVersion) {
            this.metadataVersion = answer.version;
            const am = answer.metadata;
            this.metadata = await decryptFromWireString(this.encryptionKey, this.encryptionVariant, am);
          }
          throw new Error('Metadata version mismatch');
        } else if (answer.result === 'error') {
          // Hard error - ignore
        }
      });
    }).catch(e => {
      logger.error('[apiSession] updateMetadata failed after backoff exhaustion', undefined, { error: String(e) });
    });
  }

  /**
   * Update session agent state
   * @param handler - Handler function that returns the updated agent state
   */
  updateAgentState(handler: (metadata: AgentState) => AgentState) {
    logger.debug('Updating agent state', { userId: this.userId, sessionId: this.sessionId, traceId: getProcessTraceContext()?.traceId });
    this.agentStateLock.inLock(async () => {
      await backoff(async () => {
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
          'update-state',
        );
        if (answer.result === 'success') {
          const as = answer.agentState;
          this.agentState = as
            ? await decryptFromWireString(this.encryptionKey, this.encryptionVariant, as)
            : null;
          this.agentStateVersion = answer.version;
          logger.debug('Agent state updated', { userId: this.userId, sessionId: this.sessionId, traceId: getProcessTraceContext()?.traceId });
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
    }).catch(e => {
      logger.error('[apiSession] updateAgentState failed after backoff exhaustion', undefined, { error: String(e) });
    });
  }

  updateCapabilities(capabilities: SessionCapabilities | null) {
    this.capabilitiesLock.inLock(async () => {
      await backoff(async () => {
        const answer = await withTimeout(
          this.socket.emitWithAck('update-capabilities', {
            sid: this.sessionId,
            expectedVersion: this.capabilitiesVersion,
            _trace: getWireTrace(),
            capabilities: capabilities
              ? await encryptToWireString(this.encryptionKey, this.encryptionVariant, capabilities)
              : null,
          }),
          ACK_TIMEOUT,
          'update-capabilities',
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
    }).catch(e => {
      logger.error('[apiSession] updateCapabilities failed after backoff exhaustion', undefined, { error: String(e) });
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
    await Promise.race([this.sendSync.invalidateAndAwait(), delay(10000)]);
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
    this.sendSync.stop();
    this.receiveSync.stop();
    this.socket.close();
  }
}
