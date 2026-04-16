/**
 * IPCServer — Unix socket server for daemon ↔ CLI communication.
 *
 * Responsibilities:
 *   - Accept CLI connections on ~/.free/daemon.sock
 *   - Route IPCClientMessage commands (attach/detach/send_input/abort/list/spawn/pty)
 *   - Maintain per-session ring-buffer history (last 500 messages, O(1) writes)
 *   - Broadcast IPCServerMessages to all attached sockets for a session
 *
 * Dependency injection:
 *   - sessionManager: injected to avoid IPCServer → SessionManager circular dep
 *   - onSpawnSession: injected callback from daemon/run.ts to avoid circular dep
 *
 * Wire format: newline-delimited JSON (one object per line).
 */

import net from 'node:net';
import fs from 'node:fs';
import readline from 'node:readline';
import os from 'node:os';
import { join } from 'node:path';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify, toError } from '@saaskit-dev/agentbridge';
import type { SessionManager } from '../sessions/SessionManager';
import type { SpawnSessionOptions, SpawnSessionResult } from './protocol';
import type { IPCClientMessage, IPCServerMessage } from './protocol';
import type { NormalizedAgentContent, NormalizedMessage } from '../sessions/types';

const logger = new Logger('daemon/ipc/IPCServer');
const MAX_IPC_MESSAGE_CHARS = 256_000;
const MAX_IPC_STRING_PREVIEW = 4_000;
const MAX_IPC_ARRAY_ITEMS = 20;

// ---------------------------------------------------------------------------
// HistoryRing — O(1) ring buffer for per-session message history
// ---------------------------------------------------------------------------

class HistoryRing {
  private buf: NormalizedMessage[];
  private head = 0; // next write slot
  private count = 0; // current valid element count

  constructor(private readonly capacity: number) {
    this.buf = new Array(capacity);
  }

  push(msg: NormalizedMessage): void {
    this.buf[this.head] = msg;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Returns elements from oldest to newest (for attach replay). */
  toArray(): NormalizedMessage[] {
    if (this.count < this.capacity) {
      return this.buf.slice(0, this.count);
    }
    // Buffer is full: head points to oldest element
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

// ---------------------------------------------------------------------------
// IPCServer
// ---------------------------------------------------------------------------

export class IPCServer {
  private server!: net.Server;
  /** sessionId → sockets currently attached to that session */
  private attachments = new Map<string, Set<net.Socket>>();
  /** Legacy compatibility only: old sessionId → new sessionId for pre-fix dirty state. */
  private legacySessionIdMap = new Map<string, string>();
  /** sessionId → ring buffer of recent agent_output messages */
  private history = new Map<string, HistoryRing>();
  private readonly HISTORY_SIZE = 500;
  private readonly ipcPreviewDir = join(os.tmpdir(), 'agentbridge-ipc-previews');

  /**
   * Recovery gate: when the daemon is recovering persisted sessions at startup,
   * attach requests for unknown sessions are deferred until recovery completes.
   * This prevents a CLI that reconnects quickly from getting an incorrect 'archived' response.
   */
  private recoveryDone: Promise<void> = Promise.resolve();
  private resolveRecovery: (() => void) | null = null;

  /**
   * @param sessionManager Injected to avoid static import cycle.
   * @param onSpawnSession Injected callback from daemon/run.ts.
   * @param onSessionOrphaned Called when a session loses all attached CLI clients.
   */
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly onSpawnSession: (opts: SpawnSessionOptions) => Promise<SpawnSessionResult>,
    private readonly onSessionOrphaned?: (sessionId: string) => void
  ) {}

  async start(socketPath: string): Promise<void> {
    // Remove stale socket file so daemon can restart after a crash
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // File didn't exist — that's fine
    }

    this.server = net.createServer(socket => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(socketPath, resolve);
    });

    // Restrict access to current user only
    fs.chmodSync(socketPath, 0o600);
    logger.info('[IPCServer] listening', { socketPath });
  }

