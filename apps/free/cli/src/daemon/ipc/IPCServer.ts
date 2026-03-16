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
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify, toError } from '@saaskit-dev/agentbridge';
import type { SessionManager } from '../sessions/SessionManager';
import type { SpawnSessionOptions, SpawnSessionResult } from './protocol';
import type { IPCClientMessage, IPCServerMessage } from './protocol';
import type { NormalizedMessage } from '../sessions/types';

const logger = new Logger('daemon/ipc/IPCServer');

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
  /** old sessionId → new sessionId (populated when a recovered session gets a new ID from the server) */
  private sessionIdMap = new Map<string, string>();
  /** sessionId → ring buffer of recent agent_output messages */
  private history = new Map<string, HistoryRing>();
  private readonly HISTORY_SIZE = 500;

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
    private readonly onSessionOrphaned?: (sessionId: string) => void,
  ) {}

  async start(socketPath: string): Promise<void> {
    // Remove stale socket file so daemon can restart after a crash
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // File didn't exist — that's fine
    }

    this.server = net.createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(socketPath, resolve);
    });

    // Restrict access to current user only
    fs.chmodSync(socketPath, 0o600);
    logger.debug('[IPCServer] listening', { socketPath });
  }

  /**
   * Broadcast a message to all sockets attached to sessionId.
   * Also writes agent_output messages into the session's history ring.
   *
   * Called by AgentSession.pipeBackendOutput() via the injected broadcast callback.
   */
  broadcast(sessionId: string, msg: IPCServerMessage): void {
    if (msg.type === 'agent_output') {
      let ring = this.history.get(sessionId);
      if (!ring) {
        ring = new HistoryRing(this.HISTORY_SIZE);
        this.history.set(sessionId, ring);
      }
      ring.push(msg.msg);
    }

    const sockets = this.attachments.get(sessionId) ?? new Set();
    if (msg.type === 'session_state') {
      logger.info('[IPCServer] broadcasting session_state', {
        sessionId,
        state: (msg as { state: string }).state,
        attachedSockets: sockets.size,
      });
    }
    const line = JSON.stringify(msg) + '\n';
    for (const socket of sockets) {
      const flushed = socket.write(line);
      if (!flushed) {
        logger.debug('[IPCServer] socket send buffer full, backpressure detected', {
          sessionId,
          msgType: msg.type,
        });
      }
    }
  }

  /**
   * Release history buffer and attachment set for a terminated session.
   * Called via SessionManager.unregister() → onEvictHistory callback.
   */
  evictHistory(sessionId: string): void {
    this.history.delete(sessionId);
    this.attachments.delete(sessionId);
  }

  /** Return the number of CLI sockets currently attached to a session. */
  getAttachmentCount(sessionId: string): number {
    return this.attachments.get(sessionId)?.size ?? 0;
  }

  /** Map an old session ID to a new one (used after recovery when server re-assigns IDs). */
  addSessionIdMapping(oldId: string, newId: string): void {
    this.sessionIdMap.set(oldId, newId);
  }

  /** Signal that session recovery is starting. Attach requests for unknown sessions will wait. */
  beginRecovery(): void {
    this.recoveryDone = new Promise<void>(resolve => {
      this.resolveRecovery = resolve;
    });
    logger.debug('[IPCServer] recovery gate opened');
  }

  /** Signal that session recovery is complete. Deferred attach requests will proceed. */
  endRecovery(): void {
    this.resolveRecovery?.();
    this.resolveRecovery = null;
    logger.debug('[IPCServer] recovery gate closed');
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

    reader.on('line', (line) => {
      try {
        const msg = JSON.parse(line) as IPCClientMessage;
        this.handleMessage(socket, msg);
      } catch (err) {
        logger.error('[IPCServer] malformed IPC message', toError(err));
        this.writeToSocket(socket, { type: 'error', message: 'malformed message' });
      }
    });

    socket.on('close', () => this.cleanup(socket));
    socket.on('error', (err) => {
      logger.error('[IPCServer] socket error', err);
      this.cleanup(socket);
    });
  }

  /**
   * Attach a CLI socket to a session. If the session is not found AND recovery is
   * in progress, waits up to 30s for recovery to complete before responding.
   */
  private async handleAttach(socket: net.Socket, requestedId: string): Promise<void> {
    const resolvedId = this.sessionIdMap.get(requestedId) ?? requestedId;
    let session = this.sessionManager.get(resolvedId);

    // If not found and recovery is running, wait for recovery then re-check
    if (!session && this.resolveRecovery) {
      logger.info('[IPCServer] attach deferred: waiting for recovery to complete', { sessionId: requestedId });
      const waitStart = Date.now();
      await Promise.race([
        this.recoveryDone,
        new Promise<void>(r => setTimeout(r, 30_000)),
      ]);
      const waitMs = Date.now() - waitStart;
      // Re-resolve: recovery may have added a mapping
      const postRecoveryId = this.sessionIdMap.get(requestedId) ?? requestedId;
      session = this.sessionManager.get(postRecoveryId);
      if (session) {
        logger.info('[IPCServer] attach succeeded after recovery wait', { sessionId: requestedId, resolvedId: postRecoveryId, waitMs });
        this.doAttach(socket, postRecoveryId);
        return;
      }
      logger.info('[IPCServer] attach failed after recovery wait: session not recovered', { sessionId: requestedId, waitMs });
    }

    if (!session) {
      logger.info('[IPCServer] attach rejected: session not found', { sessionId: requestedId, resolvedId });
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
    this.writeToSocket(socket, {
      type: 'history',
      sessionId,
      msgs: history,
    });
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
          logger.debug('[IPCServer] send_input: session not found', { sessionId: msg.sessionId });
        }
        break;
      }

      case 'abort': {
        const session = this.sessionManager.get(msg.sessionId);
        session?.abort().catch((err) => {
          logger.error('[IPCServer] abort failed', toError(err), {
            sessionId: msg.sessionId,
          });
        });
        break;
      }

      case 'set_model': {
        const session = this.sessionManager.get(msg.sessionId);
        session?.setModel(msg.modelId).catch((err) => {
          logger.error('[IPCServer] set_model failed', toError(err), {
            sessionId: msg.sessionId,
            modelId: msg.modelId,
          });
        });
        break;
      }

      case 'set_mode': {
        const session = this.sessionManager.get(msg.sessionId);
        session?.setMode(msg.modeId).catch((err) => {
          logger.error('[IPCServer] set_mode failed', toError(err), {
            sessionId: msg.sessionId,
            modeId: msg.modeId,
          });
        });
        break;
      }

      case 'set_config': {
        const session = this.sessionManager.get(msg.sessionId);
        session?.setConfig(msg.optionId, msg.value).catch((err) => {
          logger.error('[IPCServer] set_config failed', toError(err), {
            sessionId: msg.sessionId,
            optionId: msg.optionId,
          });
        });
        break;
      }

      case 'run_command': {
        const session = this.sessionManager.get(msg.sessionId);
        session?.runCommand(msg.commandId).catch((err) => {
          logger.error('[IPCServer] run_command failed', toError(err), {
            sessionId: msg.sessionId,
            commandId: msg.commandId,
          });
        });
        break;
      }

      case 'list_sessions': {
        const sessions = this.sessionManager.list().map((s) => ({
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
          .then((result) => {
            this.writeToSocket(socket, {
              type: 'spawn_result',
              sessionId: result.type === 'success' ? result.sessionId : '',
              success: result.type === 'success',
              error: result.type === 'error' ? result.error : undefined,
            });
          })
          .catch((err) => {
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
          logger.debug('[IPCServer] pty_data: session not found', { sessionId: msg.sessionId });
        }
        break;
      }

      case 'pty_resize': {
        // CLI → daemon direction: propagate terminal resize to the backend's PTY.
        const resizeSession = this.sessionManager.get(msg.sessionId);
        if (resizeSession) {
          resizeSession.resizePty(msg.cols, msg.rows);
        } else {
          logger.debug('[IPCServer] pty_resize: session not found', { sessionId: msg.sessionId });
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
          logger.debug('[IPCServer] switch_mode: session not found', { sessionId: msg.sessionId });
        }
        break;
      }

      case 'attach_session': {
        // CLI requests attaching to an existing daemon session (no new spawn).
        // Replies with spawn_result (reused intentionally — CLIClient awaits the
        // same message type for both spawn and attach, keeping the handshake simple).
        const existingSession = this.sessionManager.get(msg.sessionId);
        if (existingSession) {
          logger.info('[IPCServer] attach_session: session found', { sessionId: msg.sessionId });
          this.writeToSocket(socket, {
            type: 'spawn_result',
            sessionId: msg.sessionId,
            success: true,
          });
        } else {
          logger.info('[IPCServer] attach_session: session not found', { sessionId: msg.sessionId });
          this.writeToSocket(socket, {
            type: 'spawn_result',
            sessionId: msg.sessionId,
            success: false,
            error: `Session ${msg.sessionId} not found`,
          });
        }
        break;
      }

      default: {
        const _exhaustive: never = msg;
        logger.warn('[IPCServer] unknown IPC message type', { msg: _exhaustive });
      }
    }
  }

  private writeToSocket(socket: net.Socket, msg: IPCServerMessage): void {
    if (socket.writable) {
      socket.write(JSON.stringify(msg) + '\n');
    }
  }

  private cleanup(socket: net.Socket): void {
    for (const [sessionId, set] of this.attachments.entries()) {
      const wasAttached = set.delete(socket);
      if (wasAttached && set.size === 0 && this.onSessionOrphaned) {
        logger.info('[IPCServer] session has no attached clients, triggering orphan callback', { sessionId });
        this.onSessionOrphaned(sessionId);
      }
    }
  }
}
