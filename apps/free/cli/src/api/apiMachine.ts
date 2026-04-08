/**
 * WebSocket client for machine/daemon communication with Free server
 * Similar to ApiSessionClient but for machine-scoped connections
 */

import { io, Socket } from 'socket.io-client';
import {
  registerCommonHandlers,
  SpawnSessionOptions,
  SpawnSessionResult,
} from '../modules/common/registerCommonHandlers';
import { encryptToWireString, decryptFromWireString } from './encryption';
import { RpcHandlerManager } from './rpc/RpcHandlerManager';
import {
  MachineMetadata,
  DaemonState,
  Machine,
  Update,
  UpdateMachineBody,
  WireTrace,
} from './types';
import { configuration } from '@/configuration';
import { getProcessTraceContext } from '@/telemetry';
import { injectTrace } from '@saaskit-dev/agentbridge/telemetry';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { backoff } from '@/utils/time';

const logger = new Logger('api/apiMachine');

/** Extract current process trace context as a WireTrace for socket emits. */
function getWireTrace(): WireTrace | undefined {
  const ctx = getProcessTraceContext();
  if (!ctx) return undefined;
  const obj: Record<string, unknown> = {};
  injectTrace(ctx, obj);
  return obj._trace as WireTrace | undefined;
}
interface ServerToDaemonEvents {
  update: (data: Update) => void;
  'rpc-request': (
    data: { method: string; params: string },
    callback: (response: string) => void
  ) => void;
  'rpc-registered': (data: { method: string }) => void;
  'rpc-unregistered': (data: { method: string }) => void;
  'rpc-error': (data: { type: string; error: string }) => void;
  auth: (data: { success: boolean; user: string }) => void;
  error: (data: { message: string }) => void;
}

interface DaemonToServerEvents {
  'machine-alive': (data: { machineId: string; time: number; _trace?: WireTrace }) => void;

  'machine-update-metadata': (
    data: {
      machineId: string;
      metadata: string; // Encrypted MachineMetadata
      expectedVersion: number;
      _trace?: WireTrace;
    },
    cb: (
      answer:
        | {
            result: 'error';
          }
        | {
            result: 'version-mismatch';
            version: number;
            metadata: string;
          }
        | {
            result: 'success';
            version: number;
            metadata: string;
          }
    ) => void
  ) => void;

  'machine-update-state': (
    data: {
      machineId: string;
      daemonState: string; // Encrypted DaemonState
      expectedVersion: number;
      _trace?: WireTrace;
    },
    cb: (
      answer:
        | {
            result: 'error';
          }
        | {
            result: 'version-mismatch';
            version: number;
            daemonState: string;
          }
        | {
            result: 'success';
            version: number;
            daemonState: string;
          }
    ) => void
  ) => void;

  'rpc-register': (data: { method: string }) => void;
  'rpc-unregister': (data: { method: string }) => void;
  'rpc-call': (
    data: { method: string; params: any },
    callback: (response: { ok: boolean; result?: any; error?: string }) => void
  ) => void;
  'machine-recovery-done': (data: {
    machineId: string;
    recoveredSessionIds: string[];
  }) => void;
}

type MachineRpcHandlers = {
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  stopSession: (sessionId: string) => boolean;
  listSupportedAgents: () => string[];
  listExternalAgentSessions: (params: { token?: string; forceRefresh?: boolean }) => Promise<unknown>;
  listExternalAgentSessionsForAgent: (params: {
    agentType: string;
    token?: string;
    forceRefresh?: boolean;
  }) => Promise<unknown>;
  requestShutdown: () => void;
};

export class ApiMachineClient {
  private socket!: Socket<ServerToDaemonEvents, DaemonToServerEvents>;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private rpcHandlerManager: RpcHandlerManager;
  /** Pending recovery-done payload — sent on first connect, then cleared. */
  private pendingRecoveryDone: string[] | null = null;
  private lastConnectedAt: number | null = null;
  private lastDisconnectAt: number | null = null;
  private lastDisconnectReason: string | null = null;

  constructor(
    private token: string,
    private machine: Machine
  ) {
    // Initialize RPC handler manager
    this.rpcHandlerManager = new RpcHandlerManager({
      scopePrefix: this.machine.id,
      encryptionKey: this.machine.encryptionKey,
      encryptionVariant: this.machine.encryptionVariant,
      logger: (msg, data) => logger.debug(msg, data),
    });

    registerCommonHandlers(this.rpcHandlerManager, process.cwd(), this.machine.id);
  }

