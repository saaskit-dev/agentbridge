/**
 * AgentSession Base Class
 *
 * Encapsulates all shared infrastructure for running an agent session inside the daemon:
 *   - ApiClient creation + getOrCreateSession
 *   - Offline/reconnection handling (setupOfflineReconnection)
 *   - Free MCP server lifecycle
 *   - Unified message queue (CLI input + mobile input → same queue)
 *   - pre-init message buffering (messages arriving before initialize() completes)
 *   - Backend output pipe → Server (sendNormalizedMessage) + IPC (broadcast)
 *   - SIGTERM / SIGINT handling
 *   - Graceful shutdown with drain + flush
 *
 * Subclasses implement:
 *   - agentType: AgentType
 *   - createBackend(): AgentBackend
 *   - createModeHasher(): (mode: TMode) => string
 *   - defaultMode(): TMode                    (used for CLI send_input)
 *   - extractMode(msg: UserMessage): TMode    (used for mobile onUserMessage)
 *
 * Lifecycle:
 *   initialize() → run() [→ shutdown() via finally]
 *                       ↑
 *               daemon spawns each session via spawnSession()
 */

import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import packageJson from '../../../package.json';
import type { Credentials } from '@/persistence';
import { ApiClient } from '@/api/api';
import type { ApiSessionClient } from '@/api/apiSession';
import type { AgentState, Metadata, UserMessage, PermissionMode } from '@/api/types';
import { configuration } from '@/configuration';
import { projectPath } from '@/projectPath';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import type { OfflineReconnectionHandle } from '@/utils/serverConnectionErrors';
import { startFreeServer } from '@/claude/utils/startFreeServer';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify, toError } from '@saaskit-dev/agentbridge';
import { getProcessTraceContext } from '@/telemetry';
import { hashObject } from '@/utils/deterministicJson';
import type { AgentBackend, AgentStartOpts } from './AgentBackend';
import type { NormalizedMessage, AgentType, SessionSummary, SessionInitiator } from './types';
import type { IPCServerMessage } from '@/daemon/ipc/protocol';
import type { SessionCapabilities } from './capabilities';
import { persistSession, eraseSession } from './sessionPersistence';
import type { PersistedSession } from './sessionPersistence';

const logger = new Logger('daemon/sessions/AgentSession');

// ---------------------------------------------------------------------------
// Options passed to every AgentSession constructor
// ---------------------------------------------------------------------------

export interface AgentSessionOpts {
  /** Auth credentials — from daemon settings or mobile-provided token */
  credential: Credentials;
  /**
   * Machine ID from daemon settings (readSettings().machineId).
   * Separate from Credentials because Credentials only carries token + encryption keys.
   */
  machineId: string;
  /** Who initiated this session */
  startedBy: SessionInitiator;
  /** Working directory for the agent */
  cwd: string;
  /** Resume a previous Claude Code session */
  resumeSessionId?: string;
  /** Server-side session tag (UUID generated if omitted) */
  sessionTag?: string;
  /** Extra env vars passed to the agent process */
  env?: Record<string, string>;
  permissionMode?: PermissionMode;
  model?: string;
  mode?: string;
  /**
   * Claude-only: how the backend should run.
   *   'local'  — spawn claude process with piped stdio; raw bytes flow over IPC as pty_data
   *   'remote' — SDK headless mode (default)
   * Determined by CLIClient based on whether stdin is a real TTY.
   */
  startingMode?: 'local' | 'remote';

  /**
   * Injected by daemon/run.ts — broadcasts IPC messages to attached CLI clients.
   * Signature matches IPCServer.broadcast().
   * Injected (not statically imported) to break AgentSession → daemonIPCServer cycle.
   */
  broadcast: (sessionId: string, msg: IPCServerMessage) => void;

  /** Unique ID for the current daemon instance. Used for session recovery ownership. */
  daemonInstanceId: string;
}

// ---------------------------------------------------------------------------
// AgentSession<TMode>
// ---------------------------------------------------------------------------

/** Decode userId (JWT sub claim) from a bearer token without verification. */
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

export abstract class AgentSession<TMode> {
  protected api!: ApiClient;
  protected session!: ApiSessionClient;
  protected messageQueue!: MessageQueue2<TMode>;
  /** Undefined in offline mode (startFreeServer is skipped) */
  protected freeServer: { url: string; toolNames: string[]; stop: () => void } | undefined;

