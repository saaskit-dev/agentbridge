/**
 * ClaudeNativeSession — AgentSession subclass for Claude Code native (PTY/SDK) agent.
 *
 * Implements the local/remote mode loop (ported from happy-cli):
 *   - Local PTY mode: CLI user interacts with Claude's native TUI
 *   - Remote SDK mode: App messages processed via Claude SDK
 *
 * When an App message arrives during local mode → kill PTY → switch to remote.
 * After remote finishes processing → switch back to local.
 * Remote-only sessions (startingMode === 'remote') skip the loop entirely.
 *
 * Permission handling: delegated to Claude's native --permission-mode flag.
 * No hook-based permission blocking — hooks are used only for session tracking.
 */

import { existsSync, unlinkSync } from 'node:fs';
import type { UserMessage, PermissionMode } from '@/api/types';
import { hashObject } from '@/utils/deterministicJson';
import type { EnhancedMode } from '@/claude/sessionTypes';
import { claudeRemote } from '@/claude/claudeRemote';
import { PermissionHandler } from '@/claude/utils/permissionHandler';
import {
  mapSDKMessageToNormalized,
  createSDKMapperState,
  flushSDKOpenToolCalls,
} from '@/backends/claude-native/mapSDKMessageToNormalized';
import {
  mapClaudeLogMessageToNormalizedMessages,
  type ClaudeSessionProtocolState,
} from '@/claude/utils/sessionProtocolMapper';
import type { AgentStartOpts } from './AgentBackend';
import type { AgentBackend } from './AgentBackend';
import { AgentSession } from './AgentSession';
import type { HookServer } from '@/claude/utils/startHookServer';
import { startHookServer } from '@/claude/utils/startHookServer';
import {
  generateHookSettingsFile,
  updateHookSettingsFile,
} from '@/claude/utils/generateHookSettings';
import { createSessionScanner } from '@/claude/utils/sessionScanner';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { ClaudeNativeBackend } from '@/backends/claude-native/ClaudeNativeBackend';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify, toError } from '@saaskit-dev/agentbridge';

const logger = new Logger('daemon/sessions/ClaudeNativeSession');

/**
 * Remote mode stays active indefinitely — only exits on explicit switch request
 * (CLI space press, App RPC switch, or session kill). No idle timeout.
 */

export class ClaudeNativeSession extends AgentSession<EnhancedMode> {
  readonly agentType = 'claude-native' as const;

  private hookServer: HookServer | null = null;
  private hookSettingsFilePath: string | null = null;
  private sessionScanner: Awaited<ReturnType<typeof createSessionScanner>> | null = null;
  private pendingScannerSessionId: string | null = null;

  /**
   * Latest Claude Code session UUID we should resume when spawning the local PTY.
   * Source of truth is the hook callback + SDK onSessionFound. We also mirror it
   * into this.opts.resumeSessionId so downstream helpers keep working.
   */
  private lastClaudeSessionId: string | null = null;

  /** AbortController for the current remote leg — aborted to switch back to local. */
  private remoteLegAbort: AbortController | null = null;
  /** Timestamp (ms) when the last mode switch was initiated, for timing diagnostics. */
  private switchTimestamp = 0;

  /**
   * When true, sessionScanner's onMessage callback is suppressed.
   * In remote mode, the SDK's onMessage callback already sends messages;
   * letting the scanner also send them causes every message to appear twice.
   */
  private scannerPaused = false;
  private switchSequence = 0;

  /**
   * FIFO queue of message texts sent from the app (via onUserMessage → messageQueue → PTY).
   * Used to deduplicate: when SessionScanner reads the same user message from Claude's JSONL,
   * we skip re-sending it to the server (the app already has it).
   * Array (not Set) so identical texts sent twice are handled correctly.
   */
  private appSentTexts: string[] = [];

  /** State for the JSONL → NormalizedMessage mapper (local PTY scanner path). */
  private readonly claudeJsonlMapperState: ClaudeSessionProtocolState = { currentTurnId: null };

  createBackend(): AgentBackend {
    return new ClaudeNativeBackend();
  }

  private setClaudeSessionId(sessionId: string) {
    if (!sessionId || typeof sessionId !== 'string') return;
    if (this.lastClaudeSessionId === sessionId) return;
    this.lastClaudeSessionId = sessionId;
    // Persist into opts so both ClaudeBackend and claudeRemote() get a stable resume id,
    // and write the updated resumeId to disk for crash recovery.
    this.updateResumeId(sessionId);
    logger.info('[ClaudeNativeSession] updated resumeSessionId', { sessionId });
  }

