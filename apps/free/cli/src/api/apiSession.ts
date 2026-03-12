import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { registerCommonHandlers } from '../modules/common/registerCommonHandlers';
import { decodeBase64, decrypt, encodeBase64, encrypt } from './encryption';
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
import { setCurrentTurnTrace, getProcessTraceContext } from '@/telemetry';
import { continueTrace, resumeTrace, injectTrace } from '@saaskit-dev/agentbridge/telemetry';
import type { WireTrace } from './types';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { AsyncLock } from '@/utils/lock';
import { calculateCost } from '@/utils/pricing';
import { InvalidateSync } from '@/utils/sync';
import { backoff, delay } from '@/utils/time';
import type { SessionEnvelope } from '@/sessionProtocol/types';
import type { SessionTurnEndStatus } from '@/sessionProtocol/types';
import {

  closeClaudeTurnWithStatus,
  mapClaudeLogMessageToSessionEnvelopes,
  type ClaudeSessionProtocolState,
} from '@/claude/utils/sessionProtocolMapper';

const logger = new Logger('api/apiSession');

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
  localId: string | null;
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
    localId: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
};

export class ApiSessionClient extends EventEmitter {
  private readonly token: string;
  readonly sessionId: string;
  private metadata: Metadata | null;
  private metadataVersion: number;
  private agentState: AgentState | null;
  private agentStateVersion: number;
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private pendingMessages: UserMessage[] = [];
  private pendingMessageCallback: ((message: UserMessage) => void) | null = null;
  readonly rpcHandlerManager: RpcHandlerManager;
  private agentStateLock = new AsyncLock();
  private metadataLock = new AsyncLock();
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
  private pendingOutbox: Array<{ content: string; localId: string; _trace?: WireTrace }> = [];
  private readonly sendSync: InvalidateSync;
  private readonly receiveSync: InvalidateSync;

