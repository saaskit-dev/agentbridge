/**
 * ClaudeNativeBackend — AgentBackend implementation for Claude Code (native PTY/SDK).
 *
 * Two operating modes, selected via AgentStartOpts.startingMode:
 *
 * 1. Remote (SDK) mode — default; startingMode === 'remote' or undefined:
 *    Uses a "queue pass-through" pattern:
 *      - Creates an inner MessageQueue2<EnhancedMode>
 *      - Calls claudeRemote() fire-and-forget with the queue as message source
 *      - sendMessage() pushes text into the inner queue
 *      - abort() closes the inner queue → claudeRemote exits its nextMessage loop
 *      - SDK messages flow back via onMessage → mapSDKMessageToNormalized → output
 *
 * 2. Local (PTY) mode — startingMode === 'local':
 *    Spawns the claude_local_launcher.cjs with piped stdio so the daemon can
 *    proxy raw bytes over IPC to the attached CLI:
 *      - stdout/stderr chunks → base64 → pty_data IPC broadcast
 *      - sendPtyInput(data)  → Buffer.from(data, 'base64') → child stdin
 *      - resizePty(c, r)     → SIGWINCH to child process
 *      - abort()/stop()      → SIGTERM + output.end()
 *
 * In daemon mode, permission policy:
 *   - yolo → allow all tools
 *   - read-only / accept-edits → allow all (mobile app handles permission UX via RPC;
 *     TODO Phase 5: wire up live permission requests over IPC)
 */

import os from 'node:os';
import * as pty from 'node-pty';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { PushableAsyncIterable } from '@/utils/PushableAsyncIterable';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify, toError } from '@saaskit-dev/agentbridge';
import { getProcessTraceContext } from '@/telemetry';
import { hashObject } from '@/utils/deterministicJson';
import { claudeRemote } from '@/claude/claudeRemote';
import { claudeCliPath } from '@/claude/claudeLocal';
import type { EnhancedMode } from '@/claude/sessionTypes';
import type { ApiSessionClient } from '@/api/apiSession';
import { PermissionHandler } from '@/claude/utils/permissionHandler';
import type {
  AgentBackend,
  AgentStartOpts,
  BackendExitInfo,
  LocalAttachment,
} from '@/daemon/sessions/AgentBackend';
import type { NormalizedMessage } from '@/daemon/sessions/types';
import { createNormalizedEvent } from '@/daemon/sessions/types';
import {
  mapSDKMessageToNormalized,
  createSDKMapperState,
  flushSDKOpenToolCalls,
} from './mapSDKMessageToNormalized';
import type { SDKMapperState } from './mapSDKMessageToNormalized';
import type { PermissionMode } from '@/api/types';

const logger = new Logger('backends/claude-native/ClaudeNativeBackend');

/**
 * Map our PermissionMode to Claude CLI's --permission-mode flag values.
 *   read-only     → default        (shows native permission dialogs)
 *   accept-edits  → acceptEdits    (auto-approves edits, asks for others)
 *   yolo          → bypassPermissions (auto-approves everything)
 */
function mapPermissionMode(mode: PermissionMode): string {
  switch (mode) {
    case 'accept-edits':
      return 'acceptEdits';
    case 'yolo':
      return 'bypassPermissions';
    case 'read-only':
    default:
      return 'default';
  }
}

export class ClaudeNativeBackend implements AgentBackend {
  readonly agentType = 'claude-native' as const;
  readonly output = new PushableAsyncIterable<NormalizedMessage>();
  exitInfo?: BackendExitInfo;

  private innerQueue: MessageQueue2<EnhancedMode> | undefined;
  private abortController = new AbortController();
  private startOpts!: AgentStartOpts;
  private sdkMapperState: SDKMapperState = createSDKMapperState();
  private ptyProcess: pty.IPty | null = null;
  private ptyExitPromise: Promise<{
    exitCode: number | undefined;
    signal: number | undefined;
  }> | null = null;
  private permissionHandler: PermissionHandler | null = null;
  private localSpawnedAt = 0;
  private firstPtyDataLogged = false;