  /**
   * Broadcast a message to all sockets attached to sessionId.
   * Also writes agent_output messages into the session's history ring.
   *
   * Called by AgentSession.pipeBackendOutput() via the injected broadcast callback.
   */
  broadcast(sessionId: string, msg: IPCServerMessage): void {
    const safeMsg = this.makeSocketSafeMessage(sessionId, msg);

    if (safeMsg.type === 'agent_output') {
      let ring = this.history.get(sessionId);
      if (!ring) {
        ring = new HistoryRing(this.HISTORY_SIZE);
        this.history.set(sessionId, ring);
      }
      ring.push(safeMsg.msg);
    }

    const sockets = this.attachments.get(sessionId) ?? new Set();
    if (safeMsg.type === 'session_state') {
      logger.info('[IPCServer] broadcasting session_state', {
        sessionId,
        state: safeMsg.state,
        attachedSockets: sockets.size,
      });
    }
    const line = this.serializeForSocket(safeMsg);
    if (!line) {
      logger.error('[IPCServer] failed to serialize IPC message after fallback', undefined, {
        sessionId,
        msgType: safeMsg.type,
      });
      return;
    }
    const deadSockets: net.Socket[] = [];
    for (const socket of sockets) {
      if (!socket.writable) {
        deadSockets.push(socket);
        continue;
      }
      try {
        const flushed = socket.write(line);
        if (!flushed) {
          logger.debug('[IPCServer] socket send buffer full, backpressure detected', {
            sessionId,
            msgType: msg.type,
          });
        }
      } catch {
        // EPIPE — client disconnected
        deadSockets.push(socket);
      }
    }
    for (const socket of deadSockets) {
      this.cleanup(socket);
    }
  }

  /**
   * Release history buffer and attachment set for a terminated session.
   * Called via SessionManager.unregister() → onEvictHistory callback.
   */
  evictHistory(sessionId: string): void {
    const historySize = this.history.get(sessionId)?.size ?? 0;
    const attachedClients = this.attachments.get(sessionId)?.size ?? 0;
    this.history.delete(sessionId);
    this.attachments.delete(sessionId);
    logger.info('[IPCServer] evicted session history and attachments', {
      sessionId,
      historySize,
      attachedClients,
    });
  }

  /** Return the number of CLI sockets currently attached to a session. */
  getAttachmentCount(sessionId: string): number {
    return this.attachments.get(sessionId)?.size ?? 0;
  }

  /** Legacy compatibility only: map an old session ID to a new one for historical dirty state. */
  addLegacySessionIdMapping(oldId: string, newId: string): void {
    this.legacySessionIdMap.set(oldId, newId);
    logger.info('[IPCServer] legacy session ID mapping added', { oldId, newId });
  }

  private resolveLegacySessionId(requestedId: string): string | null {
    return this.legacySessionIdMap.get(requestedId) ?? null;
  }

  /** Signal that session recovery is starting. Attach requests for unknown sessions will wait. */
  beginRecovery(): void {
    this.recoveryDone = new Promise<void>(resolve => {
      this.resolveRecovery = resolve;
    });
    logger.info('[IPCServer] recovery gate opened');
  }

  /** Signal that session recovery is complete. Deferred attach requests will proceed. */
  endRecovery(): void {
    this.resolveRecovery?.();
    this.resolveRecovery = null;
    logger.info('[IPCServer] recovery gate closed');
  }

  stop(): void {
    this.server?.close();
  }

  // ---------------------------------------------------------------------------
  // Connection handling
  // ---------------------------------------------------------------------------

  private handleConnection(socket: net.Socket): void {
    // crlfDelay: Infinity prevents truncation of large messages split across TCP packets
    const reader = readline.createInterface({ input: socket, crlfDelay: Infinity });

    reader.on('line', line => {
      try {
        const msg = JSON.parse(line) as IPCClientMessage;
        this.handleMessage(socket, msg);
      } catch (err) {
        logger.error('[IPCServer] malformed IPC message', toError(err));
        this.writeToSocket(socket, { type: 'error', message: 'malformed message' });
      }
    });

    socket.on('close', () => this.cleanup(socket));
    socket.on('error', err => {
      logger.error('[IPCServer] socket error', err);
      this.cleanup(socket);
    });
  }