  setRPCHandlers({
    spawnSession,
    stopSession,
    listSupportedAgents,
    listExternalAgentSessions,
    listExternalAgentSessionsForAgent,
    requestShutdown,
  }: MachineRpcHandlers) {
    // Register spawn session handler
    this.rpcHandlerManager.registerHandler('spawn-free-session', async (params: any) => {
      const {
        directory,
        sessionId,
        machineId,
        approvedNewDirectoryCreation,
        agent,
        model,
        mode,
        token,
        resumeAgentSessionId,
      } = params || {};
      logger.debug('[API MACHINE] Spawning session', {
        machineId: this.machine.id,
        sessionId,
        directory,
        agent,
        model,
        mode,
        resumeAgentSessionId,
      });

      if (!directory) {
        throw new Error('Directory is required');
      }

      const result = await spawnSession({
        directory,
        sessionId,
        machineId,
        approvedNewDirectoryCreation,
        agent,
        model,
        mode,
        token,
        resumeAgentSessionId,
      });

      switch (result.type) {
        case 'success':
          logger.debug('[API MACHINE] Spawned session', {
            machineId: this.machine.id,
            sessionId: result.sessionId,
            agent,
            model,
            mode,
          });
          return { type: 'success', sessionId: result.sessionId };

        case 'requestToApproveDirectoryCreation':
          logger.debug('[API MACHINE] Requesting directory creation approval', {
            machineId: this.machine.id,
            directory: result.directory,
          });
          return { type: 'requestToApproveDirectoryCreation', directory: result.directory };

        case 'error':
          throw new Error(result.errorMessage);
      }
    });

    // Register stop session handler
    this.rpcHandlerManager.registerHandler('stop-session', (params: any) => {
      const { sessionId } = params || {};

      if (!sessionId) {
        throw new Error('Session ID is required');
      }

      const success = stopSession(sessionId);
      if (!success) {
        throw new Error('Session not found or failed to stop');
      }

      logger.debug('[API MACHINE] Stopped session', { machineId: this.machine.id, sessionId });
      return { message: 'Session stopped' };
    });

    this.rpcHandlerManager.registerHandler('list-supported-agents', () => {
      const agents = listSupportedAgents();
      logger.debug('[API MACHINE] Listed supported agents', {
        machineId: this.machine.id,
        agents,
      });
      return { agents };
    });

    this.rpcHandlerManager.registerHandler('list-external-agent-sessions', async (params: any) => {
      logger.debug('[API MACHINE] Listing external agent sessions', {
        machineId: this.machine.id,
        forceRefresh: params?.forceRefresh === true,
      });
      return await listExternalAgentSessions({
        token: params?.token,
        forceRefresh: params?.forceRefresh === true,
      });
    });

    this.rpcHandlerManager.registerHandler(
      'list-external-agent-sessions-for-agent',
      async (params: any) => {
        const agentType = params?.agentType;
        if (!agentType || typeof agentType !== 'string') {
          throw new Error('agentType is required');
        }
        logger.debug('[API MACHINE] Listing external agent sessions for agent', {
          machineId: this.machine.id,
          agentType,
          forceRefresh: params?.forceRefresh === true,
        });
        return await listExternalAgentSessionsForAgent({
          agentType,
          token: params?.token,
          forceRefresh: params?.forceRefresh === true,
        });
      }
    );

    // Register stop daemon handler
    this.rpcHandlerManager.registerHandler('stop-daemon', () => {
      logger.debug('[API MACHINE] Received stop-daemon RPC request');

      // Trigger shutdown callback after a delay
      setTimeout(() => {
        logger.debug('[API MACHINE] Initiating daemon shutdown from RPC');
        requestShutdown();
      }, 100);

      return { message: 'Daemon stop request acknowledged, starting shutdown sequence...' };
    });
  }