  private reconnectionHandle: OfflineReconnectionHandle<ApiSessionClient> | null = null;
  protected shouldExit = false;
  protected pendingExit = false;
  /** Set only by handleSigterm/handleSigint — tells shutdown() to keep persisted state for crash recovery. */
  private _keepStateForRecovery = false;
  private _isShuttingDown = false;
  protected lastStatus: 'working' | 'idle' = 'idle';
  /** Current execution mode — local (PTY) or remote (SDK). Updated by subclasses on mode switch. */
  protected currentMode: 'local' | 'remote' = 'remote';
  private outputPipeFinished: Promise<void> = Promise.resolve();
  private capabilitiesPipeFinished: Promise<void> = Promise.resolve();
  protected backend!: AgentBackend;
  private startedAt = new Date().toISOString();
  protected userId: string | undefined;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private streamingTextMessageId: string | null = null;
  private streamingFullText = '';
  /** Session tag used with getOrCreateSession — saved for recovery persistence. */
  private sessionTag!: string;

  /** Messages arriving before initialize() completes are buffered here. */
  private readonly PRE_INIT_QUEUE_LIMIT = 32;
  private preInitQueue: Array<{ text: string }> = [];

  constructor(protected readonly opts: AgentSessionOpts) {
    this.userId = decodeUserId(opts.credential.token);
  }

  // ---------------------------------------------------------------------------
  // Abstract — must be implemented by each agent session subclass
  // ---------------------------------------------------------------------------

  abstract readonly agentType: AgentType;
  abstract createBackend(): AgentBackend;

  // ---------------------------------------------------------------------------
  // Mode handling — defaults work for { permissionMode, model? } modes.
  // ClaudeSession overrides these for its richer EnhancedMode.
  // ---------------------------------------------------------------------------

  createModeHasher(): (mode: TMode) => string {
    return (mode: TMode) =>
      hashObject({ permissionMode: (mode as any).permissionMode, model: (mode as any).model ?? '' });
  }

  /** Default mode used when CLI sends input without meta (no permissionMode override) */
  defaultMode(): TMode {
    return {
      permissionMode: this.opts.permissionMode ?? 'read-only',
      model: this.opts.model,
    } as TMode;
  }

  /** Extract TMode from a mobile UserMessage (contains meta.permissionMode, meta.model, etc.) */
  protected extractMode(message: UserMessage): TMode {
    return {
      permissionMode:
        (message.meta?.permissionMode as PermissionMode | undefined) ??
        this.opts.permissionMode ??
        'read-only',
      model: (message.meta?.model as string | undefined) ?? this.opts.model,
    } as TMode;
  }

  // ---------------------------------------------------------------------------
  // Public accessors
  // ---------------------------------------------------------------------------

  get shuttingDown(): boolean {
    return this._isShuttingDown;
  }

  /** Stop only the backend subprocess without running full shutdown (preserves persisted state).
   *  Used by graceful restart — sets pendingExit to prevent auto-restart. */
  async stopBackend(): Promise<void> {
    this.pendingExit = true;
    await this.backend?.stop();
  }

  get sessionId(): string {
    if (!this.session) throw new Error('AgentSession.sessionId accessed before initialize()');
    return this.session.sessionId;
  }

  toSummary(): SessionSummary {
    return {
      sessionId: this.session?.sessionId ?? 'uninitialized',
      agentType: this.agentType,
      cwd: this.opts.cwd,
      state: this.lastStatus === 'working' ? 'working' : 'idle',
      startedAt: this.startedAt,
      startedBy: this.opts.startedBy,
    };
  }

  // ---------------------------------------------------------------------------
  // Persistence — crash recovery support
  // ---------------------------------------------------------------------------

  /**
   * Update the agent-level resume ID and persist the change to disk.
   * Subclasses call this when the underlying agent reports a new session ID
   * (e.g. ClaudeSession.setClaudeSessionId). The base class handles persistence.
   */
  protected updateResumeId(id: string): void {
    this.opts.resumeSessionId = id;
    logger.info('[AgentSession] resumeId updated', {
      sessionId: this.session?.sessionId,
      agentType: this.agentType,
      resumeSessionId: id,
    });
    this.persistCurrentState().catch((err) =>
      logger.warn('[AgentSession] failed to persist updated resumeId', { error: String(err) })
    );
  }

  private buildPersistedData(): PersistedSession {
    return {
      sessionId: this.session.sessionId,
      sessionTag: this.sessionTag,
      agentType: this.agentType,
      cwd: this.opts.cwd,
      resumeSessionId: this.opts.resumeSessionId,
      permissionMode: this.opts.permissionMode,
      model: this.opts.model,
      mode: this.opts.mode,
      startingMode: this.opts.startingMode,
      startedBy: this.opts.startedBy,
      env: this.opts.env,
      createdAt: new Date(this.startedAt).getTime(),
      daemonInstanceId: this.opts.daemonInstanceId,
    };
  }

  private async persistCurrentState(): Promise<void> {
    if (!this.session) return;
    await persistSession(this.buildPersistedData());
  }