  /**
   * Attach a CLI socket to a session. If the session is not found AND recovery is
   * in progress, waits up to 30s for recovery to complete before responding.
   */
  private async resolveAttachTarget(requestedId: string): Promise<string | null> {
    let resolvedId = requestedId;
    let session = this.sessionManager.get(resolvedId);

    // If not found and recovery is running, wait for recovery then re-check
    if (!session && this.resolveRecovery) {
      logger.info('[IPCServer] attach deferred: waiting for recovery to complete', {
        sessionId: requestedId,
      });
      const waitStart = Date.now();
      let recoveryTimedOut = false;
      await Promise.race([
        this.recoveryDone,
        new Promise<void>(r =>
          setTimeout(() => {
            recoveryTimedOut = true;
            r();
          }, 30_000)
        ),
      ]);
      const waitMs = Date.now() - waitStart;
      session = this.sessionManager.get(requestedId);
      if (session) {
        logger.info('[IPCServer] attach succeeded after recovery wait', {
          sessionId: requestedId,
          waitMs,
        });
        return requestedId;
      }

      const legacyResolvedId = this.resolveLegacySessionId(requestedId);
      if (legacyResolvedId) {
        session = this.sessionManager.get(legacyResolvedId);
        if (session) {
          logger.warn('[IPCServer] attach resolved through legacy session ID mapping', {
            sessionId: requestedId,
            legacyResolvedId,
            waitMs,
          });
          return legacyResolvedId;
        }
      }
      if (recoveryTimedOut) {
        logger.error('[IPCServer] recovery wait timed out (30s): session not available', {
          sessionId: requestedId,
          waitMs,
          // resolveRecovery still set means endRecovery() was never called — daemon recovery loop likely stalled
          recoveryGateStillOpen: this.resolveRecovery !== null,
          activeSessions: this.sessionManager.list().map(s => ({ id: s.sessionId, agent: s.agentType })),
          activeSessionCount: this.sessionManager.list().length,
          knownLegacySessionIdMappings: this.legacySessionIdMap.size,
        });
      } else {
        logger.info('[IPCServer] attach failed after recovery wait: session not recovered', {
          sessionId: requestedId,
          waitMs,
        });
      }
    }

    if (!session) {
      const legacyResolvedId = this.resolveLegacySessionId(requestedId);
      if (legacyResolvedId) {
        session = this.sessionManager.get(legacyResolvedId);
        if (session) {
          logger.warn('[IPCServer] attach resolved through legacy session ID mapping', {
            sessionId: requestedId,
            legacyResolvedId,
          });
          return legacyResolvedId;
        }
      }
    }

    if (!session) {
      return null;
    }

    return resolvedId;
  }

  private async handleAttach(socket: net.Socket, requestedId: string): Promise<void> {
    const resolvedId = await this.resolveAttachTarget(requestedId);
    if (!resolvedId) {
      logger.info('[IPCServer] attach rejected: session not found', {
        sessionId: requestedId,
      });
      this.writeToSocket(socket, {
        type: 'session_state',
        sessionId: requestedId,
        state: 'archived',
      });
      return;
    }

    this.doAttach(socket, resolvedId);
  }

  private doAttach(socket: net.Socket, sessionId: string): void {
    let set = this.attachments.get(sessionId);
    if (!set) {
      set = new Set();
      this.attachments.set(sessionId, set);
    }
    set.add(socket);

    const history = this.history.get(sessionId)?.toArray() ?? [];
    logger.info('[IPCServer] client attached to session', {
      sessionId,
      historySize: history.length,
      attachedClients: set.size,
    });
    this.writeToSocket(socket, this.makeHistoryMessage(sessionId, history));
  }

