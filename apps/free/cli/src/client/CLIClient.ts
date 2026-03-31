/**
 * CLIClient — orchestrates the IPC-based session lifecycle for the CLI.
 *
 * Flow:
 *   1. Connect to daemon's Unix socket (IPCClient)
 *   2. Send spawn_session, wait for spawn_result
 *   3. Send attach, receive history replay
 *   4. Stream agent_output → CLIRenderer.render()
 *   5. Start InputHandler (stdin → IPC send_input)
 *   6. Exit when session_state = 'archived'
 *
 * Claude local↔remote mode switching:
 *   - Local mode: raw PTY bytes forwarded via pty_data, InputHandler in PTY mode
 *   - Remote mode: Ink-based RemoteModeDisplay renders agent_output messages,
 *     InputHandler disabled (Ink manages stdin via useInput)
 *   - mode_switch IPC triggers the transition between modes
 *
 * This is the sole entry point for all agent types (claude/codex/gemini/opencode).
 */

import React from 'react';
import { render as inkRender, type Instance as InkInstance } from 'ink';
import { Logger, continueTrace } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify, toError } from '@saaskit-dev/agentbridge';
import type { ScopedLogger } from '@saaskit-dev/agentbridge/telemetry';
import { IPCClient } from '@/daemon/ipc/IPCClient';
import { CLIRenderer } from './CLIRenderer';
import { InputHandler } from './InputHandler';
import { RemoteModeDisplay } from '@/ui/ink/RemoteModeDisplay';
import { MessageBuffer } from '@/ui/ink/messageBuffer';
import { configuration } from '@/configuration';
import { getProcessTraceContext } from '@/telemetry';
import type { SpawnSessionOptions } from '@/daemon/ipc/protocol';
import type { IPCServerMessage } from '@/daemon/ipc/protocol';
import type { NormalizedMessage, NormalizedAgentContent } from '@/daemon/sessions/types';

const logger = new Logger('client/CLIClient');

export interface CLIClientOptions {
  spawnOpts: SpawnSessionOptions;
  /** Show <thinking> blocks in output. Default: false. */
  showThinking?: boolean;
  /** Show token usage after each turn. Default: false. */
  showTokenCount?: boolean;
  /** Attach to an existing daemon session instead of spawning a new one. */
  attachSessionId?: string;
}

/**
 * Convert a NormalizedMessage from agent_output IPC into MessageBuffer entries
 * for display in RemoteModeDisplay during remote mode.
 */
function feedMessageToBuffer(msg: NormalizedMessage, buffer: MessageBuffer): void {
  if (msg.role === 'user') {
    buffer.addMessage(`👤 ${msg.content.text}`, 'user');
    // User message starts a new assistant turn — next text block must not append to previous response.
    buffer.markNewAssistantTurn();
  } else if (msg.role === 'agent') {
    for (const block of msg.content as NormalizedAgentContent[]) {
      switch (block.type) {
        case 'text':
          buffer.updateLastMessage(block.text, 'assistant');
          break;
        case 'thinking':
          // Skip thinking blocks in remote display for brevity
          break;
        case 'tool-call': {
          buffer.addMessage(`🔧 Tool: ${block.name}`, 'tool');
          // Show tool input (truncated) — matching happy
          if (block.input) {
            const inputStr = JSON.stringify(block.input, null, 2);
            const maxLen = 500;
            if (inputStr.length > maxLen) {
              buffer.addMessage(`Input: ${inputStr.slice(0, maxLen)}... (truncated)`, 'tool');
            } else {
              buffer.addMessage(`Input: ${inputStr}`, 'tool');
            }
          }
          break;
        }
        case 'tool-result': {
          if (block.is_error) {
            const errText =
              typeof block.content === 'string'
                ? block.content.slice(0, 200)
                : (JSON.stringify(block.content)?.slice(0, 200) ?? '');
            buffer.addMessage(`❌ ${errText}`, 'result');
          } else {
            buffer.addMessage(`✅ Tool Result (ID: ${block.tool_use_id})`, 'result');
            if (block.content) {
              const outputStr =
                typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content, null, 2);
              const maxLen = 200;
              if (outputStr.length > maxLen) {
                buffer.addMessage(outputStr.slice(0, maxLen) + '... (truncated)', 'result');
              } else {
                buffer.addMessage(outputStr, 'result');
              }
            }
          }
          break;
        }
        case 'summary':
          buffer.addMessage(`📋 ${block.summary}`, 'status');
          break;
        case 'sidechain':
          buffer.addMessage(`🔀 Subagent: ${block.prompt.slice(0, 80)}`, 'status');
          break;
      }
    }
  } else if (msg.role === 'event') {
    const event = msg.content;
    switch (event.type) {
      case 'status':
        if (event.state === 'working') {
          // Deduplicate: only add if the last message is not already "Working..."
          const msgs = buffer.getMessages();
          const last = msgs[msgs.length - 1];
          if (!last || last.content !== '⏳ Working...') {
            buffer.addMessage('⏳ Working...', 'status');
          }
        } else if (event.state === 'idle') {
          // Turn complete — next text block must start a new assistant message.
          buffer.markNewAssistantTurn();
        }
        break;
      case 'ready':
        buffer.addMessage('✅ Ready for next message', 'status');
        break;
      case 'message':
        // Display formatted text from system/init and result/summary+stats
        buffer.addMessage(event.message, 'status');
        break;
      case 'daemon-log':
        buffer.addMessage(`❌ ${event.message}`, 'result');
        break;
    }
  }
}