  // ---------------------------------------------------------------------------
  // Hooks for subclasses
  // ---------------------------------------------------------------------------

  /**
   * Called when a message from the app (via onUserMessage) is about to enter the messageQueue.
   * Subclasses can override to track app-originated messages (e.g. for deduplication).
   */
  protected onAppMessageQueued(_text: string): void {
    // no-op in base class
  }

  /**
   * Called just before each backend.sendMessage(), with the resolved TMode for that turn.
   * Subclasses can override to react to mode changes (e.g. update currentPermissionMode).
   */
  protected onModeChange(_mode: TMode): void {
    // no-op in base class
  }

  // ---------------------------------------------------------------------------
  // Input — two paths, unified into one messageQueue
  // ---------------------------------------------------------------------------

  /**
   * CLI → IPC send_input path.
   * If initialize() hasn't completed yet, messages are buffered (up to PRE_INIT_QUEUE_LIMIT).
   */
  sendInput(text: string): void {
    if (!this.messageQueue) {
      if (this.preInitQueue.length < this.PRE_INIT_QUEUE_LIMIT) {
        this.preInitQueue.push({ text });
      } else {
        logger.debug('[AgentSession] preInitQueue full, dropping message', { userId: this.userId, cwd: this.opts.cwd, queueSize: this.PRE_INIT_QUEUE_LIMIT });
      }
      return;
    }
    this.messageQueue.push(text, this.defaultMode());
  }

  /** IPCServer abort message path. */
  abort(): Promise<void> {
    this.shouldExit = true;
    this.messageQueue?.close();
    return this.backend?.abort() ?? Promise.resolve();
  }

  /**
   * Request switching from remote (SDK) mode back to local (PTY) mode.
   * Only meaningful for Claude sessions currently in remote mode.
   * Subclasses override to abort the remote leg; base class is a no-op.
   */
  requestSwitchToLocal(): void {
    // no-op in base class — only ClaudeSession implements mode switching
  }

  async setModel(modelId: string): Promise<void> {
    this.opts.model = modelId;
    await this.backend?.setModel?.(modelId);
  }

  async setMode(modeId: string): Promise<void> {
    this.opts.mode = modeId;
    await this.backend?.setMode?.(modeId);
  }

  async setConfig(optionId: string, value: string): Promise<void> {
    await this.backend?.setConfig?.(optionId, value);
  }

  async runCommand(commandId: string): Promise<void> {
    if (!this.backend?.runCommand) {
      throw new Error(`Backend '${this.agentType}' does not support commands`);
    }
    await this.backend.runCommand(commandId);
  }

  /**
   * Forward raw PTY input from CLI to the backend agent process.
   * data is base64-encoded binary. Only meaningful for Claude local mode.
   */
  sendPtyInput(data: string): void {
    this.backend?.sendPtyInput?.(data);
  }