  constructor(token: string, session: Session) {
    super();
    this.token = token;
    this.sessionId = session.id;
    this.metadata = session.metadata;
    this.metadataVersion = session.metadataVersion;
    this.agentState = session.agentState;
    this.agentStateVersion = session.agentStateVersion;
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

    //
    // Handlers
    //

    this.socket.on('connect', () => {
      logger.info('[CLI] Session connected', { sessionId: this.sessionId });
      this.rpcHandlerManager.onSocketConnect(this.socket);
      this.receiveSync.invalidate();
    });

    // Set up global RPC request handler
    this.socket.on(
      'rpc-request',
      async (data: { method: string; params: string }, callback: (response: string) => void) => {
        callback(await this.rpcHandlerManager.handleRequest(data));
      }
    );

    this.socket.on('disconnect', reason => {
      logger.info('[CLI] Session disconnected', { sessionId: this.sessionId, reason });
      this.rpcHandlerManager.onSocketDisconnect();
    });

    this.socket.on('connect_error', error => {
      logger.error('[CLI] Session connect failed', undefined, { sessionId: this.sessionId, error: error.message });
      this.rpcHandlerManager.onSocketDisconnect();
    });

    // Server events
    this.socket.on('update', (data: Update) => {
      try {
        logger.debug('[SOCKET] [UPDATE] Received update');

        if (!data.body) {
          logger.debug('[SOCKET] [UPDATE] [ERROR] No body in update!');
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
          const body = decrypt(
            this.encryptionKey,
            this.encryptionVariant,
            decodeBase64(data.body.message.content.c)
          );
          logger.debug('[SOCKET] [UPDATE] Processing message (fast path)', {
            sessionId: this.sessionId,
            seq: messageSeq,
          });
          this.routeIncomingMessage(body);
          this.lastSeq = messageSeq;
        } else if (data.body.t === 'update-session') {
          if (data.body.metadata && data.body.metadata.version > this.metadataVersion) {
            this.metadata = decrypt(
              this.encryptionKey,
              this.encryptionVariant,
              decodeBase64(data.body.metadata.value)
            );
            this.metadataVersion = data.body.metadata.version;
          }
          if (data.body.agentState && data.body.agentState.version > this.agentStateVersion) {
            this.agentState = data.body.agentState.value
              ? decrypt(
                  this.encryptionKey,
                  this.encryptionVariant,
                  decodeBase64(data.body.agentState.value)
                )
              : null;
            this.agentStateVersion = data.body.agentState.version;
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
    while (this.pendingMessages.length > 0) {
      callback(this.pendingMessages.shift()!);
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
      logger.debug('[apiSession] routing user message to callback', {
        sessionId: this.sessionId,
        hasCallback: !!this.pendingMessageCallback,
      });
      if (this.pendingMessageCallback) {
        this.pendingMessageCallback(userResult.data);
      } else {
        this.pendingMessages.push(userResult.data);
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
            sessionId: this.sessionId,
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
          const body = decrypt(
            this.encryptionKey,
            this.encryptionVariant,
            decodeBase64(message.content.c)
          );
          this.routeIncomingMessage(body);
        } catch (error) {
          logger.error('[CLI] Message decrypt failed', undefined, {
            sessionId: this.sessionId,
            seq: message.seq,
            error: String(error),
          });
        }
      }

      this.lastSeq = Math.max(this.lastSeq, maxSeq);
      const hasMore = !!response.data.hasMore;
      if (hasMore && maxSeq === afterSeq) {
        logger.debug('[API] fetchMessages pagination stalled, stopping to avoid infinite loop', {
          sessionId: this.sessionId,
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

  private async flushOutbox() {
    if (this.pendingOutbox.length === 0) {
      return;
    }

    // Skip flush if socket is disconnected - wait for reconnection
    if (!this.socket.connected) {
      logger.debug('[apiSession] skipping outbox flush - socket disconnected', {
        sessionId: this.sessionId,
        count: this.pendingOutbox.length,
      });
      return;
    }

    const batch = this.pendingOutbox.slice();
    logger.debug('[apiSession] flushing outbox', { sessionId: this.sessionId, count: batch.length });

    let response: Awaited<ReturnType<typeof axios.post<V3PostSessionMessagesResponse>>>;
    try {
      response = await axios.post<V3PostSessionMessagesResponse>(
        `${configuration.serverUrl}/v3/sessions/${encodeURIComponent(this.sessionId)}/messages`,
        {
          messages: batch,
        },
        {
          headers: this.authHeaders(),
          timeout: 60000,
        }
      );
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('[apiSession] outbox flush failed', undefined, {
        sessionId: this.sessionId,
        count: batch.length,
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
    logger.debug('[apiSession] outbox flushed', { sessionId: this.sessionId, count: batch.length });
  }

  private enqueueMessage(content: unknown) {
    const encrypted = encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, content));
    const trace = getWireTrace();
    const localId = randomUUID();
    this.pendingOutbox.push({
      content: encrypted,
      localId,
      ...(trace ? { _trace: trace } : {}),
    });
    logger.debug('[apiSession] message enqueued', {
      sessionId: this.sessionId,
      localId,
      outboxSize: this.pendingOutbox.length,
      traceId: trace?.tid,
    });
    this.sendSync.invalidate();
  }

  /**
   * Send message to session
   * @param body - Message body (can be MessageContent or raw content for agent messages)
   */
  sendClaudeSessionMessage(body: RawJSONLines) {
    const mapped = mapClaudeLogMessageToSessionEnvelopes(body, this.claudeSessionProtocolState);
    this.claudeSessionProtocolState.currentTurnId = mapped.currentTurnId;
    for (const envelope of mapped.envelopes) {
      this.sendSessionProtocolMessage(envelope);
    }
    // Track usage from assistant messages
    if (body.type === 'assistant' && body.message?.usage) {
      try {
        this.sendUsageData(body.message.usage, body.message.model);
      } catch (error) {
        logger.debug('[SOCKET] Failed to send usage data:', error);
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

  closeClaudeSessionTurn(status: SessionTurnEndStatus = 'completed') {
    const mapped = closeClaudeTurnWithStatus(this.claudeSessionProtocolState, status);
    this.claudeSessionProtocolState.currentTurnId = mapped.currentTurnId;
    for (const envelope of mapped.envelopes) {
      this.sendSessionProtocolMessage(envelope);
    }
    // Turn is complete — clear the per-message trace so idle logs don't inherit it.
    setCurrentTurnTrace(undefined);
  }

  sendCodexMessage(body: any) {
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
    this.enqueueMessage(content);
  }

  sendSessionProtocolMessage(envelope: SessionEnvelope) {
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

    this.enqueueMessage(content);
  }

  /**
   * Send a generic agent message to the session using ACP (Agent Communication Protocol) format.
   * Works for any agent type (Gemini, Codex, Claude, etc.) - CLI normalizes to unified ACP format.
   *
   * @param provider - The agent provider sending the message (e.g., 'gemini', 'codex', 'claude')
   * @param body - The message payload (type: 'message' | 'reasoning' | 'tool-call' | 'tool-result')
   */
  sendAgentMessage(provider: 'gemini' | 'codex' | 'claude' | 'opencode', body: ACPMessageData) {
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

    logger.debug(`[SOCKET] Sending ACP message from ${provider}:`, {
      type: body.type,
      hasMessage: 'message' in body,
    });

    this.enqueueMessage(content);
  }

  sendSessionEvent(
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
    const content = {
      role: 'agent',
      content: {
        id: id ?? randomUUID(),
        type: 'event',
        data: event,
      },
    };
    this.enqueueMessage(content);
  }

  /**
   * Send a ping message to keep the connection alive
   */
  keepAlive(thinking: boolean, mode: 'local' | 'remote') {
    if (process.env.DEBUG) {
      // too verbose for production
      logger.debug(`[API] Sending keep alive message: ${thinking}`);
    }
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
    logger.debug('[SOCKET] Sending usage data');
    this.socket.emit('usage-report', { ...usageReport, _trace: getWireTrace() });
  }

  /**
   * Update session metadata
   * @param handler - Handler function that returns the updated metadata
   */
  updateMetadata(handler: (metadata: Metadata) => Metadata) {
    this.metadataLock.inLock(async () => {
      await backoff(async () => {
        const updated = handler(this.metadata!); // Weird state if metadata is null - should never happen but here we are
        const answer = await this.socket.emitWithAck('update-metadata', {
          sid: this.sessionId,
          expectedVersion: this.metadataVersion,
          metadata: encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, updated)),
          _trace: getWireTrace(),
        });
        if (answer.result === 'success') {
          this.metadata = decrypt(
            this.encryptionKey,
            this.encryptionVariant,
            decodeBase64(answer.metadata)
          );
          this.metadataVersion = answer.version;
        } else if (answer.result === 'version-mismatch') {
          if (answer.version > this.metadataVersion) {
            this.metadataVersion = answer.version;
            this.metadata = decrypt(
              this.encryptionKey,
              this.encryptionVariant,
              decodeBase64(answer.metadata)
            );
          }
          throw new Error('Metadata version mismatch');
        } else if (answer.result === 'error') {
          // Hard error - ignore
        }
      });
    });
  }

  /**
   * Update session agent state
   * @param handler - Handler function that returns the updated agent state
   */
  updateAgentState(handler: (metadata: AgentState) => AgentState) {
    logger.debug('Updating agent state');
    this.agentStateLock.inLock(async () => {
      await backoff(async () => {
        const updated = handler(this.agentState || {});
        const answer = await this.socket.emitWithAck('update-state', {
          sid: this.sessionId,
          expectedVersion: this.agentStateVersion,
          _trace: getWireTrace(),
          agentState: updated
            ? encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, updated))
            : null,
        });
        if (answer.result === 'success') {
          this.agentState = answer.agentState
            ? decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(answer.agentState))
            : null;
          this.agentStateVersion = answer.version;
          logger.debug('Agent state updated', this.agentState);
        } else if (answer.result === 'version-mismatch') {
          if (answer.version > this.agentStateVersion) {
            this.agentStateVersion = answer.version;
            this.agentState = answer.agentState
              ? decrypt(this.encryptionKey, this.encryptionVariant, decodeBase64(answer.agentState))
              : null;
          }
          throw new Error('Agent state version mismatch');
        } else if (answer.result === 'error') {
          // console.error('Agent state update error', answer);
          // Hard error - ignore
        }
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