export async function runWithDaemonIPC(opts: CLIClientOptions): Promise<void> {
  const ipc = new IPCClient();

  logger.debug('step 1/5: connecting to daemon IPC socket...');
  try {
    await ipc.connect(configuration.daemonSocketPath);
    logger.debug('step 1/5: connected to daemon IPC');
  } catch (err) {
    throw new Error(
      `Cannot connect to daemon IPC socket at ${configuration.daemonSocketPath}: ${safeStringify(err)}\n` +
        'Is the daemon running? Try: free daemon start'
    );
  }

  const agentType = opts.spawnOpts.agent ?? 'claude';

  // PTY mode: only when agent is claude and stdin is a real TTY.
  // In PTY mode, InputHandler sets stdin.setRawMode(true) and forwards raw bytes
  // as pty_data IPC messages so the daemon can pipe them to the agent's stdin.
  // When attaching to an orphan session (headless / no TTY), force remote mode.
  const isPtyMode =
    !opts.attachSessionId && agentType === 'claude-native' && process.stdin.isTTY === true;
  // Tell the daemon which backend mode to use so ClaudeBackend can spawn correctly.
  const startingMode = isPtyMode ? 'local' : 'remote';
  logger.debug('agent config', {
    agent: agentType,
    isPtyMode,
    startingMode,
    stdinIsTTY: process.stdin.isTTY,
    attachSessionId: opts.attachSessionId,
  });

  // 1. Spawn or attach to session
  const sessionId = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipc.off('spawn_result', handler);
      reject(new Error('Daemon did not respond within 30s'));
    }, 30_000);

    const handler = (msg: IPCServerMessage) => {
      if (msg.type !== 'spawn_result') return;
      clearTimeout(timeout);
      ipc.off('spawn_result', handler);
      logger.debug('step 2/5: spawn_result received', {
        success: msg.success,
        sessionId: msg.success ? msg.sessionId : undefined,
        error: !msg.success ? msg.error : undefined,
      });
      if (msg.success) {
        resolve(msg.sessionId);
      } else {
        reject(
          new Error(
            `Daemon failed to ${opts.attachSessionId ? 'attach to' : 'spawn'} session: ${msg.error ?? 'unknown error'}`
          )
        );
      }
    };
    ipc.on('spawn_result', handler);

    if (opts.attachSessionId) {
      logger.debug('step 2/5: sending attach_session to daemon...', {
        attachSessionId: opts.attachSessionId,
      });
      ipc.send({ type: 'attach_session', sessionId: opts.attachSessionId });
    } else {
      logger.debug('step 2/5: sending spawn_session to daemon...', {
        agentType,
        startingMode,
        directory: opts.spawnOpts.directory,
      });
      ipc.send({ type: 'spawn_session', opts: { ...opts.spawnOpts, startingMode } });
    }
  });

  logger.debug('step 2/5: session spawned', { sessionId });

  // All subsequent logs include sessionId (+ traceId from global context provider)
  const ctx = getProcessTraceContext();
  const log: ScopedLogger | Logger = ctx
    ? logger.withContext(continueTrace({ ...ctx, sessionId }))
    : logger;

  // 2. Attach + render
  const renderer = new CLIRenderer({
    agentType,
    showThinking: opts.showThinking,
    showTokenCount: opts.showTokenCount,
  });
  const inputHandler = new InputHandler(ipc, sessionId, { isPtyMode });

  // Remote mode state: Ink UI for displaying agent messages when Claude switches to SDK mode
  let inkInstance: InkInstance | null = null;
  const messageBuffer = new MessageBuffer();

  /** Track current display mode to de-dup mode_switch IPC messages. */
  let currentDisplayMode: 'local' | 'remote' = isPtyMode ? 'local' : 'remote';

  /**
   * PTY output gating: during remote→local transition, pty_data may arrive from
   * the daemon's new PTY before the CLI finishes Ink cleanup. Buffer it and flush
   * after cleanup so no garbled bytes are written to stdout mid-transition.
   */
  let ptyReady = isPtyMode;
  let ptyBuffer: string[] = [];
  /** Last pty_data hex for diagnostics — logged when mode_switch arrives. */
  let lastPtyDataHex = '';
  /** Timestamp when daemon told CLI we are switching back to local mode. */
  let localSwitchStartAt = 0;
  /** Whether we've already logged the first PTY chunk after a local switch. */
  let firstPtyChunkAfterLocalSwitch = false;
  /** Timestamp when daemon told CLI we are switching from local to remote mode. */
  let remoteSwitchStartAt = 0;
  /** Whether we've already logged the first agent_output after a remote switch. */
  let firstAgentOutputAfterRemoteSwitch = false;

  let agentOutputCount = 0;
  let ptyDataCount = 0;

  // Promise that resolves when the session ends (archived)
  const sessionEnded = new Promise<void>(resolve => {
    ipc.on('history', (msg: IPCServerMessage) => {
      if (msg.type !== 'history' || msg.sessionId !== sessionId) return;
      log.debug('history received', { count: msg.msgs.length });
      // PTY mode: Claude renders its own UI via raw bytes — normalized history is meaningless here.
      // Remote mode: show recent messages so user knows where the conversation was.
      if (!isPtyMode) {
        renderer.onHistory(msg.msgs);
      }
    });

    ipc.on('agent_output', (msg: IPCServerMessage) => {
      if (msg.type !== 'agent_output' || msg.sessionId !== sessionId) return;
      agentOutputCount++;
      if (remoteSwitchStartAt && !firstAgentOutputAfterRemoteSwitch) {
        firstAgentOutputAfterRemoteSwitch = true;
        const ct = Array.isArray(msg.msg?.content)
          ? 'array'
          : ((msg.msg?.content as any)?.type ?? 'unknown');
        log.info('first agent_output after remote switch', {
          elapsed: Date.now() - remoteSwitchStartAt,
          role: msg.msg?.role,
          contentType: ct,
        });
      }
      if (agentOutputCount <= 5 || agentOutputCount % 20 === 0) {
        const ct = Array.isArray(msg.msg?.content)
          ? 'array'
          : ((msg.msg?.content as any)?.type ?? 'unknown');
        log.debug('agent_output', {
          count: agentOutputCount,
          role: msg.msg?.role,
          contentType: ct,
        });
      }

      // Route to Ink display when in remote mode, otherwise to CLIRenderer.
      // In PTY local mode, suppress event messages (status/token_count/etc.)
      // — Claude's own PTY output already renders its UI state; writing extra
      // text to stdout would garble the terminal.
      if (inkInstance) {
        feedMessageToBuffer(msg.msg, messageBuffer);
      } else if (currentDisplayMode === 'local' && msg.msg.role === 'event') {
        // Suppress — PTY handles its own display
      } else {
        renderer.render(msg.msg);
      }
    });

    ipc.on('session_state', (msg: IPCServerMessage) => {
      if (msg.type !== 'session_state' || msg.sessionId !== sessionId) return;
      log.debug('session_state', { state: msg.state });
      if (msg.state === 'archived') {
        // Clean up Ink UI if still mounted
        if (inkInstance) {
          inkInstance.unmount();
          inkInstance = null;
        }
        resolve();
      }
    });

    // Claude local mode: daemon forwards raw PTY bytes from the agent process.
    // Gated by ptyReady — during remote→local transition, data is buffered
    // and flushed after Ink cleanup to prevent garbled output.
    let ptyChunksSinceSwitch = 0;
    ipc.on('pty_data', (msg: IPCServerMessage) => {
      if (msg.type !== 'pty_data' || msg.sessionId !== sessionId) return;
      ptyDataCount++;
      ptyChunksSinceSwitch++;
      if (ptyDataCount <= 3 || ptyDataCount % 50 === 0) {
        const rawLen = msg.data ? Buffer.from(msg.data, 'base64').length : 0;
        log.debug('pty_data', { count: ptyDataCount, bytes: rawLen, gated: !ptyReady });
      }
      const raw = Buffer.from(msg.data, 'base64');
      // Log first 3 pty_data chunks after mode switch for diagnostics
      if (ptyChunksSinceSwitch <= 3) {
        log.debug('pty_data_hex', {
          chunk: ptyChunksSinceSwitch,
          bytes: raw.length,
          hex: raw.toString('hex').slice(0, 200),
          ascii: raw
            .toString('utf-8')
            .replace(/[^\x20-\x7e]/g, '.')
            .slice(0, 200),
        });
      }
      if (localSwitchStartAt && !firstPtyChunkAfterLocalSwitch) {
        firstPtyChunkAfterLocalSwitch = true;
        log.info('first pty_data after local switch', {
          elapsed: Date.now() - localSwitchStartAt,
          bytes: raw.length,
        });
      }
      lastPtyDataHex = raw.toString('hex').slice(-40);
      if (!ptyReady) {
        ptyBuffer.push(msg.data);
        return;
      }
      renderer.writePtyData(msg.data);
    });

    // Claude mode switching: daemon notifies when switching between local PTY and remote SDK.
    // Local → Remote: mount Ink RemoteModeDisplay, disable InputHandler
    // Remote → Local: unmount Ink, resume PTY mode InputHandler
    ipc.on('mode_switch', (msg: IPCServerMessage) => {
      if (msg.type !== 'mode_switch' || msg.sessionId !== sessionId) return;

      // De-dup: skip if we're already in the target mode
      if (msg.mode === currentDisplayMode) {
        log.debug('mode_switch ignored (already in mode)', { mode: msg.mode });
        return;
      }
      currentDisplayMode = msg.mode as 'local' | 'remote';
      log.info('mode_switch received', { mode: msg.mode });

      if (msg.mode === 'remote') {
        remoteSwitchStartAt = Date.now();
        firstAgentOutputAfterRemoteSwitch = false;
        log.info('mode_switch remote: begin remote restore');
        // Gate PTY output — any pty_data arriving during remote mode is discarded
        ptyReady = false;
        ptyBuffer = [];
        ptyChunksSinceSwitch = 0;

        // Log last pty_data hex to diagnose partial UTF-8 sequences
        log.debug('last pty_data before remote switch', { lastHex: lastPtyDataHex });

        // Disable InputHandler so Ink can take over stdin
        inputHandler.switchToDisabledMode();

        // Full terminal reset (ESC c = RIS) to flush any pending partial UTF-8
        // sequence from the last PTY output. Without this, the ESC byte of our
        // ANSI clear-screen gets absorbed as a UTF-8 continuation, producing garbled text.
        process.stdout.write('\x1bc');

        // Mount Ink RemoteModeDisplay
        messageBuffer.clear();
        messageBuffer.addMessage('Starting remote session...', 'status');
        inkInstance = inkRender(
          React.createElement(RemoteModeDisplay, {
            messageBuffer,
            logPath: configuration.isDev ? configuration.logsDir : undefined,
            onExit: () => {
              log.info('RemoteModeDisplay: user requested exit');
              ipc.send({ type: 'abort', sessionId });
            },
            onSwitchToLocal: () => {
              log.info('RemoteModeDisplay: user requested switch to local');
              ipc.send({ type: 'switch_mode', sessionId });
            },
          }),
          { exitOnCtrlC: false, patchConsole: false }
        );
        log.info('Ink RemoteModeDisplay mounted', {
          elapsed: Date.now() - remoteSwitchStartAt,
        });
      } else {
        localSwitchStartAt = Date.now();
        firstPtyChunkAfterLocalSwitch = false;
        log.info('mode_switch local: begin local restore');
        // Remote → Local: unmount Ink, resume PTY mode.
        // pty_data arriving during this window is buffered (ptyReady is still false)
        // and flushed after cleanup so no garbled bytes appear.

        if (inkInstance) {
          log.debug('transition: unmounting Ink');
          if (process.stdin.isTTY) {
            try {
              process.stdin.setRawMode(false);
            } catch {
              /* ignore */
            }
          }
          inkInstance.unmount();
          inkInstance = null;
          messageBuffer.clear();
          log.debug('transition: Ink unmounted');
        }

        // Wait for Ink's async cleanup (React fiber + useInput teardown) to settle,
        // then resume PTY mode and flush any buffered pty_data.
        ptyChunksSinceSwitch = 0;
        setTimeout(() => {
          // Full terminal reset (ESC c) — same reason as local→remote:
          // flush any partial UTF-8 sequences + reset all terminal state
          process.stdout.write('\x1bc');
          inputHandler.switchToPtyMode();
          const buffered = ptyBuffer.length;
          ptyReady = true;
          for (const data of ptyBuffer) {
            renderer.writePtyData(data);
          }
          ptyBuffer = [];
          log.info('PTY mode resumed', {
            elapsed: Date.now() - localSwitchStartAt,
            bufferedChunks: buffered,
            stdinIsRaw: process.stdin.isRaw,
            stdinIsPaused: process.stdin.isPaused(),
          });

          // Safety net: re-assert stdin raw mode after Ink's deferred cleanup.
          // Ink's useInput cleanup may asynchronously call stdin.setRawMode(false)
          // or stdin.pause() via React fiber, overriding our switchToPtyMode() setup.
          setTimeout(() => {
            if (process.stdin.isTTY && !process.stdin.destroyed) {
              const wasRaw = process.stdin.isRaw;
              const wasPaused = process.stdin.isPaused();
              if (!wasRaw || wasPaused) {
                log.info('stdin state drifted after Ink cleanup, re-asserting', {
                  wasRaw,
                  wasPaused,
                });
                try {
                  process.stdin.setRawMode(true);
                  process.stdin.resume();
                } catch (e) {
                  log.error('stdin re-assert failed', toError(e));
                }
              }
            }
          }, 300);
        }, 100);
      }
    });
  });

  // Re-attach on reconnect (daemon socket disconnect/reconnect)
  ipc.onReconnect = () => {
    log.debug('reconnected to daemon, re-attaching session');
    ipc.send({ type: 'attach', sessionId });
  };

  // 3. Attach to start receiving output
  log.debug('step 3/5: attaching to session...');
  ipc.send({ type: 'attach', sessionId });

  // 4. Start reading stdin
  log.debug('step 4/5: starting input handler...');
  inputHandler.start();

  // 5. Wait for session to end
  log.debug('step 5/5: waiting for session to end...');
  await sessionEnded;

  inputHandler.stop();
  ipc.disconnect();

  log.debug('session ended', { agentOutputCount, ptyDataCount });
}