  /**
   * Update machine metadata
   * Currently unused, changes from the mobile client are more likely
   * for example to set a custom name.
   */
  async updateMachineMetadata(
    handler: (metadata: MachineMetadata | null) => MachineMetadata
  ): Promise<void> {
    await backoff(async () => {
      const updated = handler(this.machine.metadata);

      const answer = await this.socket.emitWithAck('machine-update-metadata', {
        machineId: this.machine.id,
        metadata: await encryptToWireString(
          this.machine.encryptionKey,
          this.machine.encryptionVariant,
          updated
        ),
        expectedVersion: this.machine.metadataVersion,
        _trace: getWireTrace(),
      });

      if (answer.result === 'success') {
        this.machine.metadata = await decryptFromWireString(
          this.machine.encryptionKey,
          this.machine.encryptionVariant,
          answer.metadata
        );
        this.machine.metadataVersion = answer.version;
        logger.debug('[API MACHINE] Metadata updated successfully', { machineId: this.machine.id });
      } else if (answer.result === 'version-mismatch') {
        if (answer.version > this.machine.metadataVersion) {
          this.machine.metadataVersion = answer.version;
          this.machine.metadata = await decryptFromWireString(
            this.machine.encryptionKey,
            this.machine.encryptionVariant,
            answer.metadata
          );
        }
        throw new Error('Metadata version mismatch'); // Triggers retry
      }
    });
  }

  /**
   * Update daemon state (runtime info) - similar to session updateAgentState
   * Simplified without lock - relies on backoff for retry
   */
  async updateDaemonState(handler: (state: DaemonState | null) => DaemonState): Promise<void> {
    await backoff(async () => {
      const updated = handler(this.machine.daemonState);

      const answer = await this.socket.emitWithAck('machine-update-state', {
        machineId: this.machine.id,
        daemonState: await encryptToWireString(
          this.machine.encryptionKey,
          this.machine.encryptionVariant,
          updated
        ),
        expectedVersion: this.machine.daemonStateVersion,
        _trace: getWireTrace(),
      });

      if (answer.result === 'success') {
        this.machine.daemonState = await decryptFromWireString(
          this.machine.encryptionKey,
          this.machine.encryptionVariant,
          answer.daemonState
        );
        this.machine.daemonStateVersion = answer.version;
        logger.debug('[API MACHINE] Daemon state updated successfully', {
          machineId: this.machine.id,
        });
      } else if (answer.result === 'version-mismatch') {
        if (answer.version > this.machine.daemonStateVersion) {
          this.machine.daemonStateVersion = answer.version;
          this.machine.daemonState = await decryptFromWireString(
            this.machine.encryptionKey,
            this.machine.encryptionVariant,
            answer.daemonState
          );
        }
        throw new Error('Daemon state version mismatch'); // Triggers retry
      }
    });
  }