  private handleMessage(socket: net.Socket, msg: IPCClientMessage): void {
    switch (msg.type) {
      case 'attach': {
        this.handleAttach(socket, msg.sessionId);
        break;
      }

      case 'detach': {
        this.attachments.get(msg.sessionId)?.delete(socket);
        logger.info('[IPCServer] client detached from session', {
          sessionId: msg.sessionId,
          remainingClients: this.attachments.get(msg.sessionId)?.size ?? 0,
        });
        break;
      }

      case 'send_input': {
        // Route through AgentSession public method — never access private backend directly
        const session = this.sessionManager.get(msg.sessionId);
        if (session) {
          logger.info('[IPCServer] send_input routed to session', {
            sessionId: msg.sessionId,
            textLength: msg.text.length,
          });
          session.sendInput(msg.text);
        } else {
          logger.warn('[IPCServer] send_input: session not found, message dropped', {
            sessionId: msg.sessionId,
          });
        }
        break;
      }

      case 'abort': {
        const session = this.sessionManager.get(msg.sessionId);
        if (session) {
          logger.info('[IPCServer] abort routed to session', { sessionId: msg.sessionId });
          session.abort().catch(err => {
            logger.error('[IPCServer] abort failed', toError(err), {
              sessionId: msg.sessionId,
            });
          });
        } else {
          logger.warn('[IPCServer] abort: session not found', { sessionId: msg.sessionId });
        }
        break;
      }

      case 'set_model': {
        const session = this.sessionManager.get(msg.sessionId);
        session?.setModel(msg.modelId).catch(err => {
          logger.error('[IPCServer] set_model failed', toError(err), {
            sessionId: msg.sessionId,
            modelId: msg.modelId,
          });
        });
        break;
      }

      case 'set_mode': {
        const session = this.sessionManager.get(msg.sessionId);
        session?.setMode(msg.modeId).catch(err => {
          logger.error('[IPCServer] set_mode failed', toError(err), {
            sessionId: msg.sessionId,
            modeId: msg.modeId,
          });
        });
        break;
      }

      case 'set_config': {
        const session = this.sessionManager.get(msg.sessionId);
        session?.setConfig(msg.optionId, msg.value).catch(err => {
          logger.error('[IPCServer] set_config failed', toError(err), {
            sessionId: msg.sessionId,
            optionId: msg.optionId,
          });
        });
        break;
      }

      case 'run_command': {
        const session = this.sessionManager.get(msg.sessionId);
        session?.runCommand(msg.commandId).catch(err => {
          logger.error('[IPCServer] run_command failed', toError(err), {
            sessionId: msg.sessionId,
            commandId: msg.commandId,
          });
        });
        break;
      }

      case 'list_sessions': {
        const sessions = this.sessionManager.list().map(s => ({
          ...s.toSummary(),
          attachedClients: this.getAttachmentCount(s.sessionId),
        }));
        this.writeToSocket(socket, { type: 'session_list', sessions });
        break;
      }

      case 'spawn_session': {
        logger.info('[IPCServer] spawn session requested', {
          agent: msg.opts.agent,
          directory: msg.opts.directory,
        });
        this.onSpawnSession(msg.opts)
          .then(result => {
            logger.info('[IPCServer] spawn session completed', {
              agent: msg.opts.agent,
              success: result.type === 'success',
              sessionId: result.type === 'success' ? result.sessionId : undefined,
              error: result.type === 'error' ? result.error : undefined,
            });
            this.writeToSocket(socket, {
              type: 'spawn_result',
              sessionId: result.type === 'success' ? result.sessionId : '',
              success: result.type === 'success',
              error: result.type === 'error' ? result.error : undefined,
            });
          })
          .catch(err => {
            logger.error('[IPCServer] spawn session threw', toError(err), {
              agent: msg.opts.agent,
              directory: msg.opts.directory,
            });
            this.writeToSocket(socket, {
              type: 'spawn_result',
              sessionId: '',
              success: false,
              error: safeStringify(err),
            });
          });
        break;
      }

      case 'pty_data': {
        // CLI → daemon direction: forward raw keystroke bytes to the backend's PTY stdin.
        // ClaudeBackend (local mode) implements sendPtyInput(); other backends ignore it.
        const ptySession = this.sessionManager.get(msg.sessionId);
        if (ptySession) {
          ptySession.sendPtyInput(msg.data);
        } else {
          logger.warn('[IPCServer] pty_data: session not found, data dropped', {
            sessionId: msg.sessionId,
          });
        }
        break;
      }

      case 'pty_resize': {
        // CLI → daemon direction: propagate terminal resize to the backend's PTY.
        const resizeSession = this.sessionManager.get(msg.sessionId);
        if (resizeSession) {
          resizeSession.resizePty(msg.cols, msg.rows);
        } else {
          logger.warn('[IPCServer] pty_resize: session not found', { sessionId: msg.sessionId });
        }
        break;
      }

      case 'switch_mode': {
        // CLI requests switching from remote (SDK) back to local (PTY) mode.
        const switchSession = this.sessionManager.get(msg.sessionId);
        if (switchSession) {
          logger.info('[IPCServer] switch_mode routed to session', { sessionId: msg.sessionId });
          switchSession.requestSwitchToLocal();
        } else {
          logger.warn('[IPCServer] switch_mode: session not found', { sessionId: msg.sessionId });
        }
        break;
      }

      case 'attach_session': {
        // CLI requests attaching to an existing daemon session (no new spawn).
        // Replies with spawn_result (reused intentionally — CLIClient awaits the
        // same message type for both spawn and attach, keeping the handshake simple).
        void this.resolveAttachTarget(msg.sessionId).then(resolvedId => {
          if (resolvedId) {
            logger.info('[IPCServer] attach_session: session found', {
              sessionId: msg.sessionId,
              resolvedId,
            });
            this.writeToSocket(socket, {
              type: 'spawn_result',
              sessionId: resolvedId,
              success: true,
            });
            return;
          }

          logger.info('[IPCServer] attach_session: session not found', {
            sessionId: msg.sessionId,
          });
          this.writeToSocket(socket, {
            type: 'spawn_result',
            sessionId: msg.sessionId,
            success: false,
            error: `Session ${msg.sessionId} not found`,
          });
        });
        break;
      }

      default: {
        const _exhaustive: never = msg;
        logger.warn('[IPCServer] unknown IPC message type', { msg: _exhaustive });
      }
    }
  }

