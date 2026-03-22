import { join } from 'node:path';
import type { EnhancedMode, JsRuntime } from './sessionTypes';
import { PermissionResult } from './sdk/types';
import { claudeCheckSession } from './utils/claudeCheckSession';
import { getProjectPath } from './utils/path';
import { mapToClaudeMode } from './utils/permissionMode';
import { systemPrompt } from './utils/systemPrompt';
import {
  query,
  type QueryOptions,
  type SDKMessage,
  type SDKSystemMessage,
  type SDKAssistantMessage,
  AbortError,
  SDKUserMessage,
} from '@/claude/sdk';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { getProcessTraceContext } from '@/telemetry';
import { awaitFileExist } from '@/modules/watcher/awaitFileExist';
import { parseSpecialCommand } from '@/parsers/specialCommands';
import { PushableAsyncIterable } from '@/utils/PushableAsyncIterable';

const logger = new Logger('claude/claudeRemote');

function abortableWait(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) return reject(new AbortError('Aborted'));
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new AbortError('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function claudeRemote(opts: {
  // Fixed parameters
  sessionId: string | null;
  path: string;
  mcpServers?: Record<string, any>;
  claudeEnvVars?: Record<string, string>;
  claudeArgs?: string[];
  allowedTools: string[];
  signal?: AbortSignal;
  canCallTool: (
    toolName: string,
    input: unknown,
    mode: EnhancedMode,
    options: { signal: AbortSignal }
  ) => Promise<PermissionResult>;
  /** Path to temporary settings file with SessionStart hook (required for session tracking) */
  hookSettingsPath: string;
  /** JavaScript runtime to use for spawning Claude Code (default: 'node') */
  jsRuntime?: JsRuntime;

  // Dynamic parameters
  nextMessage: () => Promise<{ message: string; mode: EnhancedMode } | null>;
  onReady: () => void;
  isAborted: (toolCallId: string) => boolean;

  // Callbacks
  onSessionFound: (id: string) => void;
  onThinkingChange?: (thinking: boolean) => void;
  onMessage: (message: SDKMessage) => void;
  onCompletionEvent?: (message: string) => void;
  onSessionReset?: () => void;
}) {
  const remoteStart = Date.now();
  // Check if session is valid
  let startFrom = opts.sessionId;
  if (opts.sessionId && !claudeCheckSession(opts.sessionId, opts.path)) {
    startFrom = null;
  }

  // Extract --resume from claudeArgs if present (for first spawn)
  if (!startFrom && opts.claudeArgs) {
    for (let i = 0; i < opts.claudeArgs.length; i++) {
      if (opts.claudeArgs[i] === '--resume') {
        // Check if next arg exists and looks like a session ID
        if (i + 1 < opts.claudeArgs.length) {
          const nextArg = opts.claudeArgs[i + 1];
          // If next arg doesn't start with dash and contains dashes, it's likely a UUID
          if (!nextArg.startsWith('-') && nextArg.includes('-')) {
            startFrom = nextArg;
            logger.info('[claudeRemote] Found --resume with session ID', {
              sessionId: startFrom,
              path: opts.path,
              traceId: getProcessTraceContext()?.traceId,
            });
            break;
          } else {
            // Just --resume without UUID - SDK doesn't support this
            logger.debug(
              '[claudeRemote] Found --resume without session ID - not supported in remote mode',
              { path: opts.path, traceId: getProcessTraceContext()?.traceId }
            );
            break;
          }
        } else {
          // --resume at end of args - SDK doesn't support this
          logger.debug(
            '[claudeRemote] Found --resume without session ID - not supported in remote mode',
            { path: opts.path, traceId: getProcessTraceContext()?.traceId }
          );
          break;
        }
      }
    }
  }

  // Set environment variables for Claude Code SDK
  if (opts.claudeEnvVars) {
    Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
      process.env[key] = value;
    });
  }

  // Get initial message
  const initial = await opts.nextMessage();
  if (!initial) {
    logger.info('[claudeRemote] no initial message, exiting', {
      sessionId: opts.sessionId,
      path: opts.path,
    });
    return;
  }

  // Handle special commands
  const specialCommand = parseSpecialCommand(initial.message);

  // Handle /clear command
  if (specialCommand.type === 'clear') {
    if (opts.onCompletionEvent) {
      opts.onCompletionEvent('Context was reset');
    }
    if (opts.onSessionReset) {
      opts.onSessionReset();
    }
    return;
  }

  // Handle /compact command
  let isCompactCommand = false;
  if (specialCommand.type === 'compact') {
    logger.debug(
      '[claudeRemote] /compact command detected - will process as normal but with compaction behavior'
    );
    isCompactCommand = true;
    if (opts.onCompletionEvent) {
      opts.onCompletionEvent('Compaction started');
    }
  }

  // Prepare SDK options
  let mode = initial.mode;
  const sdkOptions: QueryOptions = {
    cwd: opts.path,
    resume: startFrom ?? undefined,
    mcpServers: opts.mcpServers,
    permissionMode: mapToClaudeMode(initial.mode.permissionMode),
    model: initial.mode.model,
    fallbackModel: initial.mode.fallbackModel,
    customSystemPrompt: initial.mode.customSystemPrompt
      ? initial.mode.customSystemPrompt + '\n\n' + systemPrompt
      : undefined,
    appendSystemPrompt: initial.mode.appendSystemPrompt
      ? initial.mode.appendSystemPrompt + '\n\n' + systemPrompt
      : systemPrompt,
    allowedTools: initial.mode.allowedTools
      ? initial.mode.allowedTools.concat(opts.allowedTools)
      : opts.allowedTools,
    disallowedTools: initial.mode.disallowedTools,
    canCallTool: (toolName: string, input: unknown, options: { signal: AbortSignal }) =>
      opts.canCallTool(toolName, input, mode, options),
    executable: opts.jsRuntime ?? 'node',
    abort: opts.signal,
    settingsPath: opts.hookSettingsPath,
  };

  // Track thinking state
  let thinking = false;
  const updateThinking = (newThinking: boolean) => {
    if (thinking !== newThinking) {
      thinking = newThinking;
      logger.info('[claudeRemote] Thinking state changed', { thinking, sessionId: opts.sessionId });
      if (opts.onThinkingChange) {
        opts.onThinkingChange(thinking);
      }
    }
  };

  // Push initial message
  const messages = new PushableAsyncIterable<SDKUserMessage>();
  messages.push({
    type: 'user',
    message: {
      role: 'user',
      content: initial.message,
    },
  });

  // Start the loop
  const response = query({
    prompt: messages,
    options: sdkOptions,
  });

  updateThinking(true);
  try {
    logger.info('[claudeRemote] Starting to iterate over response', {
      sessionId: opts.sessionId,
      path: opts.path,
      traceId: getProcessTraceContext()?.traceId,
    });

    for await (const message of response) {
      if (message.type === 'assistant') {
        const assistantMsg = message as SDKAssistantMessage;
        const blocks = assistantMsg.message.content;
        const toolCalls = blocks
          .filter(b => b.type === 'tool_use')
          .map(b => ({ name: b.name, id: b.id }));
        logger.info('[claudeRemote] assistant message', {
          sessionId: opts.sessionId,
          path: opts.path,
          traceId: getProcessTraceContext()?.traceId,
          blockTypes: blocks.map(b => b.type),
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        });
      } else if (message.type === 'user') {
        const userMsg = message as SDKUserMessage;
        const content = userMsg.message.content;
        if (Array.isArray(content)) {
          const results = content
            .filter(c => c.type === 'tool_result')
            .map(c => ({ tool_use_id: c.tool_use_id, is_error: c.is_error }));
          if (results.length > 0) {
            logger.info('[claudeRemote] tool results received', {
              sessionId: opts.sessionId,
              path: opts.path,
              traceId: getProcessTraceContext()?.traceId,
              results,
            });
          }
        }
      } else {
        logger.debug('[claudeRemote] message received', {
          type: message.type,
          sessionId: opts.sessionId,
          path: opts.path,
          traceId: getProcessTraceContext()?.traceId,
        });
      }

      // Handle messages
      opts.onMessage(message);

      // Handle special system messages
      if (message.type === 'system' && message.subtype === 'init') {
        // Start thinking when session initializes
        updateThinking(true);

        const systemInit = message as SDKSystemMessage;

        // Session id is still in memory, wait until session file is written to disk
        // Start a watcher for to detect the session id
        if (systemInit.session_id) {
          const waitStartedAt = Date.now();
          logger.debug('[claudeRemote] Waiting for session file to be written to disk', {
            sessionId: systemInit.session_id,
            path: opts.path,
            traceId: getProcessTraceContext()?.traceId,
          });
          const projectDir = getProjectPath(opts.path);
          // This wait must be abortable. Otherwise remote→local mode switching can hang
          // for up to the awaitFileExist timeout even after the user requests a switch.
          const found = await Promise.race([
            awaitFileExist(join(projectDir, `${systemInit.session_id}.jsonl`)),
            abortableWait(opts.signal),
          ]).catch(e => {
            if (e instanceof AbortError) return false;
            throw e;
          });
          logger.debug('[claudeRemote] Session file found', {
            sessionId: systemInit.session_id,
            path: opts.path,
            traceId: getProcessTraceContext()?.traceId,
            found,
            waitElapsed: Date.now() - waitStartedAt,
            remoteElapsed: Date.now() - remoteStart,
          });
          opts.onSessionFound(systemInit.session_id);
        }
      }

      // Handle result messages
      if (message.type === 'result') {
        updateThinking(false);
        logger.debug('[claudeRemote] Result received, exiting claudeRemote', {
          sessionId: opts.sessionId,
          path: opts.path,
          traceId: getProcessTraceContext()?.traceId,
        });

        // Send completion messages
        if (isCompactCommand) {
          logger.debug('[claudeRemote] Compaction completed');
          if (opts.onCompletionEvent) {
            opts.onCompletionEvent('Compaction completed');
          }
          isCompactCommand = false;
        }

        // Send ready event
        opts.onReady();

        // Push next message
        const next = await opts.nextMessage();
        if (!next) {
          messages.end();
          return;
        }
        mode = next.mode;
        messages.push({ type: 'user', message: { role: 'user', content: next.message } });
      }

      // Handle tool result
      if (message.type === 'user') {
        const msg = message as SDKUserMessage;
        if (msg.message.role === 'user' && Array.isArray(msg.message.content)) {
          for (const c of msg.message.content) {
            if (c.type === 'tool_result' && c.tool_use_id && opts.isAborted(c.tool_use_id)) {
              logger.debug('[claudeRemote] Tool aborted, exiting claudeRemote', {
                sessionId: opts.sessionId,
                path: opts.path,
                traceId: getProcessTraceContext()?.traceId,
                toolUseId: c.tool_use_id,
              });
              return;
            }
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof AbortError) {
      logger.info('[claudeRemote] Aborted', {
        sessionId: opts.sessionId,
        path: opts.path,
        traceId: getProcessTraceContext()?.traceId,
        remoteElapsed: Date.now() - remoteStart,
      });
      // Ignore
    } else {
      logger.error(
        '[claudeRemote] unexpected error, rethrowing',
        e instanceof Error ? e : undefined,
        {
          sessionId: opts.sessionId,
          path: opts.path,
          traceId: getProcessTraceContext()?.traceId,
          remoteElapsed: Date.now() - remoteStart,
          error: String(e),
        }
      );
      throw e;
    }
  } finally {
    updateThinking(false);
  }
}