  /**
   * Notify backend that the CLI terminal was resized.
   * Only meaningful for Claude local mode.
   */
  resizePty(cols: number, rows: number): void {
    this.backend?.resizePty?.(cols, rows);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    logger.info('[AgentSession] initializing', { userId: this.userId, agentType: this.agentType, cwd: this.opts.cwd, startedBy: this.opts.startedBy, machineId: this.opts.machineId });
    this.api = await ApiClient.create(this.opts.credential);
    this.messageQueue = new MessageQueue2<TMode>(this.createModeHasher());

    const tag = this.opts.sessionTag ?? randomUUID();
    this.sessionTag = tag;
    if (this.opts.resumeSessionId) {
      logger.info('[AgentSession] resuming previous session', { userId: this.userId, resumeSessionId: this.opts.resumeSessionId, agentType: this.agentType });
    }
    const { metadata, state } = this.buildSessionMetadata();

    const response = await this.api.getOrCreateSession({ tag, metadata, state });

    const result = setupOfflineReconnection({
      api: this.api,
      sessionTag: tag,
      metadata,
      state,
      response,
      onSessionSwap: async (newSession: ApiSessionClient) => {
        // ⚠️ Exception safety: start new server BEFORE stopping the old one.
        // If startFreeServer throws, the old session/freeServer remain intact.
        try {
          const newFreeServer = await startFreeServer(newSession);
          // New server started successfully — now safe to swap
          const oldFreeServer = this.freeServer;
          this.session = newSession;
          this.freeServer = newFreeServer;
          // Stop old server AFTER swap — failure here is non-fatal
          try { oldFreeServer?.stop(); } catch { /* ignore */ }
          // Re-register mobile message handler on new session object
          newSession.onUserMessage((msg) => {
            if (!this.messageQueue) return;
            logger.info('[AgentSession] app user message received after session swap', {
              userId: this.userId,
              sessionId: newSession.sessionId,
              agentType: this.agentType,
              textLen: msg.content.text.length,
              preview: msg.content.text.slice(0, 120),
              permissionMode: msg.meta?.permissionMode,
              model: msg.meta?.model,
              traceId: getProcessTraceContext()?.traceId,
            });
            this.onAppMessageQueued(msg.content.text);
            this.messageQueue.push(msg.content.text, this.extractMode(msg));
            logger.info('[AgentSession] app user message pushed to queue after session swap', {
              userId: this.userId,
              sessionId: newSession.sessionId,
              agentType: this.agentType,
              textLen: msg.content.text.length,
              traceId: getProcessTraceContext()?.traceId,
            });
          });
          this.backend?.onSessionChange?.(newSession);
          this.registerSessionRpcHandlers();
          registerKillSessionHandler(this.session.rpcHandlerManager, async () => {
            this.pendingExit = true; // prevent auto-restart
            this.shouldExit = true;
            this.messageQueue?.close();
            await this.backend.abort();
          });
          // Re-register DB-archived fallback on new session
          this.listenForServerArchived();
          logger.info('[AgentSession] onSessionSwap succeeded', { userId: this.userId, newSessionId: newSession.sessionId });
        } catch (err) {
          logger.error('[AgentSession] onSessionSwap failed, retaining old session',
            toError(err),
            { userId: this.userId, sessionId: this.session?.sessionId, newSessionId: newSession.sessionId, traceId: getProcessTraceContext()?.traceId });
        }
      },
    });

    this.session = result.session;
    this.reconnectionHandle = result.reconnectionHandle;

    if (!result.isOffline) {
      this.freeServer = await startFreeServer(this.session);
    }

    // Register mobile message handler (Server → WebSocket → ApiSessionClient → here)
    this.session.onUserMessage((msg) => {
      if (!this.messageQueue) return;
      logger.info('[AgentSession] app user message received', {
        userId: this.userId,
        sessionId: this.session.sessionId,
        agentType: this.agentType,
        textLen: msg.content.text.length,
        preview: msg.content.text.slice(0, 120),
        permissionMode: msg.meta?.permissionMode,
        model: msg.meta?.model,
        traceId: getProcessTraceContext()?.traceId,
      });
      this.onAppMessageQueued(msg.content.text);
      this.messageQueue.push(msg.content.text, this.extractMode(msg));
      logger.info('[AgentSession] app user message pushed to queue', {
        userId: this.userId,
        sessionId: this.session.sessionId,
        agentType: this.agentType,
        textLen: msg.content.text.length,
        traceId: getProcessTraceContext()?.traceId,
      });
    });

    // Replay any messages that arrived before initialize() completed
    for (const { text } of this.preInitQueue) {
      this.messageQueue.push(text, this.defaultMode());
    }
    const preInitReplayed = this.preInitQueue.length;
    this.preInitQueue = [];
    // Start keepAlive interval — sends session-alive events to the server every 2s
    // so the app can track thinking/idle status in real-time.
    this.currentMode = this.opts.startingMode ?? 'remote';
    this.session.keepAlive(this.lastStatus === 'working', this.currentMode);
    this.keepAliveInterval = setInterval(() => {
      this.session.keepAlive(this.lastStatus === 'working', this.currentMode);
    }, 2000);

    // Fallback: if the server tells us the DB already has this session archived,
    // trigger graceful shutdown. DB is the source of truth.
    this.listenForServerArchived();

    // Persist session state to disk for crash recovery
    logger.info('[AgentSession] persisting session for crash recovery', {
      sessionId: this.session.sessionId,
      agentType: this.agentType,
      sessionTag: this.sessionTag,
      resumeSessionId: this.opts.resumeSessionId,
      startingMode: this.opts.startingMode,
    });
    this.persistCurrentState().catch((err) =>
      logger.warn('[AgentSession] failed to persist session state', { error: String(err) })
    );

    logger.info('[AgentSession] initialized', {
      userId: this.userId,
      sessionId: this.session.sessionId,
      agentType: this.agentType,
      machineId: this.opts.machineId,
      preInitReplayed,
      isOffline: !this.freeServer,
    });
  }

  protected registerSessionRpcHandlers(): void {
    this.session.rpcHandlerManager.registerHandler('set-model', async (params: any) => {
      if (!params?.modelId) {
        throw new Error('modelId is required');
      }
      await this.setModel(params.modelId);
      return { ok: true };
    });

    this.session.rpcHandlerManager.registerHandler('set-mode', async (params: any) => {
      if (!params?.modeId) {
        throw new Error('modeId is required');
      }
      logger.info('[AgentSession] session RPC set-mode received', {
        userId: this.userId,
        sessionId: this.session.sessionId,
        modeId: params.modeId,
      });
      await this.setMode(params.modeId);
      return { ok: true };
    });

    this.session.rpcHandlerManager.registerHandler('set-config', async (params: any) => {
      if (!params?.optionId) {
        throw new Error('optionId is required');
      }
      await this.setConfig(params.optionId, params.value);
      return { ok: true };
    });

    this.session.rpcHandlerManager.registerHandler('run-command', async (params: any) => {
      if (!params?.commandId) {
        throw new Error('commandId is required');
      }
      await this.runCommand(params.commandId);
      return { ok: true };
    });
  }