  connect() {
    const serverUrl = configuration.serverUrl.replace(/^http/, 'ws');
    logger.debug('[API MACHINE] Connecting to server', { machineId: this.machine.id, serverUrl });

    this.socket = io(serverUrl, {
      transports: ['websocket'],
      auth: {
        token: this.token,
        clientType: 'machine-scoped' as const,
        machineId: this.machine.id,
      },
      path: '/v1/updates',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 60000,
    });

    this.socket.on('connect', () => {
      this.lastConnectedAt = Date.now();
      logger.info('[DAEMON] Machine connected', {
        machineId: this.machine.id,
        socketId: this.socket.id,
        prevDisconnectReason: this.lastDisconnectReason,
        prevDisconnectAgo: this.lastDisconnectAt ? Date.now() - this.lastDisconnectAt : null,
      });

      // Update daemon state to running
      // We need to override previous state because the daemon (this process)
      // has restarted with new PID & port
      this.updateDaemonState(state => ({
        ...state,
        status: 'running',
        pid: process.pid,
        httpPort: this.machine.daemonState?.httpPort,
        startedAt: Date.now(),
        failedRecoveries: undefined, // Clear from previous daemon instance
      })).catch(err => {
        logger.warn('[API MACHINE] Failed to update daemon state on connect', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Flush pending recovery-done (set before first connect by emitRecoveryDone).
      // Only sent once — on reconnect we don't re-archive because live sessions that
      // recovered successfully are still in sessionManager.
      if (this.pendingRecoveryDone !== null) {
        const ids = this.pendingRecoveryDone;
        this.pendingRecoveryDone = null;
        logger.info('[API MACHINE] flushing machine-recovery-done on connect', {
          machineId: this.machine.id,
          recoveredCount: ids.length,
        });
        this.socket.emit('machine-recovery-done', {
          machineId: this.machine.id,
          recoveredSessionIds: ids,
        });
      }

      // Register all handlers
      this.rpcHandlerManager.onSocketConnect(this.socket);

      // Start keep-alive
      this.startKeepAlive();
    });

    this.socket.on('disconnect', reason => {
      this.lastDisconnectReason = reason;
      this.lastDisconnectAt = Date.now();
      logger.info('[DAEMON] Machine disconnected', {
        machineId: this.machine.id,
        socketId: this.socket.id,
        reason,
        connectedDurationMs: this.lastConnectedAt ? Date.now() - this.lastConnectedAt : null,
      });
      this.rpcHandlerManager.onSocketDisconnect();
      this.stopKeepAlive();
    });

    // Single consolidated RPC handler
    this.socket.on(
      'rpc-request',
      async (data: { method: string; params: string }, callback: (response: string) => void) => {
        logger.debug('[API MACHINE] Received RPC request', {
          machineId: this.machine.id,
          method: data.method,
        });
        callback(await this.rpcHandlerManager.handleRequest(data));
      }
    );

    // Handle update events from server
    this.socket.on('update', async (data: Update) => {
      // Machine clients should only care about machine updates
      if (
        data.body.t === 'update-machine' &&
        (data.body as UpdateMachineBody).machineId === this.machine.id
      ) {
        // Handle machine metadata or daemon state updates from other clients (e.g., mobile app)
        const update = data.body as UpdateMachineBody;

        if (update.metadata) {
          logger.debug('[API MACHINE] Received external metadata update', {
            machineId: this.machine.id,
          });
          this.machine.metadata = await decryptFromWireString(
            this.machine.encryptionKey,
            this.machine.encryptionVariant,
            update.metadata.value
          );
          this.machine.metadataVersion = update.metadata.version;
        }

        if (update.daemonState) {
          logger.debug('[API MACHINE] Received external daemon state update', {
            machineId: this.machine.id,
          });
          this.machine.daemonState = await decryptFromWireString(
            this.machine.encryptionKey,
            this.machine.encryptionVariant,
            update.daemonState.value
          );
          this.machine.daemonStateVersion = update.daemonState.version;
        }
      } else {
        logger.debug('[API MACHINE] Received unknown update type', {
          machineId: this.machine.id,
          type: (data.body as any).t,
        });
      }
    });

    this.socket.on('connect_error', error => {
      logger.error('[DAEMON] Machine connect failed', undefined, {
        machineId: this.machine.id,
        error: error.message,
        socketId: this.socket.id,
        socketConnected: this.socket.connected,
        activeTransport: this.socket.io.engine?.transport?.name,
        lastDisconnectReason: this.lastDisconnectReason,
        lastDisconnectAgo: this.lastDisconnectAt ? Date.now() - this.lastDisconnectAt : null,
      });
    });

    this.socket.io.on('error', (error: any) => {
      logger.debug('[API MACHINE] Socket error', {
        machineId: this.machine.id,
        error: safeStringify(error),
      });
    });
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      const payload = {
        machineId: this.machine.id,
        time: Date.now(),
      };
      logger.debug('[API MACHINE] Emitting machine-alive', { machineId: this.machine.id });
      this.socket.emit('machine-alive', { ...payload, _trace: getWireTrace() });
    }, 20000);
    logger.debug('[API MACHINE] Keep-alive started (20s interval)', { machineId: this.machine.id });
  }

  private stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      logger.debug('[API MACHINE] Keep-alive stopped', { machineId: this.machine.id });
    }
  }

  /**
   * Notify the server that daemon recovery is complete.
   * The server will archive any offline sessions for this machine that were NOT recovered,
   * preventing orphaned sessions from staying in the 'offline' state indefinitely.
   *
   * If the socket is not yet connected, the payload is queued and sent on first connect.
   * This is fire-and-forget: called once per daemon startup, not on reconnect.
   */
  emitRecoveryDone(recoveredSessionIds: string[]): void {
    if (this.socket?.connected) {
      logger.info('[API MACHINE] emitting machine-recovery-done (immediate)', {
        machineId: this.machine.id,
        recoveredCount: recoveredSessionIds.length,
      });
      this.socket.emit('machine-recovery-done', {
        machineId: this.machine.id,
        recoveredSessionIds,
      });
    } else {
      // Socket not yet connected — queue for first connect event
      logger.info('[API MACHINE] queuing machine-recovery-done for first connect', {
        machineId: this.machine.id,
        recoveredCount: recoveredSessionIds.length,
      });
      this.pendingRecoveryDone = recoveredSessionIds;
    }
  }

  shutdown() {
    logger.debug('[API MACHINE] Shutting down', { machineId: this.machine.id });
    this.stopKeepAlive();
    if (this.socket) {
      this.socket.close();
      logger.debug('[API MACHINE] Socket closed', { machineId: this.machine.id });
    }
  }
}
