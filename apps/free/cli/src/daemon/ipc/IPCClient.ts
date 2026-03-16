/**
 * IPCClient — Unix socket client for CLI ↔ Daemon communication.
 *
 * Features:
 *   - Connects to daemon.sock and reads newline-delimited JSON
 *   - Multi-handler dispatch: Map<type, Set<handler>> so multiple listeners
 *     can subscribe to the same message type without overwriting each other
 *   - Exponential back-off reconnect (500ms → 10s)
 *   - send_input buffering during reconnect window (up to 16 messages)
 *   - onReconnect callback: lets CLIClient re-attach sessions after reconnect
 *
 * Wire format: newline-delimited JSON (one object per line).
 */

import net from 'node:net';
import readline from 'node:readline';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify, toError } from '@saaskit-dev/agentbridge';
import type { IPCClientMessage, IPCServerMessage } from './protocol';

const logger = new Logger('daemon/ipc/IPCClient');

export class IPCClient {
  private socket!: net.Socket;
  /** Set-based handler map: multiple listeners per message type */
  private handlers = new Map<IPCServerMessage['type'], Set<(msg: IPCServerMessage) => void>>();
  private socketPath!: string;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectDelay = 500;
  private readonly MAX_RECONNECT_DELAY_MS = 10_000;
  private destroyed = false;
  private reconnectAttempt = 0;

  /**
   * send_input messages buffered during reconnect window.
   * Upper bound prevents unbounded growth when daemon is unreachable for a long time.
   */
  private readonly PENDING_SEND_INPUT_LIMIT = 16;
  private pendingSendInputs: Array<Extract<IPCClientMessage, { type: 'send_input' }>> = [];

  /**
   * Called after a successful reconnect, before replaying buffered send_inputs.
   * Use this to re-send 'attach' messages so daemon resumes routing output.
   */
  onReconnect?: () => void;

  async connect(socketPath: string): Promise<void> {
    this.socketPath = socketPath;
    logger.info('[IPCClient] connecting to daemon', { socketPath });
    await this.doConnect();
    logger.info('[IPCClient] connected to daemon', { socketPath });
  }

  private async doConnect(): Promise<void> {
    this.socket = net.createConnection(this.socketPath);

    await new Promise<void>((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);
    });

    // Successful connection — reset back-off
    this.reconnectDelay = 500;
    this.reconnectAttempt = 0;

    const reader = readline.createInterface({ input: this.socket, crlfDelay: Infinity });

    reader.on('line', (line) => {
      try {
        const msg = JSON.parse(line) as IPCServerMessage;
        this.dispatch(msg);
      } catch (err) {
        logger.error('[IPCClient] malformed message from daemon', toError(err));
      }
    });

    this.socket.on('close', (hadError) => {
      if (!this.destroyed) {
        logger.info('[IPCClient] socket closed, will reconnect', { hadError, socketPath: this.socketPath });
        this.scheduleReconnect();
      } else {
        logger.debug('[IPCClient] socket closed (destroyed, no reconnect)');
      }
    });

    this.socket.on('error', (err) => {
      // close event fires after error and triggers reconnect; just log here
      logger.error('[IPCClient] socket error', err);
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    logger.info('[IPCClient] scheduling reconnect', {
      delayMs: this.reconnectDelay,
      attempt: this.reconnectAttempt,
      bufferedSendInputs: this.pendingSendInputs.length,
    });
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.doConnect();
        logger.info('[IPCClient] reconnected to daemon', { attempt: this.reconnectAttempt });

        // Re-attach sessions FIRST so daemon is ready to route
        try {
          this.onReconnect?.();
        } catch (err) {
          logger.error('[IPCClient] onReconnect callback failed', toError(err));
        }

        // Then replay buffered send_inputs in order (check writable in case socket closed during onReconnect)
        const pending = this.pendingSendInputs.splice(0);
        if (pending.length > 0) {
          logger.info('[IPCClient] replaying buffered send_inputs', { count: pending.length });
        }
        for (const msg of pending) {
          if (!this.socket?.writable) {
            const remaining = pending.slice(pending.indexOf(msg));
            logger.warn('[IPCClient] socket closed during replay, re-buffering remaining', { remaining: remaining.length });
            this.pendingSendInputs.push(...remaining);
            break;
          }
          this.socket.write(JSON.stringify(msg) + '\n');
        }
      } catch (err) {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.MAX_RECONNECT_DELAY_MS);
        logger.warn('[IPCClient] reconnect failed, backing off', {
          attempt: this.reconnectAttempt,
          nextDelayMs: this.reconnectDelay,
          error: safeStringify(err),
        });
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }

  send(msg: IPCClientMessage): void {
    if (this.socket?.writable) {
      this.socket.write(JSON.stringify(msg) + '\n');
      return;
    }

    // Socket is not writable (reconnect window)
    if (msg.type === 'send_input') {
      if (this.pendingSendInputs.length < this.PENDING_SEND_INPUT_LIMIT) {
        this.pendingSendInputs.push(msg);
        logger.warn('[IPCClient] daemon reconnecting, send_input buffered', {
          sessionId: msg.sessionId,
          buffered: this.pendingSendInputs.length,
        });
      } else {
        logger.error('[IPCClient] send_input dropped: pending buffer full', undefined, {
          sessionId: msg.sessionId,
          limit: this.PENDING_SEND_INPUT_LIMIT,
        });
      }
    } else {
      // Other message types (attach, detach, etc.) are not buffered:
      // attach is replayed via onReconnect; others are fire-and-forget.
      logger.debug('[IPCClient] message dropped (socket not writable, non-bufferable type)', { type: msg.type });
    }
  }

  on(type: IPCServerMessage['type'], handler: (msg: IPCServerMessage) => void): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
  }

  off(type: IPCServerMessage['type'], handler: (msg: IPCServerMessage) => void): void {
    this.handlers.get(type)?.delete(handler);
  }

  disconnect(): void {
    logger.info('[IPCClient] disconnecting', {
      bufferedSendInputs: this.pendingSendInputs.length,
      hadReconnectTimer: this.reconnectTimer != null,
    });
    this.destroyed = true;
    clearTimeout(this.reconnectTimer);
    this.pendingSendInputs = [];
    this.socket?.destroy();
  }

  private dispatch(msg: IPCServerMessage): void {
    const handlers = this.handlers.get(msg.type);
    if (!handlers || handlers.size === 0) {
      logger.debug('[IPCClient] no handlers for message type', { type: msg.type });
      return;
    }
    for (const h of handlers) {
      try {
        h(msg);
      } catch (err) {
        logger.error('[IPCClient] handler threw', toError(err), { type: msg.type });
      }
    }
  }
}