  static MAX_BACKEND_RESTARTS = 3;
  static RESTART_COOLDOWN_MS = 5_000;
  private backendRestartCount = 0;
  private lastBackendStartTime = 0;

  async run(): Promise<void> {
    try {
      while (true) {
        try {
          await this.startBackendAndLoop();
          break; // Normal exit (pendingExit, kill, or archived)
        } catch (err) {
          if (this.pendingExit || this._isShuttingDown) break;
          // Backend failed to start — enter dormant mode rather than dying.
          // The session stays alive so the user can retry or archive.
          logger.error('[AgentSession] backend start failed, entering dormant mode',
            toError(err),
            { sessionId: this.session?.sessionId, agentType: this.agentType });
          this.publishVisibleError(
            new Error(`Agent failed to start. Send a message to retry, or archive this session.`),
            'backend start failed — waiting for user action',
            true,
          );
          this.shouldExit = false;
          this.backendRestartCount = 0;
          this.messageQueue = new MessageQueue2<TMode>(this.createModeHasher());
          const item = await this.messageQueue.waitForMessagesAndGetAsString();
          if (!item || this.pendingExit || this._isShuttingDown) break;
          this.messageQueue.push(item.message, item.mode);
          // continue → retry startBackendAndLoop
        }
      }
    } finally {
      await this.shutdown('loop_ended');
    }
  }

  /**
   * Start the backend and enter the message loop.
   * If the backend crashes unexpectedly (not a graceful exit), automatically restarts it
   * up to MAX_BACKEND_RESTARTS times with RESTART_COOLDOWN_MS between attempts.
   */
  private async startBackendAndLoop(): Promise<void> {
    while (!this.shouldExit) {
      this.backend = this.createBackend();
      const backendStartOpts = this.buildBackendStartOpts();
      logger.info('[AgentSession] starting backend', {
        userId: this.userId,
        sessionId: this.session.sessionId,
        agentType: this.agentType,
        cwd: backendStartOpts.cwd,
        permissionMode: backendStartOpts.permissionMode,
        model: backendStartOpts.model,
        mode: backendStartOpts.mode,
        startingMode: backendStartOpts.startingMode,
        restartCount: this.backendRestartCount,
      });
      this.lastBackendStartTime = Date.now();
      await this.backend.start(backendStartOpts);

      if (this.backendRestartCount === 0) {
        // Only register RPC handlers on first start (they persist across restarts)
        registerKillSessionHandler(this.session.rpcHandlerManager, async () => {
          this.pendingExit = true; // prevent auto-restart
          this.shouldExit = true;
          this.messageQueue?.close();
          await this.backend.abort();
        });
        this.registerSessionRpcHandlers();
      }

      // Reset shouldExit — it may have been set by the previous backend's pipeBackendOutput
      this.shouldExit = false;
      this.pipeBackendOutput();
      this.pipeBackendCapabilities();

      await this.messageLoop();

      // If we get here, the message loop exited.
      // Check if it was a graceful exit or a crash.
      const exitInfo = this.backend.exitInfo;
      logger.info('[AgentSession] messageLoop exited', {
        shouldExit: this.shouldExit,
        pendingExit: this.pendingExit,
        isShuttingDown: this._isShuttingDown,
        restartCount: this.backendRestartCount,
        exitCode: exitInfo?.exitCode,
        exitSignal: exitInfo?.signal,
        exitReason: exitInfo?.reason,
      });
      if (this.pendingExit || this._isShuttingDown) break; // graceful — don't restart
      if (this.shouldExit) {
        // Backend died unexpectedly — try to restart
        await this.outputPipeFinished;
        await this.capabilitiesPipeFinished;

        if (!this.canRestartBackend()) {
          // Exhausted fast restarts — enter "dormant" mode.
          // Keep the session alive so the user can send a message to retry
          // or archive the session from the app.
          logger.warn('[AgentSession] backend exhausted fast restarts, entering dormant mode', {
            sessionId: this.session.sessionId,
            agentType: this.agentType,
            restartCount: this.backendRestartCount,
          });
          this.publishVisibleError(
            new Error(`Agent process crashed ${this.backendRestartCount} times. Send a message to restart, or archive this session.`),
            'backend restart limit reached — waiting for user action',
            true,
          );

          // Wait for user to send a new message (or kill/archive to arrive)
          this.shouldExit = false;
          this.backendRestartCount = 0;
          this.messageQueue = new MessageQueue2<TMode>(this.createModeHasher());
          const item = await this.messageQueue.waitForMessagesAndGetAsString();
          if (!item || this.pendingExit || this._isShuttingDown) break;
          // User sent a message — push it back so the new messageLoop picks it up
          this.messageQueue.push(item.message, item.mode);
          continue;
        }

        this.backendRestartCount++;
        logger.warn('[AgentSession] backend crashed, restarting', {
          sessionId: this.session.sessionId,
          agentType: this.agentType,
          attempt: this.backendRestartCount,
          maxAttempts: AgentSession.MAX_BACKEND_RESTARTS,
          exitCode: exitInfo?.exitCode,
          exitSignal: exitInfo?.signal,
          exitReason: exitInfo?.reason,
        });
        this.publishVisibleError(
          new Error(`Agent process crashed — restarting (attempt ${this.backendRestartCount}/${AgentSession.MAX_BACKEND_RESTARTS})`),
          'backend crashed',
          true,
        );
        const cooldownMs = (this.constructor as typeof AgentSession).RESTART_COOLDOWN_MS;
        const elapsed = Date.now() - this.lastBackendStartTime;
        if (elapsed < cooldownMs) {
          await new Promise(r => setTimeout(r, cooldownMs - elapsed));
        }
        // Re-open message queue and reset exit flag before restarting
        this.shouldExit = false;
        this.messageQueue = new MessageQueue2<TMode>(this.createModeHasher());
        continue;
      }
      break; // normal exit (queue empty)
    }
  }