  private writeToSocket(socket: net.Socket, msg: IPCServerMessage): void {
    if (!socket.writable) {
      logger.debug('[IPCServer] writeToSocket: socket not writable, message dropped', {
        type: msg.type,
      });
      return;
    }
    const line = this.serializeForSocket(msg);
    if (!line) {
      logger.error('[IPCServer] writeToSocket: serialization failed after fallback', undefined, {
        type: msg.type,
      });
      return;
    }
    try {
      socket.write(line);
    } catch {
      // EPIPE — client disconnected
      logger.debug('[IPCServer] writeToSocket: write failed (EPIPE)', { type: msg.type });
    }
  }

  private serializeForSocket(msg: IPCServerMessage): string | null {
    try {
      const line = JSON.stringify(msg) + '\n';
      if (line.length > MAX_IPC_MESSAGE_CHARS) {
        return null;
      }
      return line;
    } catch {
      return null;
    }
  }

  private makeSocketSafeMessage(sessionId: string, msg: IPCServerMessage): IPCServerMessage {
    if (this.serializeForSocket(msg)) {
      return msg;
    }
    if (msg.type !== 'agent_output') {
      return {
        type: 'error',
        message: `[IPCServer] ${msg.type} payload too large for local IPC delivery`,
      };
    }

    const fallback = this.makeOversizedPayloadNotice(sessionId, msg.msg);
    logger.warn('[IPCServer] replaced oversized agent_output with local fallback', {
      sessionId,
      originalRole: msg.msg.role,
      messageId: msg.msg.id,
    });
    return fallback;
  }

  private makeHistoryMessage(sessionId: string, msgs: NormalizedMessage[]): IPCServerMessage {
    if (msgs.length === 0) {
      return { type: 'history', sessionId, msgs: [] };
    }

    let trimmed = msgs;
    while (trimmed.length > 0) {
      const candidate: IPCServerMessage = {
        type: 'history',
        sessionId,
        msgs: trimmed,
      };
      if (this.serializeForSocket(candidate)) {
        if (trimmed.length !== msgs.length) {
          logger.warn('[IPCServer] trimmed history replay to fit IPC size limit', {
            sessionId,
            originalCount: msgs.length,
            trimmedCount: trimmed.length,
          });
        }
        return candidate;
      }
      trimmed = trimmed.slice(Math.max(1, Math.floor(trimmed.length / 2)));
    }

    logger.warn('[IPCServer] history replay omitted because payload still exceeded IPC limit', {
      sessionId,
      originalCount: msgs.length,
    });
    return { type: 'history', sessionId, msgs: [this.makeOversizedHistoryNotice(sessionId)] };
  }

