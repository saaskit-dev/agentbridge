/**
 * OpenCode CLI Entry Point
 *
 * This module provides the main entry point for running the OpenCode agent
 * through Free CLI. It manages the agent lifecycle, session state, and
 * communication with the Free server and mobile app.
 *
 * OpenCode is an open source AI coding agent that supports ACP.
 * Features:
 * - 75+ LLM providers through Models.dev
 * - GitHub Copilot integration
 * - ChatGPT Plus/Pro integration
 * - Local models support
 */

import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { createOpenCodeBackend } from '@saaskit-dev/agentbridge';
import { render } from 'ink';
import React from 'react';
import packageJson from '../../package.json';
import type { AgentBackend, AgentMessage } from '@/agent';
import { ApiClient } from '@/api/api';
import type { ApiSessionClient } from '@/api/apiSession';
import { serverCapabilities } from '@/api/serverCapabilities';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { startFreeServer } from '@/claude/utils/startFreeServer';
import { configuration } from '@/configuration';
import { initialMachineMetadata } from '@/daemon/run';
import { Credentials, readSettings } from '@/persistence';
import { Logger, getCollector } from '@saaskit-dev/agentbridge/telemetry';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { hashObject } from '@/utils/deterministicJson';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { projectPath } from '@/projectPath';
import { MessageBuffer } from '@/ui/ink/messageBuffer';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { stopCaffeinate } from '@/utils/caffeinate';
import { connectionState } from '@/utils/serverConnectionErrors';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import { OpenCodeDisplay } from '@/ui/ink/OpenCodeDisplay';
import type { PermissionMode } from '@/api/types';
import { startCaffeinate } from '@/utils/caffeinate';
import type { SpawnSessionOptions } from '@/modules/common/registerCommonHandlers';

const logger = new Logger('opencode/runOpenCode');
// Import from packages/core

/**
 * OpenCode session mode
 */
interface OpenCodeMode {
  permissionMode: PermissionMode;
}

const CHANGE_TITLE_INSTRUCTION = `
IMPORTANT: After completing the user's request, use the change_title tool to set a descriptive title for this conversation. The title should be concise (max 50 chars) and summarize what was done.
`;

/** Retry configuration for transient errors */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Main entry point for the opencode command with ink UI
 */