  private canRestartBackend(): boolean {
    if (this.backendRestartCount >= (this.constructor as typeof AgentSession).MAX_BACKEND_RESTARTS) {
      logger.error('[AgentSession] backend restart limit reached, giving up', undefined, {
        sessionId: this.session.sessionId,
        agentType: this.agentType,
        restartCount: this.backendRestartCount,
      });
      return false;
    }
    return true;
  }

  private async messageLoop(): Promise<void> {
    while (!this.shouldExit) {
      logger.debug('[AgentSession] waiting for message', { userId: this.userId, sessionId: this.session.sessionId, traceId: getProcessTraceContext()?.traceId, spanId: getProcessTraceContext()?.spanId });
      const item = await this.messageQueue.waitForMessagesAndGetAsString();
      if (!item) break;
      // Re-check after await: backend may have died while we were blocked on the queue
      if (this.shouldExit) break;
      if (this.pendingExit && this.lastStatus === 'idle') break;
      logger.debug('[AgentSession] turn dequeued, sending to backend', {
        userId: this.userId,
        sessionId: this.session.sessionId,
        traceId: getProcessTraceContext()?.traceId,
        spanId: getProcessTraceContext()?.spanId,
        preview: item.message.slice(0, 100),
      });
      this.resetStreamingText();
      try {
        this.onModeChange(item.mode);
        await this.backend.sendMessage(
          item.message,
          (item.mode as { permissionMode?: PermissionMode }).permissionMode
        );
        this.completeStreamingText();
      } catch (err) {
        this.resetStreamingText();
        this.publishVisibleError(err, 'backend send failed', true);
        // Don't exit — transient errors (API 500, timeout) should not kill the session.
        // The user can send another message to retry. If the backend process actually
        // died, pipeBackendOutput() will set shouldExit when the output stream ends.
      }
    }
  }