  async start(opts: AgentStartOpts): Promise<void> {
    this.startOpts = opts;

    if (opts.startingMode === 'local') {
      this.startLocalMode(opts);
      return;
    }

    this.startRemoteMode(opts);
  }

  // ---------------------------------------------------------------------------
  // Remote (SDK) mode
  // ---------------------------------------------------------------------------

  private startRemoteMode(opts: AgentStartOpts): void {
    this.innerQueue = new MessageQueue2<EnhancedMode>((mode: EnhancedMode) =>
      hashObject({ permissionMode: mode.permissionMode, model: mode.model ?? '' })
    );

    const hookSettingsPath = opts.env.FREE_HOOK_SETTINGS_PATH ?? '';
    const mcpServers: Record<string, unknown> = opts.mcpServerUrl
      ? { free: { type: 'http', url: opts.mcpServerUrl } }
      : {};

    const innerQueue = this.innerQueue;
    const permissionHandler = new PermissionHandler(opts.session, {
      onPlanApproved: (message, mode) => innerQueue.unshift(message, mode),
    });
    this.permissionHandler = permissionHandler;

    // Clear any stale pending requests from server state (recovery scenario)
    // This ensures the new permissionHandler's empty pendingRequests Map
    // is consistent with the server's agentState.requests
    opts.session.updateAgentState(currentState => ({
      ...currentState,
      requests: {}, // Clear pending, preserve completedRequests
    }));

    // Run claudeRemote fire-and-forget — it drives the session loop
    claudeRemote({
      sessionId: null,
      path: opts.cwd,
      mcpServers,
      claudeEnvVars: opts.env,
      claudeArgs: opts.resumeSessionId ? ['--resume', opts.resumeSessionId] : undefined,
      allowedTools: opts.freeMcpToolNames.map(n => `mcp__free__${n}`),
      hookSettingsPath,
      signal: this.abortController.signal,
      canCallTool: permissionHandler.handleToolCall.bind(permissionHandler),
      nextMessage: async () => {
        const item = await innerQueue.waitForMessagesAndGetAsString(this.abortController.signal);
        if (!item) return null;
        return { message: item.message, mode: item.mode };
      },
      onReady: () => {
        this.output.push(createNormalizedEvent({ type: 'ready' }));
      },
      isAborted: (toolCallId: string) => permissionHandler.isAborted(toolCallId),
      onSessionFound: (sessionId: string) => {
        logger.debug('[ClaudeNativeBackend] Claude session found', {
          sessionId,
          cwd: opts.cwd,
          traceId: getProcessTraceContext()?.traceId,
        });
      },
      onMessage: msg => {
        if (process.env.APP_ENV === 'development') {
          logger.debug('[ClaudeNativeBackend] raw SDK message', { raw: msg });
        }
        // Notify permission handler to track tool call IDs (needed for canCallTool resolution)
        permissionHandler.onMessage(msg);
        const normalized = mapSDKMessageToNormalized(msg, this.sdkMapperState);
        for (const n of normalized) {
          this.output.push(n);
        }
      },
      onCompletionEvent: (message: string) => {
        logger.debug('[ClaudeNativeBackend] Completion event', { message });
      },
    })
      .then(() => {
        logger.info('[ClaudeNativeBackend] claudeRemote completed normally', {
          cwd: opts.cwd,
          traceId: getProcessTraceContext()?.traceId,
        });
        this.exitInfo = { reason: 'claudeRemote completed normally' };
      })
      .catch(err => {
        if (this.abortController.signal.aborted) {
          logger.debug('[ClaudeNativeBackend] claudeRemote aborted', {
            cwd: opts.cwd,
            traceId: getProcessTraceContext()?.traceId,
          });
          this.exitInfo = { reason: 'aborted' };
        } else {
          const error = toError(err);
          logger.error('[ClaudeNativeBackend] claudeRemote error', error, {
            cwd: opts.cwd,
            traceId: getProcessTraceContext()?.traceId,
          });
          this.exitInfo = { reason: `claudeRemote error: ${safeStringify(err)}`, error };
          // Push a user-visible error event instead of setError() — setError
          // causes the consumer's for-await to throw, which is not user-friendly.
          this.output.push(
            createNormalizedEvent({
              type: 'daemon-log',
              level: 'error',
              component: 'claude-native',
              message: `Agent session failed: ${safeStringify(err)}`,
              error: `Agent session failed: ${safeStringify(err)}`,
            })
          );
        }
      })
      .finally(() => {
        // Flush any tool calls that were in-flight when the session ended or was aborted.
        // If the session ended normally, the result message already flushed them (no-op here).
        // If aborted, no result message arrives, so this closes any stuck tool calls.
        for (const n of flushSDKOpenToolCalls(this.sdkMapperState)) {
          this.output.push(n);
        }
        if (!this.output.done) {
          this.output.end();
        }
      });

    logger.debug('[ClaudeNativeBackend] remote mode started', {
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      resumeSessionId: opts.resumeSessionId,
      hasHookSettings: Boolean(hookSettingsPath),
      traceId: getProcessTraceContext()?.traceId,
    });
  }