export async function runOpenCode(opts: {
  credentials: Credentials;
  startedBy?: 'daemon' | 'terminal';
  /** ACP session ID to resume (for CLI update recovery) */
  resumeSessionId?: string;
}): Promise<void> {
  const sessionTag = randomUUID();

  // Set backend for offline warnings
  connectionState.setBackend('OpenCode');

  // Show server URL to user
  console.log(chalk.gray(`Connecting to: ${chalk.cyan(configuration.serverUrl)}`));

  const api = await ApiClient.create(opts.credentials);

  // Detect server capabilities (for streaming text, etc.)
  await serverCapabilities.detect();

  //
  // Machine
  //

  const settings = await readSettings();
  const machineId = settings?.machineId;
  const sandboxConfig = settings?.sandboxConfig;

  if (!machineId) {
    logger.error('[START] No machine ID found in settings.');
    process.exit(1);
  }
  logger.debug(`Using machineId: ${machineId}`);

  await api.getOrCreateMachine({
    machineId,
    metadata: initialMachineMetadata,
  });

  //
  // Create session
  //

  const { state, metadata } = createSessionMetadata({
    flavor: 'opencode',
    machineId,
    startedBy: opts.startedBy,
    sandbox: sandboxConfig,
  });

  const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });

  // Handle server unreachable case
  let session: ApiSessionClient;
  let permissionHandler: OpenCodePermissionHandler | null = null;

  // Session swap synchronization: defer swaps while processing a message
  let isProcessingMessage = false;
  let pendingSessionSwap: ApiSessionClient | null = null;

  const applyPendingSessionSwap = () => {
    if (pendingSessionSwap) {
      logger.debug('[OpenCode] Applying pending session swap');
      session = pendingSessionSwap;
      if (permissionHandler) {
        permissionHandler.updateSession(pendingSessionSwap);
      }
      pendingSessionSwap = null;
    }
  };

  const { session: initialSession, reconnectionHandle } = setupOfflineReconnection({
    api,
    sessionTag,
    metadata,
    state,
    response,
    onSessionSwap: newSession => {
      if (isProcessingMessage) {
        // Defer swap until current message processing completes
        logger.debug('[OpenCode] Deferring session swap (message in progress)');
        pendingSessionSwap = newSession;
      } else {
        session = newSession;
        if (permissionHandler) {
          permissionHandler.updateSession(newSession);
        }
      }
    },
  });
  session = initialSession;

  // Report to daemon if it exists
  if (response) {
    logger.info('[CLI] Session started', {
      sessionId: response.id,
      machineId,
      flavor: 'opencode',
      directory: process.cwd(),
    });
    try {
      await notifyDaemonSessionStarted(response.id, metadata);
    } catch (error) {
      logger.debug('[START] Failed to report to daemon:', error);
    }
  }

  //
  // Message queue
  //

  type EnhancedMode = OpenCodeMode & { hash: string };
  const messageQueue = new MessageQueue2<EnhancedMode>(mode =>
    hashObject({
      permissionMode: mode.permissionMode,
    })
  );

  let currentPermissionMode: PermissionMode | undefined = undefined;

  session.onUserMessage(message => {
    let messagePermissionMode = currentPermissionMode;
    if (message.meta?.permissionMode) {
      messagePermissionMode = message.meta.permissionMode as PermissionMode;
      currentPermissionMode = messagePermissionMode;
    }

    const mode: EnhancedMode = {
      permissionMode: messagePermissionMode || 'accept-edits',
      hash: '',
    };
    mode.hash = hashObject({ permissionMode: mode.permissionMode });

    messageQueue.push(message.content.text, mode);
    logger.info('[CLI] Message received', {
      sessionId: session.sessionId,
      permissionMode: mode.permissionMode,
      flavor: 'opencode',
    });
  });

  let thinking = false;
  session.keepAlive(thinking, 'remote');

  const keepAliveInterval = setInterval(() => {
    session.keepAlive(thinking, 'remote');
  }, 2000);

  const sendReady = () => {
    session.sendSessionEvent({ type: 'ready' });
    try {
      api.push().sendToAllDevices("It's ready!", 'OpenCode is waiting for your command', {
        sessionId: session.sessionId,
      });
    } catch (pushError) {
      logger.debug('[OpenCode] Failed to send ready push', pushError);
    }
  };

  /** Emit ready if idle: no pending operations, no queue */
  const emitReadyIfIdle = () => {
    if (pendingExit) {
      logger.debug('[OpenCode] Conversation complete, exiting due to CLI update');
      handleKillSession();
      return;
    }
    if (messageQueue.size() === 0) {
      sendReady();
    }
  };

  //
  // Abort handling
  //

  let abortController = new AbortController();
  let shouldExit = false;
  let opencodeBackend: AgentBackend | null = null;
  let acpSessionId: string | null = null;
  let wasSessionCreated = false;

  async function handleAbort() {
    logger.debug('[OpenCode] Abort requested - stopping current task');

    session.sendAgentMessage('opencode', {
      type: 'turn_aborted',
      id: randomUUID(),
    });

    try {
      abortController.abort();
      messageQueue.reset();
      if (opencodeBackend && acpSessionId) {
        await opencodeBackend.cancel(acpSessionId);
      }
      logger.debug('[OpenCode] Abort completed - session remains active');
    } catch (error) {
      logger.debug('[OpenCode] Error during abort:', error);
    } finally {
      abortController = new AbortController();
    }
  }

  const handleKillSession = async () => {
    logger.debug('[OpenCode] Kill session requested - terminating process');
    await handleAbort();

    try {
      if (session) {
        // Save agent session ID for potential resume
        const agentSessionId = acpSessionId;
        session.updateMetadata(currentMetadata => ({
          ...currentMetadata,
          lifecycleState: 'archived',
          lifecycleStateSince: Date.now(),
          archivedBy: 'cli',
          archiveReason: 'User terminated',
          // Save agent session ID for resume support
          ...(agentSessionId ? { agentSessionId } : {}),
        }));

        session.sendSessionDeath();
        await session.flush();
        await session.close();
      }

      stopCaffeinate();
      freeServer.stop();

      if (opencodeBackend) {
        await opencodeBackend.dispose();
      }

      logger.debug('[OpenCode] Session termination complete, exiting');
      process.exit(0);
    } catch (error) {
      logger.debug('[OpenCode] Error during session termination:', error);
      process.exit(1);
    }
  };

  session.rpcHandlerManager.registerHandler('abort', handleAbort);
  registerKillSessionHandler(session.rpcHandlerManager, handleKillSession);

  // Handle termination signals for graceful exit (e.g., when CLI is updated)
  // Wait for current conversation to complete before exiting
  let pendingExit = false;
  process.on('SIGTERM', () => {
    logger.debug('[OpenCode] Received SIGTERM, waiting for conversation to complete...');
    pendingExit = true;
    // Don't exit immediately - wait for idle detection
  });

  // Initialize Ink UI
  //

  const messageBuffer = new MessageBuffer();
  const hasTTY = process.stdout.isTTY && process.stdin.isTTY;
  let inkInstance: ReturnType<typeof render> | null = null;

  if (hasTTY) {
    console.clear();
    inkInstance = render(
      React.createElement(OpenCodeDisplay, {
        messageBuffer,
        logPath: process.env.DEBUG ? (getCollector().getLogFilePath() ?? undefined) : undefined,
        onExit: async () => {
          logger.debug('[opencode]: Exiting agent via Ctrl-C');
          shouldExit = true;
          await handleAbort();
        },
      }),
      {
        exitOnCtrlC: false,
        patchConsole: false,
      }
    );
  }

  if (hasTTY) {
    process.stdin.resume();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding('utf8');
  }

  //
  // Start Free MCP server
  //

  const freeServer = await startFreeServer(session);
  logger.info('[CLI] MCP server started', { url: freeServer.url, flavor: 'opencode' });
  const mcpServers: Record<string, { command: string; args: string[] }> = {
    free: {
      command: join(projectPath(), 'bin', 'free-mcp.mjs'),
      args: ['--url', freeServer.url],
    },
  };

  //
  // Permission handler
  //

  permissionHandler = new OpenCodePermissionHandler(session);

  //
  // Create OpenCode backend using packages/core factory
  //

  opencodeBackend = createOpenCodeBackend({
    cwd: process.cwd(),
    env: {},
    mcpServers,
    permissionHandler: {
      handleToolCall: async (callId: string, toolName: string, input: unknown) => {
        return permissionHandler!.handleToolCall(callId, toolName, input);
      },
    },
  });

  //
  // Message handler setup
  //

  let currentResponseMessageId: string | null = null;
  let currentResponseText = '';
  let taskStartedSent = false;

  const setupOpenCodeMessageHandler = () => {
    opencodeBackend!.onMessage((msg: AgentMessage) => {
      logger.debug(`[OpenCode] Agent message: ${JSON.stringify(msg)}`);

      switch (msg.type) {
        case 'model-output':
          // Handle streaming text
          if (msg.textDelta) {
            // Send streaming delta to session
            if (serverCapabilities.supportsTextDelta() && currentResponseMessageId) {
              session.sendStreamingTextDelta(currentResponseMessageId, msg.textDelta);
            }
            currentResponseText += msg.textDelta;

            // Update UI
            if (hasTTY) {
              messageBuffer.updateLastMessage(currentResponseText, 'assistant');
            }
          } else if (msg.fullText) {
            currentResponseText = msg.fullText;
            if (hasTTY) {
              messageBuffer.addMessage(msg.fullText, 'assistant');
            }
          }
          break;

        case 'status':
          if (msg.status === 'starting') {
            logger.debug('[OpenCode] Agent starting...');
          } else if (msg.status === 'running') {
            thinking = true;
            session.keepAlive(thinking, 'remote');

            // Send task_started event ONCE per turn
            // OpenCode may go running -> idle -> running multiple times during a turn
            if (!taskStartedSent) {
              session.sendAgentMessage('opencode', {
                type: 'task_started',
                id: randomUUID(),
              });
              taskStartedSent = true;
            }
          } else if (msg.status === 'idle' || msg.status === 'stopped') {
            // DON'T change thinking state here - OpenCode (like Gemini) may make pauses
            // between chunks which causes multiple idle events. thinking will be set to
            // false ONCE in the finally block when the turn is complete.
            // This prevents UI status flickering between "working" and "online"

            // NOTE: Don't send sendStreamingTextComplete here — OpenCode goes idle
            // multiple times during tool-call turns (running→idle→running→idle), so
            // calling it here would push PARTIAL text as "complete" on every pause.
            // sendStreamingTextComplete is called ONCE in the finally block below,
            // after waitForResponseComplete confirms the turn is truly done.

            // NOTE: Don't clear currentResponseMessageId/currentResponseText here.
            // The finally block handles cleanup after waitForResponseComplete resolves.
          } else if (msg.status === 'error') {
            logger.debug('[OpenCode] Agent error:', msg.detail);
            messageBuffer.addMessage(`Error: ${msg.detail}`, 'system');
            thinking = false;
            session.keepAlive(thinking, 'remote');
            // Clear streaming state on error
            currentResponseMessageId = null;
            currentResponseText = '';
          }
          break;

        case 'tool-call':
          messageBuffer.addMessage(`Tool: ${msg.toolName}`, 'tool');
          session.sendAgentMessage('opencode', {
            type: 'tool-call',
            callId: msg.callId,
            name: msg.toolName,
            input: msg.args,
            id: msg.callId,
          });
          break;

        case 'tool-result':
          messageBuffer.addMessage(
            `Tool result: ${JSON.stringify(msg.result).substring(0, 100)}...`,
            'result'
          );
          session.sendAgentMessage('opencode', {
            type: 'tool-result',
            callId: msg.callId,
            output: msg.result,
            id: msg.callId,
          });
          break;

        case 'permission-request':
          // Forward to permission handler
          logger.debug(`[OpenCode] Permission request: ${msg.id}`);
          break;

        case 'token-count':
          const { type: _type, ...restMsg } = msg;
          session.sendAgentMessage('opencode', {
            type: 'token_count',
            ...restMsg,
          });
          break;
      }
    });
  };

  setupOpenCodeMessageHandler();

  //
  // Main processing loop
  //

  let isFirstMessage = true;

  try {
    while (!shouldExit) {
      // If pending exit (CLI updated), don't consume new messages
      // Wait for current turn to complete, then exit
      if (pendingExit) {
        logger.debug(
          '[OpenCode] Pending exit (CLI updated), not consuming new messages, waiting for idle...'
        );
        // Wait for idle state, then exit will be triggered
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      const signal = abortController.signal;
      const batch = await messageQueue.waitForMessagesAndGetAsString(signal);

      if (!batch) {
        if (signal.aborted && !shouldExit) {
          continue;
        }
        break;
      }

      const { message: userMessage, mode } = batch;

      // Build prompt
      let fullPrompt = userMessage;
      if (isFirstMessage) {
        fullPrompt = userMessage + '\n\n' + CHANGE_TITLE_INSTRUCTION;
        isFirstMessage = false;
      }

      // Display user message in UI
      messageBuffer.addMessage(userMessage, 'user');

      // Mark as processing to defer session swaps
      isProcessingMessage = true;

      try {
        // Create new response message ID for streaming
        currentResponseMessageId = randomUUID();
        currentResponseText = '';
        taskStartedSent = false;

        // Retry logic for transient errors (empty response, internal errors)
        let lastError: unknown = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (!wasSessionCreated) {
              // Check if we should resume an existing session
              if (opts.resumeSessionId && opencodeBackend!.supportsLoadSession?.()) {
                logger.debug('[OpenCode] Resuming ACP session:', opts.resumeSessionId);
                const mcpServersArray = Object.entries(mcpServers).map(([name, config]) => ({
                  name,
                  command: config.command,
                  args: config.args || [],
                }));
                const { sessionId: resumedSessionId } = await opencodeBackend!.loadSession!(
                  opts.resumeSessionId,
                  process.cwd(),
                  mcpServersArray
                );
                if (!resumedSessionId) {
                  throw new Error('Failed to resume session: invalid session ID returned');
                }
                acpSessionId = resumedSessionId;
                logger.debug(`[OpenCode] ACP session resumed: ${acpSessionId}`);
                // Clear resumeSessionId so we don't try to resume again
                opts.resumeSessionId = undefined;
                // Now send the prompt
                await opencodeBackend!.sendPrompt(acpSessionId, fullPrompt);
              } else {
                // Start new session
                const { sessionId: newSessionId } = await opencodeBackend!.startSession(fullPrompt);
                acpSessionId = newSessionId;
                logger.debug(`[OpenCode] ACP session started: ${acpSessionId}`);
              }
              wasSessionCreated = true;
            } else {
              // Continue existing session
              if (!acpSessionId) {
                throw new Error('Session not initialized: acpSessionId is null');
              }
              await opencodeBackend!.sendPrompt(acpSessionId, fullPrompt);
            }

            logger.debug('[OpenCode] Prompt sent successfully');

            // Wait for OpenCode to finish responding (all chunks received + final idle)
            // This ensures we don't clear streaming state until response is truly done
            await opencodeBackend!.waitForResponseComplete?.(120000);
            logger.debug('[OpenCode] Response complete');

            break; // Success, exit retry loop
          } catch (promptError) {
            lastError = promptError;
            const errObj = promptError as Record<string, unknown>;
            const errorDetails = String(
              (errObj?.data as Record<string, unknown>)?.details ||
                errObj?.details ||
                errObj?.message ||
                ''
            );
            const errorCode = errObj?.code;

            // Check for quota exhausted - NOT retryable
            const isQuotaError =
              errorDetails.includes('exhausted') ||
              errorDetails.includes('quota') ||
              errorDetails.includes('capacity');
            if (isQuotaError) {
              const quotaMsg = `OpenCode quota exceeded. Try using a different model or wait for quota reset.`;
              messageBuffer.addMessage(quotaMsg, 'status');
              session.sendAgentMessage('opencode', { type: 'message', message: quotaMsg });
              throw promptError; // Don't retry quota errors
            }

            // Check if this is a retryable error (empty response, internal error)
            const isEmptyResponseError =
              errorDetails.includes('empty response') ||
              errorDetails.includes('Model stream ended');
            const isInternalError = errorCode === -32603;
            const isRetryable = isEmptyResponseError || isInternalError;

            if (isRetryable && attempt < MAX_RETRIES) {
              logger.debug(
                `[OpenCode] Retryable error on attempt ${attempt}/${MAX_RETRIES}: ${errorDetails}`
              );
              messageBuffer.addMessage(
                `OpenCode returned empty response, retrying (${attempt}/${MAX_RETRIES})...`,
                'status'
              );
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
              continue;
            }

            // Not retryable or max retries reached
            throw promptError;
          }
        }

        if (lastError && MAX_RETRIES > 1) {
          logger.debug('[OpenCode] Prompt succeeded after retries');
        }
      } catch (error) {
        logger.warn('[OpenCode] Error in session:', error);

        const isAbortError = error instanceof Error && error.name === 'AbortError';
        if (isAbortError) {
          messageBuffer.addMessage('Aborted by user', 'status');
          session.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
        } else {
          // Parse error message for better UX
          let errorMsg = 'Process exited unexpectedly';

          if (typeof error === 'object' && error !== null) {
            const errObj = error as Record<string, unknown>;
            const errorMessage = String(errObj.message || '');
            if (errorMessage) {
              errorMsg = errorMessage;
            }
          } else if (error instanceof Error) {
            errorMsg = error.message;
          }

          messageBuffer.addMessage(errorMsg, 'status');
          session.sendAgentMessage('opencode', {
            type: 'message',
            message: errorMsg,
          });
        }
      } finally {
        // Turn is complete (waitForResponseComplete resolved or error occurred)
        // Now safe to clean up streaming state

        // Send accumulated response to mobile app ONLY when turn is complete.
        // This prevents message fragmentation from OpenCode's chunked responses.
        if (currentResponseText.trim()) {
          logger.debug(
            `[OpenCode] Sending complete message to mobile (length: ${currentResponseText.length}): ${currentResponseText.substring(0, 100)}...`
          );
          session.sendAgentMessage('opencode', {
            type: 'message',
            message: currentResponseText,
          });

          // Send streaming text complete ONCE here (not at every status:idle).
          // Sent unconditionally (not gated on supportsTextDelta) so the App always
          // receives the final text via the ephemeral channel regardless of whether
          // real-time delta streaming was active. Without this, a capabilities
          // detection failure (null capabilities → supportsTextDelta()=false) would
          // leave useStreamingText with no text and the UI showing a blank message.
          if (currentResponseMessageId) {
            session.sendStreamingTextComplete(currentResponseMessageId, currentResponseText);
          }
        }

        // Send task_complete to signal end of turn to the mobile app
        session.sendAgentMessage('opencode', {
          type: 'task_complete',
          id: randomUUID(),
        });

        // Reset turn tracking flags
        taskStartedSent = false;

        thinking = false;
        session.keepAlive(thinking, 'remote');
        currentResponseMessageId = null;
        currentResponseText = '';

        // Message processing complete - safe to apply any pending session swap
        isProcessingMessage = false;
        applyPendingSessionSwap();

        // Emit ready if idle
        emitReadyIfIdle();
      }
    }
  } finally {
    // Cleanup
    logger.debug('[opencode]: Final cleanup start');

    if (reconnectionHandle) {
      reconnectionHandle.cancel();
    }

    try {
      session.sendSessionDeath();
      await session.flush();
      await session.close();
      logger.info('[CLI] Session closed', { sessionId: session.sessionId, flavor: 'opencode' });
    } catch (e) {
      logger.error('[CLI] Session close failed', undefined, { error: String(e) });
    }

    if (opencodeBackend) {
      await opencodeBackend.dispose();
    }

    freeServer.stop();

    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {}
    }
    if (hasTTY) {
      try {
        process.stdin.pause();
      } catch {}
    }

    clearInterval(keepAliveInterval);

    if (inkInstance) {
      inkInstance.unmount();
    }
    messageBuffer.clear();

    logger.debug('[opencode]: Final cleanup completed');
  }
}

/**
 * Simple permission handler for OpenCode
 */
class OpenCodePermissionHandler {
  private session: ApiSessionClient;

  constructor(session: ApiSessionClient) {
    this.session = session;
  }

  updateSession(session: ApiSessionClient) {
    this.session = session;
  }

  async handleToolCall(
    callId: string,
    toolName: string,
    input: unknown
  ): Promise<{ decision: 'approved' | 'denied' }> {
    // For now, auto-approve all tool calls
    // In the future, this could send permission requests to the mobile app
    logger.debug(`[OpenCode] Auto-approving tool call: ${toolName}`);
    return { decision: 'approved' };
  }
}