  async shutdown(reason: string): Promise<void> {
    if (this._isShuttingDown) return;
    this._isShuttingDown = true;
    logger.info('[AgentSession] shutdown started', {
      userId: this.userId,
      sessionId: this.session?.sessionId,
      machineId: this.opts.machineId,
      reason,
    });

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    this.messageQueue?.close();

    if (this.backend) {
      await this.backend.stop();
      // Wait for pipeBackendOutput drain before closing the session
      await this.outputPipeFinished;
      await this.capabilitiesPipeFinished;
    }

    // Notify attached CLI clients that the session has ended.
    // Must happen after output drain (so the client sees all output first)
    // and before evictHistory (which deletes the attachment set).
    if (this.session) {
      logger.info('[AgentSession] broadcasting session_state:archived', {
        sessionId: this.session.sessionId,
      });
      this.opts.broadcast(this.session.sessionId, {
        type: 'session_state',
        sessionId: this.session.sessionId,
        state: 'archived',
      });
    }

    if (this.session) {
      this.session.updateMetadata((m) => ({
        ...m,
        lifecycleState: 'archived',
        lifecycleStateSince: Date.now(),
        archivedBy: 'daemon',
        archiveReason: reason,
      }));
      this.session.sendSessionDeath();
      // flush has built-in 10s timeout; race adds extra 5s safety net
      await Promise.race([this.session.flush(), new Promise((r) => setTimeout(r, 5000))]);
      await this.session.close();
    }

    this.freeServer?.stop();
    this.reconnectionHandle?.cancel();

    // Only keep persisted state when the daemon itself is shutting down (SIGTERM/SIGINT)
    // so it can be recovered on next start. For session-level kills and archives, erase it.
    if (this.session && !this._keepStateForRecovery) {
      logger.info('[AgentSession] erasing persisted state (session ended)', { sessionId: this.session.sessionId, reason });
      eraseSession(this.session.sessionId).catch(() => {});
    } else if (this.session) {
      logger.info('[AgentSession] keeping persisted state for recovery (daemon shutting down)', { sessionId: this.session.sessionId, reason });
    }

    logger.info('[AgentSession] shutdown completed', {
      userId: this.userId,
      sessionId: this.session?.sessionId,
      machineId: this.opts.machineId,
      reason,
    });
  }

  handleSigterm(): void {
    this.pendingExit = true;
    this._keepStateForRecovery = true;
    if (this.lastStatus === 'idle') {
      this.messageQueue?.close(); // already idle, unblock immediately
    }
  }

  handleSigint(): void {
    this.pendingExit = true; // prevent auto-restart
    this._keepStateForRecovery = true;
    this.shouldExit = true;
    this.messageQueue?.close();
  }