  // ---------------------------------------------------------------------------
  // Local (PTY) mode
  // ---------------------------------------------------------------------------

  private startLocalMode(opts: AgentStartOpts): void {
    const sessionId = opts.session.sessionId;
    const broadcast = opts.broadcast;

    const claudeArgs: string[] = [];
    if (opts.resumeSessionId) {
      claudeArgs.push('--resume', opts.resumeSessionId);
    }
    if (opts.env.FREE_HOOK_SETTINGS_PATH) {
      claudeArgs.push('--settings', opts.env.FREE_HOOK_SETTINGS_PATH);
    }
    if (opts.mcpServerUrl) {
      claudeArgs.push(
        '--mcp-config',
        JSON.stringify({
          mcpServers: {
            free: {
              type: 'http',
              url: opts.mcpServerUrl,
            },
          },
        })
      );
    }
    // Map our PermissionMode to Claude's --permission-mode flag values.
    const claudePermMode = mapPermissionMode(opts.permissionMode ?? 'read-only');
    claudeArgs.push('--permission-mode', claudePermMode);

    logger.debug('[ClaudeNativeBackend] spawning local PTY process', {
      claudeCliPath,
      claudeArgs,
      cwd: opts.cwd,
      traceId: getProcessTraceContext()?.traceId,
    });

    // Use a real PTY so Claude Code's interactive UI works (it requires isTTY).
    // Initial size defaults to 80x24; CLIClient sends a pty_resize immediately after attach.
    // Note: daemon-internal secrets are already stripped from opts.env by ipcSpawnSession in run.ts.
    const ptyProc = pty.spawn(process.execPath, [claudeCliPath, ...claudeArgs], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env } as Record<string, string>,
    });

    this.ptyProcess = ptyProc;
    this.localSpawnedAt = Date.now();
    this.firstPtyDataLogged = false;
    logger.debug('[ClaudeNativeBackend] PTY process spawned', {
      pid: ptyProc.pid,
      cwd: opts.cwd,
      traceId: getProcessTraceContext()?.traceId,
    });

    // Forward PTY output to CLI clients as base64-encoded pty_data IPC messages
    let ptyChunkCount = 0;
    ptyProc.onData((data: string) => {
      if (!broadcast) return;
      ptyChunkCount++;
      if (!this.firstPtyDataLogged) {
        this.firstPtyDataLogged = true;
        logger.info('[ClaudeNativeBackend] first PTY data after spawn', {
          pid: ptyProc.pid,
          cwd: opts.cwd,
          sinceSpawn: Date.now() - this.localSpawnedAt,
          bytes: data.length,
          traceId: getProcessTraceContext()?.traceId,
        });
      }
      if (ptyChunkCount <= 5 || ptyChunkCount % 50 === 0) {
        logger.debug('[ClaudeNativeBackend] pty_data forwarded', {
          pid: ptyProc.pid,
          bytes: data.length,
          chunk: ptyChunkCount,
        });
      }
      broadcast(sessionId, {
        type: 'pty_data',
        sessionId,
        data: Buffer.from(data).toString('base64'),
      });
    });

    // Propagate abort signal to child
    this.abortController.signal.addEventListener(
      'abort',
      () => {
        ptyProc.kill();
      },
      { once: true }
    );

    this.ptyExitPromise = new Promise(resolve => {
      ptyProc.onExit(({ exitCode, signal }) => {
        const signalName = signal != null ? signalToName(signal) : undefined;
        const uptime = Date.now() - this.localSpawnedAt;

        // Store structured exit info for AgentSession crash diagnostics
        this.exitInfo = {
          exitCode: exitCode ?? undefined,
          signal: signalName,
          reason:
            exitCode === 0
              ? 'exited normally'
              : `PTY exited (code ${exitCode ?? 'null'}${signalName ? `, ${signalName}` : ''})`,
        };

        logger.info('[ClaudeNativeBackend] local PTY exited', {
          exitCode,
          signal: signalName ?? signal,
          pid: ptyProc.pid,
          cwd: opts.cwd,
          uptimeMs: uptime,
          ptyChunksEmitted: ptyChunkCount,
          traceId: getProcessTraceContext()?.traceId,
        });
        this.ptyProcess = null;

        if (!this.output.done) {
          // If the agent crashed (non-zero exit), push an error event so the
          // user sees a clear message instead of a silent "session ended".
          if (exitCode !== 0 && exitCode !== null) {
            this.output.push(
              createNormalizedEvent({
                type: 'daemon-log',
                level: 'error',
                component: 'claude-native',
                message: `Agent process exited unexpectedly (code ${exitCode}${signalName ? `, ${signalName}` : ''})`,
                error: `Agent process exited unexpectedly (code ${exitCode}${signalName ? `, ${signalName}` : ''})`,
              })
            );
          }

          this.output.push(createNormalizedEvent({ type: 'status', state: 'idle' }));
          this.output.end();
        }
        resolve({ exitCode, signal });
      });
    });

    logger.debug('[ClaudeNativeBackend] local mode started', {
      cwd: opts.cwd,
      resumeSessionId: opts.resumeSessionId,
      traceId: getProcessTraceContext()?.traceId,
    });
  }

  // ---------------------------------------------------------------------------
  // Message sending
  // ---------------------------------------------------------------------------

  async sendMessage(
    text: string,
    permissionMode?: PermissionMode,
    attachments?: LocalAttachment[]
  ): Promise<void> {
    if (attachments?.length) {
      logger.warn(
        '[ClaudeNativeBackend] image attachments not supported in native mode, sending text only',
        {
          count: attachments.length,
        }
      );
    }
    // Emit working status when actually starting to process a user message
    this.output.push(createNormalizedEvent({ type: 'status', state: 'working' }));

    if (this.ptyProcess) {
      // Local PTY mode: write text as if the user typed it, followed by carriage return.
      // Must use \r (CR) not \n (LF) — in a terminal, Enter sends CR (0x0D).
      // Claude Code's Ink TUI in raw mode only recognizes \r as the submit key.
      // Trim leading/trailing whitespace: web app may include trailing \n from Enter keypress.
      const trimmed = text.trim();
      logger.debug('[ClaudeNativeBackend] sendMessage (local PTY)', {
        cwd: this.startOpts.cwd,
        traceId: getProcessTraceContext()?.traceId,
        preview: trimmed.slice(0, 100),
      });
      this.ptyProcess.write(trimmed + '\r');
      return;
    }
    // Remote (SDK) mode
    logger.debug('[ClaudeNativeBackend] sendMessage (remote SDK)', {
      cwd: this.startOpts.cwd,
      traceId: getProcessTraceContext()?.traceId,
      preview: text.slice(0, 100),
    });
    const mode: EnhancedMode = {
      permissionMode: permissionMode ?? this.startOpts.permissionMode ?? 'read-only',
      model: this.startOpts.model,
    };
    this.innerQueue?.push(text, mode);
  }

  // ---------------------------------------------------------------------------
  // PTY control (local mode only)
  // ---------------------------------------------------------------------------

  /** Forward raw keystroke bytes from CLI to the spawned Claude process's stdin. */
  sendPtyInput(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(Buffer.from(data, 'base64').toString());
    }
  }

  /** Notify the spawned Claude process that the terminal was resized. */
  resizePty(cols: number, rows: number): void {
    if (this.ptyProcess) {
      logger.debug('[ClaudeNativeBackend] resizePty', { cols, rows, pid: this.ptyProcess.pid });
      this.ptyProcess.resize(cols, rows);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onSessionChange(newSession: ApiSessionClient): void {
    this.permissionHandler?.updateSession(newSession);
  }

  async setModel(modelId: string): Promise<void> {
    logger.warn(
      '[ClaudeNativeBackend] setModel called but runtime model switching is not supported in PTY/SDK mode',
      { modelId }
    );
  }

  async setMode(modeId: string): Promise<void> {
    logger.warn(
      '[ClaudeNativeBackend] setMode called but runtime mode switching is not supported in PTY/SDK mode',
      { modeId }
    );
  }

  async setConfig(optionId: string, value: string): Promise<void> {
    logger.warn(
      '[ClaudeNativeBackend] setConfig called but runtime config switching is not supported in PTY/SDK mode',
      { optionId, value }
    );
  }

  async abort(): Promise<void> {
    logger.debug('[ClaudeNativeBackend] abort — closing inner queue and aborting controller', {
      cwd: this.startOpts?.cwd,
      traceId: getProcessTraceContext()?.traceId,
    });
    this.innerQueue?.close();
    this.abortController.abort();
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }

  async stop(): Promise<void> {
    logger.debug('[ClaudeNativeBackend] stop', {
      cwd: this.startOpts?.cwd,
      traceId: getProcessTraceContext()?.traceId,
    });
    this.innerQueue?.close();
    this.abortController.abort();

    if (this.ptyProcess && this.ptyExitPromise) {
      // Send SIGTERM and wait up to 5s for the process to exit gracefully
      try {
        this.ptyProcess.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      const timeout = new Promise<null>(r => setTimeout(() => r(null), 5000));
      const result = await Promise.race([this.ptyExitPromise, timeout]);

      if (!result && this.ptyProcess) {
        // SIGTERM timed out — escalate to SIGKILL
        logger.warn('[ClaudeNativeBackend] PTY did not exit after SIGTERM, sending SIGKILL', {
          cwd: this.startOpts?.cwd,
        });
        try {
          this.ptyProcess.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        await Promise.race([this.ptyExitPromise, new Promise(r => setTimeout(r, 2000))]);
      }
      // onExit handler will call output.end() — no need to duplicate here
    } else if (this.ptyProcess) {
      try {
        this.ptyProcess.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }

    if (!this.output.done) {
      this.output.end();
    }
  }
}

/** Map numeric signal from node-pty to conventional POSIX name. */
function signalToName(sig: number): string | undefined {
  if (!sig) return undefined;
  const entry = Object.entries(os.constants.signals).find(([, v]) => v === sig);
  return entry ? entry[0] : `signal(${sig})`;
}