  // Claude's EnhancedMode includes extra fields (systemPrompt, toolFilters, etc.)
  // that affect behavior — the hash must include them all.
  override createModeHasher(): (mode: EnhancedMode) => string {
    return (mode: EnhancedMode) =>
      hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model ?? '',
        fallbackModel: mode.fallbackModel ?? '',
        customSystemPrompt: mode.customSystemPrompt ?? '',
        appendSystemPrompt: mode.appendSystemPrompt ?? '',
        allowedTools: mode.allowedTools ?? [],
        disallowedTools: mode.disallowedTools ?? [],
      });
  }

  protected override onAppMessageQueued(text: string): void {
    this.appSentTexts.push(text);
    // Immediately notify app of working status so user sees feedback
    // during the local→remote switch (which can take seconds as claudeRemote aborts).
    this.lastStatus = 'working';
    this.session.sendNormalizedMessage({
      role: 'event',
      content: { type: 'status', state: 'working' },
    });
  }

  protected override extractMode(message: UserMessage): EnhancedMode {
    const meta = message.meta;
    return {
      permissionMode:
        (meta?.permissionMode as PermissionMode | undefined) ??
        this.opts.permissionMode ??
        'read-only',
      model: (meta?.model as string | undefined) ?? this.opts.model,
      fallbackModel: meta?.fallbackModel as string | undefined,
      customSystemPrompt: meta?.customSystemPrompt as string | undefined,
      appendSystemPrompt: meta?.appendSystemPrompt as string | undefined,
      allowedTools: meta?.allowedTools as string[] | undefined,
      disallowedTools: meta?.disallowedTools as string[] | undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  override async initialize(): Promise<void> {
    // Start HookServer for session tracking (SessionStart hook only).
    this.hookServer = await startHookServer({
      onSessionHook: (sessionId, _data) => {
        logger.debug('[ClaudeNativeSession] Session hook received', { sessionId });
        this.setClaudeSessionId(sessionId);
        if (this.session) {
          this.session.updateMetadata(m => ({ ...m, agentSessionId: sessionId }));
        }
        if (this.sessionScanner) {
          this.sessionScanner.onNewSession(sessionId);
          this.pendingScannerSessionId = null;
        } else {
          // Hook callbacks can arrive before the scanner is created during initialize().
          this.pendingScannerSessionId = sessionId;
        }
      },
    });
    this.hookSettingsFilePath = generateHookSettingsFile(this.hookServer.port);
    logger.info('[ClaudeNativeSession] HookServer started', {
      port: this.hookServer.port,
      settingsFile: this.hookSettingsFilePath,
    });

    await super.initialize();

    // Re-write the hook settings after initialize so we keep a single code path for
    // hook file generation, but do not inject MCP config here. Claude MCP config is
    // passed explicitly via --mcp-config in local/remote launchers.
    if (this.hookServer && this.hookSettingsFilePath) {
      try {
        updateHookSettingsFile(this.hookSettingsFilePath, this.hookServer.port);
      } catch (e) {
        logger.error('[ClaudeNativeSession] Failed to refresh hook settings file', toError(e));
      }
    }

    // Start session scanner for local PTY mode — watches Claude's .jsonl session files
    // and syncs conversation messages to the server so the mobile app can see them.
    if (this.opts.startingMode === 'local') {
      this.sessionScanner = await createSessionScanner({
        sessionId: this.opts.resumeSessionId ?? null,
        workingDirectory: this.opts.cwd,
        onMessage: message => {
          // Always consume appSentTexts entries for user messages, even during
          // scanner pause. Otherwise stale entries survive the pause and
          // incorrectly dedup CLI-originated user messages after resuming.
          if (message.type === 'user') {
            const jsonlText = extractJSONLUserText(message);
            const idx = this.appSentTexts.indexOf(jsonlText);
            if (idx !== -1) {
              this.appSentTexts.splice(idx, 1);
              logger.debug('[ClaudeNativeSession] Consuming app-sent dedup entry from JSONL', {
                text: jsonlText.slice(0, 100),
                scannerPaused: this.scannerPaused,
              });
              // During pause the remote SDK already forwarded this message;
              // when not paused the App already sent it to the server directly.
              // Either way the scanner should not forward it again.
              if (!this.scannerPaused) {
                this.lastStatus = 'working';
                this.session.sendNormalizedMessage({
                  role: 'event',
                  content: { type: 'status', state: 'working' },
                });
              }
              return;
            }
          }

          // In remote mode the SDK onMessage callback already forwards everything;
          // skip scanner output to prevent every message appearing twice.
          if (this.scannerPaused) return;

          if (message.type !== 'summary') {
            const mapped = mapClaudeLogMessageToNormalizedMessages(
              message,
              this.claudeJsonlMapperState
            );
            for (const n of mapped.messages) {
              this.session.sendNormalizedMessage(n);
            }
          }
          if (message.type === 'user') {
            this.lastStatus = 'working';
            this.session.sendNormalizedMessage({
              role: 'event',
              content: { type: 'status', state: 'working' },
            });
          } else if (message.type === 'assistant') {
            this.lastStatus = 'idle';
            this.session.sendNormalizedMessage({
              role: 'event',
              content: { type: 'status', state: 'idle' },
            });
          }
        },
      });
      if (this.pendingScannerSessionId) {
        this.sessionScanner.onNewSession(this.pendingScannerSessionId);
        this.pendingScannerSessionId = null;
      }
      logger.info('[ClaudeNativeSession] Session scanner started for local PTY sync', {
        cwd: this.opts.cwd,
        resumeSessionId: this.opts.resumeSessionId,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Mode switching — abort remote leg from outside (CLI switch_mode / App RPC)
  // ---------------------------------------------------------------------------

  override requestSwitchToLocal(): void {
    if (this.remoteLegAbort) {
      this.switchSequence += 1;
      this.switchTimestamp = Date.now();
      logger.info('[ClaudeNativeSession] requestSwitchToLocal — aborting remote leg', {
        switchSeq: this.switchSequence,
      });
      this.remoteLegAbort.abort();
    }
  }

  // ---------------------------------------------------------------------------
  // run() — local/remote loop (local starting mode) or base class (remote only)
  // ---------------------------------------------------------------------------

  override async run(): Promise<void> {
    // Remote-only sessions (App-initiated, no TTY) use the base class single-backend loop.
    if (this.opts.startingMode !== 'local') {
      return super.run();
    }

    // Local mode with local/remote loop — modelled after happy-cli's loop.ts
    registerKillSessionHandler(this.session.rpcHandlerManager, async () => {
      this.shouldExit = true;
      this.remoteLegAbort?.abort();
      this.backend?.abort();
    });

    // App RPC `switch` handler — switch from remote back to local
    this.session.rpcHandlerManager.registerHandler('switch', async () => {
      this.requestSwitchToLocal();
    });

    let mode: 'local' | 'remote' = 'local';

    try {
      while (!this.shouldExit) {
        logger.info('[ClaudeNativeSession] loop iteration', { mode });

        // Notify server + CLI about the mode change
        this.currentMode = mode;
        this.session.sendNormalizedMessage({
          role: 'event',
          content: { type: 'switch', mode },
        });
        this.session.updateAgentState(state => ({
          ...state,
          controlledByUser: mode === 'local',
        }));
        this.opts.broadcast(this.session.sessionId, {
          type: 'mode_switch',
          sessionId: this.session.sessionId,
          mode,
        });

        if (mode === 'local') {
          this.scannerPaused = false;
          logger.debug('[ClaudeNativeSession] scanner resumed (local mode)');
          const result = await this.runLocalLeg();
          if (result === 'switch') {
            logger.info('[ClaudeNativeSession] local→remote: local leg ended', {
              elapsed: this.switchTimestamp ? Date.now() - this.switchTimestamp : -1,
            });
            mode = 'remote';
            continue;
          }
          break; // exit
        } else {
          // Pause scanner — remote SDK onMessage already sends all messages.
          // Letting both run causes every message to be delivered twice.
          this.scannerPaused = true;
          logger.debug('[ClaudeNativeSession] scanner paused (remote mode)');
          await this.runRemoteLeg();
          logger.info('[ClaudeNativeSession] remote→local: remote leg ended', {
            switchSeq: this.switchSequence,
            elapsed: this.switchTimestamp ? Date.now() - this.switchTimestamp : -1,
          });
          mode = 'local';
        }
      }
    } finally {
      await this.shutdown('loop_ended');
    }
  }

  // ---------------------------------------------------------------------------
  // Local leg — PTY interactive mode
  // ---------------------------------------------------------------------------

  /**
   * Spawn Claude PTY for local interactive use.
   * Returns 'switch' when an App message arrives (PTY is killed, message stays in queue).
   * Returns 'exit' when the user quits Claude normally (PTY process exits).
   */
  private async runLocalLeg(): Promise<'switch' | 'exit'> {
    const backend = new ClaudeNativeBackend();
    this.backend = backend;

    const opts = this.buildBackendStartOpts();
    opts.startingMode = 'local';
    await backend.start(opts);
    logger.info('[ClaudeNativeSession] local PTY started', {
      switchElapsed: this.switchTimestamp ? Date.now() - this.switchTimestamp : -1,
    });

    // When any message enters the queue → switch to remote mode to process it.
    let switched = false;
    this.messageQueue.setOnMessage(() => {
      if (!switched) {
        switched = true;
        this.switchTimestamp = Date.now();
        logger.info('[ClaudeNativeSession] App message → local→remote switch start');
        // Broadcast mode_switch BEFORE killing PTY so CLI gates pty output first.
        // Prevents garbled bytes from the dying PTY reaching stdout.
        // The loop will broadcast a duplicate mode_switch:remote which CLI de-dups.
        this.opts.broadcast(this.session.sessionId, {
          type: 'mode_switch',
          sessionId: this.session.sessionId,
          mode: 'remote',
        });
        backend.abort();
      }
    });

    // Wait for PTY to exit (or abort on switch).
    // drainBackendOutput doesn't set shouldExit — safe for mode switching.
    await this.drainBackendOutput(backend);
    await backend.stop();
    this.messageQueue.setOnMessage(null);

    logger.info('[ClaudeNativeSession] local leg ended', { switched });
    return switched ? 'switch' : 'exit';
  }

  // ---------------------------------------------------------------------------
  // Remote leg — SDK mode, blocks waiting for App messages, returns on switch/timeout
  // ---------------------------------------------------------------------------

  /**
   * Process App messages via Claude SDK in a blocking loop.
   *
   * Unlike the previous non-blocking tryGet() approach, this blocks on
   * waitForMessagesAndGetAsString() between turns — keeping remote mode alive
   * so multiple App messages can be processed without restarting the PTY each time.
   *
   * Returns (switching back to local) when:
   *   1. Idle timeout (REMOTE_IDLE_TIMEOUT_MS) expires after the SDK finishes a turn
   *   2. CLI sends switch_mode IPC → requestSwitchToLocal() → abort
   *   3. App sends RPC `switch` → requestSwitchToLocal() → abort
   *   4. Session killed (shouldExit)
   */
  private async runRemoteLeg(): Promise<void> {
    const hookSettingsPath = this.hookSettingsFilePath ?? '';
    const mcpServers: Record<string, unknown> = this.freeServer?.url
      ? { free: { type: 'http', url: this.freeServer.url } }
      : {};

    const abortCtrl = new AbortController();
    this.remoteLegAbort = abortCtrl;

    if (this.shouldExit) {
      this.remoteLegAbort = null;
      return;
    }

    const permissionHandler = new PermissionHandler(this.session, {
      onPlanApproved: (message, mode) => this.messageQueue.unshift(message, mode),
    });

    const remoteLegStart = Date.now();
    const sdkMapperState = createSDKMapperState();
    logger.info('[ClaudeNativeSession] remote leg starting', {
      switchSeq: this.switchSequence,
    });

    try {
      await claudeRemote({
        sessionId: null,
        path: this.opts.cwd,
        mcpServers,
        claudeEnvVars: this.opts.env ?? {},
        claudeArgs: this.opts.resumeSessionId ? ['--resume', this.opts.resumeSessionId] : undefined,
        allowedTools: (this.freeServer?.toolNames ?? []).map(n => `mcp__free__${n}`),
        hookSettingsPath,
        signal: abortCtrl.signal,
        canCallTool: permissionHandler.handleToolCall.bind(permissionHandler),
        isAborted: (id: string) => permissionHandler.isAborted(id),

        nextMessage: async () => {
          // First try non-blocking — pick up already-queued messages immediately
          const immediate = this.messageQueue.tryGet();
          if (immediate) {
            logger.info('[ClaudeNativeSession] remote: nextMessage (queued)', {
              sinceStart: Date.now() - remoteLegStart,
              textLen: immediate.message.length,
            });
            permissionHandler.handleModeChange(immediate.mode.permissionMode);
            return { message: immediate.message, mode: immediate.mode };
          }

          // Block waiting for next message indefinitely.
          // Only exits when: CLI switch_mode, App RPC switch, or session kill → abortCtrl fires.
          logger.debug('[ClaudeNativeSession] remote: nextMessage blocking...');
          try {
            const item = await this.messageQueue.waitForMessagesAndGetAsString(abortCtrl.signal);
            if (!item) return null;
            logger.info('[ClaudeNativeSession] remote: nextMessage (waited)', {
              sinceStart: Date.now() - remoteLegStart,
              textLen: item.message.length,
            });
            permissionHandler.handleModeChange(item.mode.permissionMode);
            return { message: item.message, mode: item.mode };
          } catch {
            return null;
          }
        },

        onReady: () => {
          logger.info('[ClaudeNativeSession] remote SDK ready', {
            sinceStart: Date.now() - remoteLegStart,
          });
          this.session.sendSessionEvent({ type: 'ready' });
        },

        onSessionFound: (sessionId: string) => {
          logger.debug('[ClaudeNativeSession] remote SDK session found', { sessionId });
          this.setClaudeSessionId(sessionId);
          if (this.session) {
            this.session.updateMetadata(m => ({ ...m, agentSessionId: sessionId }));
          }
        },

        onMessage: msg => {
          permissionHandler.onMessage(msg);
          const normalized = mapSDKMessageToNormalized(msg, sdkMapperState);
          for (const n of normalized) {
            this.forwardOutputMessage(n);
          }
        },

        onCompletionEvent: (message: string) => {
          logger.info('[ClaudeNativeSession] remote completion', {
            sinceStart: Date.now() - remoteLegStart,
            message,
          });
        },
      });
    } catch (err) {
      if (!abortCtrl.signal.aborted) {
        logger.error('[ClaudeNativeSession] remote leg error', toError(err));
      }
    } finally {
      // Flush any tool calls that were in-flight when the remote leg ended or was aborted.
      for (const n of flushSDKOpenToolCalls(sdkMapperState)) {
        await this.forwardOutputMessage(n);
      }
      logger.info('[ClaudeNativeSession] remote leg finished', {
        switchSeq: this.switchSequence,
        sinceStart: Date.now() - remoteLegStart,
        aborted: abortCtrl.signal.aborted,
      });
      // Clean up permission handler state (pending tool call promises, etc.)
      permissionHandler.reset();
    }

    this.remoteLegAbort = null;
    logger.info('[ClaudeNativeSession] remote leg ended');
  }

  // ---------------------------------------------------------------------------
  // Shutdown & backend opts
  // ---------------------------------------------------------------------------

  override async shutdown(reason: string): Promise<void> {
    try {
      if (this.sessionScanner) {
        await this.sessionScanner.cleanup();
        this.sessionScanner = null;
        logger.info('[ClaudeNativeSession] Session scanner cleaned up');
      }
      await super.shutdown(reason);
    } finally {
      this.hookServer?.stop();
      this.hookServer = null;
      if (this.hookSettingsFilePath && existsSync(this.hookSettingsFilePath)) {
        try {
          unlinkSync(this.hookSettingsFilePath);
        } catch (err) {
          logger.debug('[ClaudeNativeSession] Failed to delete hook settings file', {
            path: this.hookSettingsFilePath,
            error: safeStringify(err),
          });
        }
        this.hookSettingsFilePath = null;
      }
    }
  }

  protected override buildBackendStartOpts(): AgentStartOpts {
    const base = super.buildBackendStartOpts();
    return {
      ...base,
      env: {
        ...base.env,
        ...(this.hookServer ? { FREE_HOOK_PORT: String(this.hookServer.port) } : {}),
        ...(this.hookSettingsFilePath
          ? { FREE_HOOK_SETTINGS_PATH: this.hookSettingsFilePath }
          : {}),
      },
    };
  }
}

/**
 * Extract the user's text from a JSONL user message.
 * Claude Code writes content as a plain string or an array of content blocks.
 */
function extractJSONLUserText(message: { type: 'user'; message?: { content?: unknown } }): string {
  const content = message.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: { type?: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text ?? '')
      .join('');
  }
  return '';
}