  /** Register a one-time listener on the current `this.session` for the server-driven archive fallback. */
  private listenForServerArchived(): void {
    this.session.once('archived', () => {
      if (this._isShuttingDown) return;
      logger.info('[AgentSession] server reported session archived in DB, shutting down', {
        sessionId: this.session?.sessionId,
      });
      this.pendingExit = true;
      this.shouldExit = true;
      this.messageQueue?.close();
      this.backend?.abort();
    });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Drain a backend's output: forward each NormalizedMessage to the server and IPC.
   * Unlike pipeBackendOutput(), this does NOT set shouldExit when the stream ends —
   * used by ClaudeSession's local/remote loop where backend ends are expected on mode switch.
   */
  protected async drainBackendOutput(backend: AgentBackend): Promise<void> {
    for await (const msg of backend.output) {
      this.forwardOutputMessage(msg);
    }
  }

  /** Forward a single NormalizedMessage to the server and broadcast to IPC clients. */
  protected async forwardOutputMessage(msg: NormalizedMessage): Promise<void> {
    this.maybeStreamOutputMessage(msg);
    await this.session.sendNormalizedMessage(msg);
    if (msg.role === 'event') {
      const c = msg.content;
      if (c.type === 'status') {
        this.lastStatus = c.state;
        logger.info('[AgentSession] status changed', {
          userId: this.userId,
          sessionId: this.session.sessionId,
          traceId: getProcessTraceContext()?.traceId,
          spanId: getProcessTraceContext()?.spanId,
          id: msg.id,
          state: c.state,
        });
      }
    } else if (msg.role === 'agent' && Array.isArray(msg.content)) {
      for (const block of msg.content as Array<{ type: string; [k: string]: unknown }>) {
        if (block.type === 'tool-call') {
          logger.info('[AgentSession] tool call dispatched', {
            userId: this.userId,
            sessionId: this.session.sessionId,
            traceId: getProcessTraceContext()?.traceId,
            spanId: getProcessTraceContext()?.spanId,
            id: msg.id,
            name: block.name,
            toolUseId: block.id,
          });
        } else if (block.type === 'tool-result') {
          logger.info('[AgentSession] tool result received', {
            userId: this.userId,
            sessionId: this.session.sessionId,
            traceId: getProcessTraceContext()?.traceId,
            spanId: getProcessTraceContext()?.spanId,
            id: msg.id,
            toolUseId: block.tool_use_id,
            isError: block.is_error ?? false,
          });
        }
      }
    }
    this.opts.broadcast(this.session.sessionId, {
      type: 'agent_output',
      sessionId: this.session.sessionId,
      msg,
    });
  }

  protected maybeStreamOutputMessage(msg: NormalizedMessage): void {
    if (msg.role !== 'agent' || !Array.isArray(msg.content) || msg.content.length !== 1) {
      return;
    }

    const [block] = msg.content;
    if (block.type !== 'text' || !block.text) {
      return;
    }

    if (!this.streamingTextMessageId) {
      this.streamingTextMessageId = msg.id;
    }

    this.streamingFullText += block.text;
    this.session.sendStreamingTextDelta(this.streamingTextMessageId, block.text);
  }

  protected completeStreamingText(): void {
    if (!this.streamingTextMessageId) {
      return;
    }

    this.session.sendStreamingTextComplete(this.streamingTextMessageId, this.streamingFullText);
    this.resetStreamingText();
  }

  protected resetStreamingText(): void {
    this.streamingTextMessageId = null;
    this.streamingFullText = '';
  }

  private publishVisibleError(error: unknown, context: string, retryable = false): void {
    const message = safeStringify(error);
    logger.error(
      `[AgentSession] ${context}`,
      toError(error),
      {
        userId: this.userId,
        sessionId: this.session?.sessionId,
        traceId: getProcessTraceContext()?.traceId,
      }
    );

    if (!this.session) {
      return;
    }

    this.forwardOutputMessage({
      id: randomUUID(),
      createdAt: Date.now(),
      role: 'event',
      isSidechain: false,
      content: {
        type: 'error',
        message,
        retryable,
      },
    });
  }

  private pipeBackendOutput(): void {
    const backendRef = this.backend;
    this.outputPipeFinished = (async () => {
      try {
        await this.drainBackendOutput(backendRef);
        // Backend output stream ended — signal session to exit and trigger shutdown
        const exitInfo = backendRef.exitInfo;
        logger.info('[AgentSession] backend output ended, signalling exit', {
          userId: this.userId,
          sessionId: this.session?.sessionId,
          exitCode: exitInfo?.exitCode,
          exitSignal: exitInfo?.signal,
          exitReason: exitInfo?.reason,
        });
        this.shouldExit = true;
        this.messageQueue?.close();
      } catch (err) {
        logger.error('[AgentSession] output pipe broken, triggering shutdown',
          toError(err),
          { userId: this.userId, sessionId: this.session?.sessionId, traceId: getProcessTraceContext()?.traceId });
        this.shouldExit = true;
        this.messageQueue?.close();
      }
    })();
  }

  private pipeBackendCapabilities(): void {
    const capabilitiesStream = this.backend.capabilities;
    if (!capabilitiesStream) {
      this.capabilitiesPipeFinished = Promise.resolve();
      return;
    }

    this.capabilitiesPipeFinished = (async () => {
      try {
        for await (const capabilities of capabilitiesStream) {
          this.forwardCapabilities(capabilities);
        }
      } catch (err) {
        logger.error('[AgentSession] capabilities pipe broken',
          toError(err),
          { userId: this.userId, sessionId: this.session?.sessionId, traceId: getProcessTraceContext()?.traceId });
      }
    })();
  }

  protected forwardCapabilities(capabilities: SessionCapabilities): void {
    logger.info('[AgentSession] forwarding capabilities', {
      userId: this.userId,
      sessionId: this.session.sessionId,
      agentType: this.agentType,
      modelCurrent: capabilities.models?.current ?? null,
      modelCount: capabilities.models?.available.length ?? 0,
      modeCurrent: capabilities.modes?.current ?? null,
      modeCount: capabilities.modes?.available.length ?? 0,
      configOptionCount: capabilities.configOptions?.length ?? 0,
      commandCount: capabilities.commands?.length ?? 0,
    });
    this.opts.broadcast(this.session.sessionId, {
      type: 'capabilities',
      sessionId: this.session.sessionId,
      capabilities,
    });
    this.session.updateCapabilities(capabilities);
  }

  /** Override in subclasses to inject agent-specific env vars (e.g. hookServer port). */
  protected buildBackendStartOpts(): AgentStartOpts {
    return {
      cwd: this.opts.cwd,
      env: this.opts.env ?? {},
      mcpServerUrl: this.freeServer?.url ?? '',
      session: this.session,
      resumeSessionId: this.opts.resumeSessionId,
      permissionMode: this.opts.permissionMode,
      model: this.opts.model,
      mode: this.opts.mode,
      startingMode: this.opts.startingMode,
      broadcast: this.opts.broadcast,
    };
  }

  private buildSessionMetadata(): { metadata: Metadata; state: AgentState } {
    const state: AgentState = { controlledByUser: false };
    const metadata: Metadata = {
      path: this.opts.cwd,
      host: os.hostname(),
      version: packageJson.version,
      os: os.platform(),
      machineId: this.opts.machineId,
      homeDir: os.homedir(),
      freeHomeDir: configuration.freeHomeDir,
      freeLibDir: projectPath(),
      freeToolsDir: resolve(projectPath(), 'tools', 'unpacked'),
      startedFromDaemon: this.opts.startedBy === 'daemon',
      hostPid: process.pid,
      startedBy: this.opts.startedBy,
      lifecycleState: 'running',
      lifecycleStateSince: Date.now(),
      flavor: this.agentType,
    };
    return { metadata, state };
  }
}