  private makeOversizedPayloadNotice(
    sessionId: string,
    original: NormalizedMessage
  ): Extract<IPCServerMessage, { type: 'agent_output' }> {
    if (original.role === 'agent') {
      return {
        type: 'agent_output',
        sessionId,
        msg: {
          ...original,
          content: original.content.map(block => this.makeSocketSafeAgentBlock(block)),
        },
      };
    }

    if (original.role === 'user') {
      return {
        type: 'agent_output',
        sessionId,
        msg: {
          ...original,
          content: {
            type: 'text',
            text: this.truncateString(original.content.text),
          },
        },
      };
    }

    return {
      type: 'agent_output',
      sessionId,
      msg: {
        ...original,
        content: {
          type: 'message',
          message:
            'Local IPC output was truncated for safe streaming. Full content was preserved in server/app history.',
        },
      },
    };
  }

  private makeOversizedHistoryNotice(sessionId: string): NormalizedMessage {
    return {
      id: `ipc-history-${sessionId}`,
      createdAt: Date.now(),
      isSidechain: false,
      role: 'event',
      content: {
        type: 'message',
        message:
          'Local history replay was trimmed to stay within the IPC size limit. Full content remains available in server/app history.',
      },
    };
  }

  private makeSocketSafeAgentBlock(block: NormalizedAgentContent): NormalizedAgentContent {
    switch (block.type) {
      case 'text':
        return { ...block, text: this.truncateString(block.text) };
      case 'thinking':
        return { ...block, thinking: this.truncateString(block.thinking) };
      case 'summary':
        return { ...block, summary: this.truncateString(block.summary) };
      case 'sidechain':
        return { ...block, prompt: this.truncateString(block.prompt) };
      case 'tool-call':
        return {
          ...block,
          input: this.makeSocketSafeUnknown(block.input),
          description: block.description ? this.truncateString(block.description) : block.description,
        };
      case 'tool-result':
        return {
          ...block,
          content: this.makeSocketSafeUnknown(block.content),
        };
    }
  }

  private makeSocketSafeUnknown(value: unknown, depth = 0): unknown {
    if (value == null) return value;
    if (typeof value === 'string') return this.truncateString(value);
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint' ||
      typeof value === 'symbol'
    ) {
      return value;
    }
    if (typeof value === 'function') {
      return safeStringify(value);
    }
    if (depth >= 4) {
      return '[Truncated nested value for IPC safety]';
    }
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_IPC_ARRAY_ITEMS)
        .map(item => this.makeSocketSafeUnknown(item, depth + 1));
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_IPC_ARRAY_ITEMS);
      return Object.fromEntries(
        entries.map(([key, nested]) => [key, this.makeSocketSafeUnknown(nested, depth + 1)])
      );
    }
    return safeStringify(value);
  }

  private truncateString(value: string): string {
    if (value.length <= MAX_IPC_STRING_PREVIEW) {
      return value;
    }
    const previewPath = this.writeOversizedPreview(value);
    const suffix = previewPath
      ? `\n...[truncated for local IPC, original length=${value.length}, full output saved to ${previewPath}]`
      : `\n...[truncated for local IPC, original length=${value.length}]`;
    return value.slice(0, MAX_IPC_STRING_PREVIEW) + suffix;
  }

  private writeOversizedPreview(value: string): string | null {
    try {
      fs.mkdirSync(this.ipcPreviewDir, { recursive: true, mode: 0o700 });
      const filename = `ipc-preview-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.txt`;
      const filePath = join(this.ipcPreviewDir, filename);
      fs.writeFileSync(filePath, value, { encoding: 'utf-8', mode: 0o600 });
      return filePath;
    } catch (error) {
      logger.warn('[IPCServer] failed to persist oversized IPC preview', {
        error: safeStringify(error),
      });
      return null;
    }
  }

  private cleanup(socket: net.Socket): void {
    for (const [sessionId, set] of this.attachments.entries()) {
      const wasAttached = set.delete(socket);
      if (wasAttached && set.size === 0 && this.onSessionOrphaned) {
        logger.info('[IPCServer] session has no attached clients, triggering orphan callback', {
          sessionId,
        });
        this.onSessionOrphaned(sessionId);
      }
    }
  }
}
