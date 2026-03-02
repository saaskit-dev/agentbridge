/**
 * AcpBackend - Agent Client Protocol backend using official SDK
 *
 * This module provides a universal backend implementation using the official
 * @agentclientprotocol/sdk. Agent-specific behavior (timeouts, filtering,
 * error handling) is delegated to TransportHandler implementations.
 *
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type {
  IAgentBackend,
  AgentMessage,
  AgentMessageHandler,
  SessionId,
  StartSessionResult,
} from '../../interfaces/agent';
import type { AcpAgentConfig, AcpPermissionHandler } from '../../types/agent';
import type {
  ITransportHandler,
  StderrContext,
  ToolNameContext,
} from '../../interfaces/transport';
import {
  type SessionUpdate,
  type HandlerContext,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  handleAgentMessageChunk,
  handleAgentThoughtChunk,
  handleToolCallUpdate,
  handleToolCall,
  handleLegacyMessageChunk,
  handlePlanUpdate,
  handleThinkingUpdate,
} from './sessionUpdateHandlers';

// Types from @agentclientprotocol/sdk (duplicated here to avoid import issues when SDK not installed)
interface SessionNotification {
  update?: unknown;
}

interface RequestPermissionRequest {
  [key: string]: unknown;
}

interface RequestPermissionResponse {
  outcome: { outcome: string; optionId: string };
}

interface InitializeRequest {
  protocolVersion: number;
  clientCapabilities: Record<string, unknown>;
  clientInfo: { name: string; version: string };
}

interface NewSessionRequest {
  cwd: string;
  mcpServers?: Array<{
    name: string;
    command: string;
    args?: string[];
    env?: Array<{ name: string; value: string }>;
  }>;
}

interface PromptRequest {
  sessionId: string;
  prompt: Array<{ type: string; text: string }>;
}

type ContentBlock = { type: string; text: string };

interface Client {
  sessionUpdate: (params: SessionNotification) => Promise<void>;
  requestPermission: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
}

// Optional ACP SDK imports - only available when @agentclientprotocol/sdk is installed
// We use dynamic imports to avoid build errors when SDK is not installed
type ClientSideConnectionType = {
  initialize(request: InitializeRequest): Promise<unknown>;
  newSession(request: NewSessionRequest): Promise<{ sessionId: string }>;
  prompt(request: PromptRequest): Promise<void>;
  cancel(request: { sessionId: string }): Promise<void>;
};

type NdJsonStreamType = (
  writable: WritableStream<Uint8Array>,
  readable: ReadableStream<Uint8Array>
) => unknown;

type ClientSideConnectionConstructor = new (
  clientFactory: () => Client,
  stream: unknown
) => ClientSideConnectionType;

let ClientSideConnectionClass: ClientSideConnectionConstructor | undefined;

let ndJsonStreamFunc: NdJsonStreamType | undefined;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require('@agentclientprotocol/sdk');
  ClientSideConnectionClass = sdk.ClientSideConnection;
  ndJsonStreamFunc = sdk.ndJsonStream;
} catch {
  // SDK not installed - will throw at runtime if used
}

/**
 * Retry configuration for ACP operations
 */
const RETRY_CONFIG = {
  /** Maximum number of retry attempts for init/newSession */
  maxAttempts: 3,
  /** Base delay between retries in ms */
  baseDelayMs: 1000,
  /** Maximum delay between retries in ms */
  maxDelayMs: 5000,
} as const;

/**
 * Default transport handler for agents without specific implementations
 */
class DefaultTransport implements ITransportHandler {
  readonly agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  getInitTimeout(): number {
    return 30000; // 30 seconds default
  }

  getIdleTimeout(): number {
    return DEFAULT_IDLE_TIMEOUT_MS;
  }

  getToolCallTimeout(_toolCallId: string, _toolKind?: string): number {
    return DEFAULT_TOOL_CALL_TIMEOUT_MS;
  }

  getToolPatterns(): Array<{ name: string; patterns: string[] }> {
    return [];
  }
}

/**
 * Extended RequestPermissionRequest with additional fields that may be present
 */
type ExtendedRequestPermissionRequest = RequestPermissionRequest & {
  toolCall?: {
    id?: string;
    kind?: string;
    toolName?: string;
    input?: Record<string, unknown>;
    arguments?: Record<string, unknown>;
    content?: Record<string, unknown>;
  };
  kind?: string;
  input?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  content?: Record<string, unknown>;
  options?: Array<{
    optionId?: string;
    name?: string;
    kind?: string;
  }>;
};

/**
 * Extended SessionNotification with additional fields
 */
type ExtendedSessionNotification = SessionNotification & {
  update?: {
    sessionUpdate?: string;
    toolCallId?: string;
    status?: string;
    kind?: string | unknown;
    content?: {
      text?: string;
      error?: string | { message?: string };
      [key: string]: unknown;
    } | string | unknown;
    locations?: unknown[];
    messageChunk?: {
      textDelta?: string;
    };
    plan?: unknown;
    thinking?: unknown;
    [key: string]: unknown;
  };
};

/**
 * Simple logger interface (can be replaced with actual logger)
 */
interface Logger {
  debug(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
}

const logger: Logger = {
  debug(_message: string, ..._args: unknown[]): void {
    // No-op by default, can be overridden
  },
  warn(_message: string, ..._args: unknown[]): void {
    // No-op by default, can be overridden
  },
};

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper to run an async operation with retry logic
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    operationName: string;
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    onRetry?: (attempt: number, error: Error) => void;
  }
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < options.maxAttempts) {
        // Calculate delay with exponential backoff
        const delayMs = Math.min(
          options.baseDelayMs * Math.pow(2, attempt - 1),
          options.maxDelayMs
        );

        logger.debug(`${options.operationName} failed (attempt ${attempt}/${options.maxAttempts}): ${lastError.message}. Retrying in ${delayMs}ms...`);
        options.onRetry?.(attempt, lastError);

        await delay(delayMs);
      }
    }
  }

  throw lastError;
}

/**
 * Convert Node.js streams to Web Streams for ACP SDK
 */
function nodeToWebStreams(
  stdin: Writable,
  stdout: Readable
): { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> } {
  // Convert Node writable to Web WritableStream
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise((resolve, reject) => {
        const ok = stdin.write(chunk, (err) => {
          if (err) {
            logger.debug(`[AcpBackend] Error writing to stdin:`, err);
            reject(err);
          }
        });
        if (ok) {
          resolve();
        } else {
          stdin.once('drain', resolve);
        }
      });
    },
    close() {
      return new Promise((resolve) => {
        stdin.end(resolve);
      });
    },
    abort(reason) {
      stdin.destroy(reason instanceof Error ? reason : new Error(String(reason)));
    }
  });

  // Convert Node readable to Web ReadableStream
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      stdout.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      stdout.on('end', () => {
        controller.close();
      });
      stdout.on('error', (err) => {
        logger.debug(`[AcpBackend] Stdout error:`, err);
        controller.error(err);
      });
    },
    cancel() {
      stdout.destroy();
    }
  });

  return { writable, readable };
}

/**
 * ACP backend using the official @agentclientprotocol/sdk
 */
export class AcpBackend implements IAgentBackend {
  private listeners: AgentMessageHandler[] = [];
  private process: ChildProcess | null = null;
  private connection: ClientSideConnectionType | null = null;
  private acpSessionId: string | null = null;
  private agentCapabilities: { loadSession?: boolean } | null = null;
  private disposed = false;

  /** Track active tool calls to prevent duplicate events */
  private activeToolCalls = new Set<string>();
  private toolCallTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  /** Track tool call start times for performance monitoring */
  private toolCallStartTimes = new Map<string, number>();

  /** Pending permission requests that need response */
  private pendingPermissions = new Map<string, (response: RequestPermissionResponse) => void>();

  /** Map from permission request ID to real tool call ID for tracking (reserved for future use) */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private permissionToToolCallMap = new Map<string, string>();

  /** Map from real tool call ID to tool name for auto-approval */
  private toolCallIdToNameMap = new Map<string, string>();

  /** Track if we just sent a prompt with change_title instruction */
  private recentPromptHadChangeTitle = false;

  /** Track tool calls count since last prompt (to identify first tool call) */
  private toolCallCountSincePrompt = 0;

  /** Timeout for emitting 'idle' status after last message chunk */
  private idleTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Transport handler for agent-specific behavior */
  private readonly transport: ITransportHandler;

  /** Permission handler for tool approval */
  private readonly permissionHandler?: AcpPermissionHandler;

  /** Callback to check if prompt has change_title instruction */
  private readonly hasChangeTitleInstruction?: (prompt: string) => boolean;

  constructor(private config: AcpAgentConfig) {
    this.transport = config.transportHandler ?? new DefaultTransport(config.agentName);
    this.permissionHandler = config.permissionHandler;
    this.hasChangeTitleInstruction = config.hasChangeTitleInstruction;
  }

  onMessage(handler: AgentMessageHandler): void {
    this.listeners.push(handler);
  }

  offMessage(handler: AgentMessageHandler): void {
    const index = this.listeners.indexOf(handler);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  private emit(msg: AgentMessage): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try {
        listener(msg);
      } catch (error) {
        logger.warn('[AcpBackend] Error in message handler:', error);
      }
    }
  }

  async startSession(initialPrompt?: string): Promise<StartSessionResult> {
    if (this.disposed) {
      throw new Error('Backend has been disposed');
    }

    if (!ClientSideConnectionClass || !ndJsonStreamFunc) {
      throw new Error('@agentclientprotocol/sdk is not installed. Please install it to use AcpBackend.');
    }

    const sessionId = randomUUID();
    this.emit({ type: 'status', status: 'starting' });

    try {
      logger.debug(`[AcpBackend] Starting session: ${sessionId}`);

      // Spawn the ACP agent process
      const args = this.config.args || [];

      // On Windows, spawn via cmd.exe to handle .cmd files and PATH resolution
      if (process.platform === 'win32') {
        const fullCommand = [this.config.command, ...args].join(' ');
        this.process = spawn('cmd.exe', ['/c', fullCommand], {
          cwd: this.config.cwd,
          env: { ...process.env, ...this.config.env },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } else {
        this.process = spawn(this.config.command, args, {
          cwd: this.config.cwd,
          env: { ...process.env, ...this.config.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }

      if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
        throw new Error('Failed to create stdio pipes');
      }

      // Handle stderr output via transport handler
      this.process.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        if (!text.trim()) return;

        // Build context for transport handler
        const hasActiveInvestigation = this.transport.isInvestigationTool
          ? Array.from(this.activeToolCalls).some(id => this.transport.isInvestigationTool!(id))
          : false;

        const context: StderrContext = {
          activeToolCalls: this.activeToolCalls,
          hasActiveInvestigation,
        };

        logger.debug(`[AcpBackend] Agent stderr: ${text.trim()}`);

        // Let transport handler process stderr and optionally emit messages
        if (this.transport.handleStderr) {
          const result = this.transport.handleStderr(text, context);
          if (result.message) {
            this.emit(result.message);
          }
        }
      });

      this.process.on('error', (err) => {
        logger.debug(`[AcpBackend] Process error:`, err);
        this.emit({ type: 'status', status: 'error', detail: err.message });
      });

      this.process.on('exit', (code, signal) => {
        if (!this.disposed && code !== 0 && code !== null) {
          logger.debug(`[AcpBackend] Process exited with code ${code}, signal ${signal}`);
          this.emit({ type: 'status', status: 'stopped', detail: `Exit code: ${code}` });
        }
      });

      // Create Web Streams from Node streams
      const streams = nodeToWebStreams(
        this.process.stdin,
        this.process.stdout
      );
      const writable = streams.writable;
      const readable = streams.readable;

      // Filter stdout via transport handler before ACP parsing
      const transport = this.transport;
      const filteredReadable = new ReadableStream<Uint8Array>({
        async start(controller) {
          const reader = readable.getReader();
          const decoder = new TextDecoder();
          const encoder = new TextEncoder();
          let buffer = '';
          let filteredCount = 0;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                // Flush any remaining buffer
                if (buffer.trim()) {
                  const filtered = transport.filterStdoutLine?.(buffer);
                  if (filtered === undefined) {
                    controller.enqueue(encoder.encode(buffer));
                  } else if (filtered !== null) {
                    controller.enqueue(encoder.encode(filtered));
                  } else {
                    filteredCount++;
                  }
                }
                if (filteredCount > 0) {
                  logger.debug(`[AcpBackend] Filtered out ${filteredCount} non-JSON lines from ${transport.agentName} stdout`);
                }
                controller.close();
                break;
              }

              // Decode and accumulate data
              buffer += decoder.decode(value, { stream: true });

              // Process line by line (ndJSON is line-delimited)
              const lines = buffer.split('\n');
              buffer = lines.pop() || ''; // Keep last incomplete line in buffer

              for (const line of lines) {
                if (!line.trim()) continue;

                // Use transport handler to filter lines
                const filtered = transport.filterStdoutLine?.(line);
                if (filtered === undefined) {
                  // Method not implemented, pass through
                  controller.enqueue(encoder.encode(line + '\n'));
                } else if (filtered !== null) {
                  // Method returned transformed line
                  controller.enqueue(encoder.encode(filtered + '\n'));
                } else {
                  // Method returned null, filter out
                  filteredCount++;
                }
              }
            }
          } catch (error) {
            logger.debug(`[AcpBackend] Error filtering stdout stream:`, error);
            controller.error(error);
          } finally {
            reader.releaseLock();
          }
        }
      });

      // Create ndJSON stream for ACP
      const stream = ndJsonStreamFunc(writable, filteredReadable);

      // Create Client implementation
      const client: Client = {
        sessionUpdate: async (params: SessionNotification) => {
          this.handleSessionUpdate(params);
        },
        requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
          const extendedParams = params as ExtendedRequestPermissionRequest;
          const toolCall = extendedParams.toolCall;
          let toolName = toolCall?.kind || toolCall?.toolName || extendedParams.kind || 'Unknown tool';
          // Use toolCallId as the single source of truth for permission ID
          const toolCallId = toolCall?.id || randomUUID();
          const permissionId = toolCallId; // Use same ID for consistency!

          // Extract input/arguments from various possible locations
          let input: Record<string, unknown> = {};
          if (toolCall) {
            input = toolCall.input || toolCall.arguments || toolCall.content || {};
          } else {
            input = extendedParams.input || extendedParams.arguments || extendedParams.content || {};
          }

          // If toolName is "other" or "Unknown tool", try to determine real tool name
          const context: ToolNameContext = {
            recentPromptHadChangeTitle: this.recentPromptHadChangeTitle,
            toolCallCountSincePrompt: this.toolCallCountSincePrompt,
          };
          toolName = this.transport.determineToolName?.(toolName, toolCallId, input, context) ?? toolName;

          // Increment tool call counter
          this.toolCallCountSincePrompt++;

          const options = extendedParams.options || [];

          logger.debug(`[AcpBackend] Permission request: tool=${toolName}, toolCallId=${toolCallId}`);

          // Emit permission request event for UI/mobile handling
          this.emit({
            type: 'permission-request',
            id: permissionId,
            reason: toolName,
            payload: {
              ...params,
              permissionId,
              toolCallId,
              toolName,
              input,
              options: options.map((opt: { optionId?: string; name?: string; kind?: string }) => ({
                id: opt.optionId,
                name: opt.name,
                kind: opt.kind,
              })),
            },
          });

          // Use permission handler if provided, otherwise auto-approve
          if (this.permissionHandler) {
            try {
              const result = await this.permissionHandler.handleToolCall(
                toolCallId,
                toolName,
                input
              );

              // Map permission decision to ACP response
              let optionId = 'cancel'; // Default to cancel/deny

              if (result.decision === 'approved' || result.decision === 'approved_for_session') {
                const proceedOnceOption = options.find((opt: { optionId?: string; name?: string }) =>
                  opt.optionId === 'proceed_once' || (typeof opt.name === 'string' && opt.name.toLowerCase().includes('once'))
                );
                const proceedAlwaysOption = options.find((opt: { optionId?: string; name?: string }) =>
                  opt.optionId === 'proceed_always' || (typeof opt.name === 'string' && opt.name.toLowerCase().includes('always'))
                );

                if (result.decision === 'approved_for_session' && proceedAlwaysOption) {
                  optionId = proceedAlwaysOption.optionId || 'proceed_always';
                } else if (proceedOnceOption) {
                  optionId = proceedOnceOption.optionId || 'proceed_once';
                } else if (options.length > 0) {
                  const firstOpt = options[0] as { optionId?: string };
                  optionId = firstOpt.optionId || 'proceed_once';
                }

                // Emit tool-result so UI can close the timer
                this.emit({
                  type: 'tool-result',
                  toolName,
                  result: { status: 'approved', decision: result.decision },
                  callId: permissionId,
                });
              } else {
                const cancelOption = options.find((opt: { optionId?: string; name?: string }) =>
                  opt.optionId === 'cancel' || (typeof opt.name === 'string' && opt.name.toLowerCase().includes('cancel'))
                );
                if (cancelOption) {
                  optionId = cancelOption.optionId || 'cancel';
                }

                this.emit({
                  type: 'tool-result',
                  toolName,
                  result: { status: 'denied', decision: result.decision },
                  callId: permissionId,
                });
              }

              return { outcome: { outcome: 'selected', optionId } };
            } catch (error) {
              logger.debug('[AcpBackend] Error in permission handler:', error);
              return { outcome: { outcome: 'selected', optionId: 'cancel' } };
            }
          }

          // Auto-approve with 'proceed_once' if no permission handler
          const proceedOnceOption = options.find((opt: { optionId?: string; name?: string }) =>
            opt.optionId === 'proceed_once' || (typeof opt.name === 'string' && opt.name.toLowerCase().includes('once'))
          );
          const firstOpt = options[0] as { optionId?: string } | undefined;
          const defaultOptionId = proceedOnceOption?.optionId || (options.length > 0 && firstOpt?.optionId ? firstOpt.optionId : 'proceed_once');
          return { outcome: { outcome: 'selected', optionId: defaultOptionId } };
        },
      };

      // Create ClientSideConnection (we already checked ClientSideConnectionClass is defined above)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.connection = new ClientSideConnectionClass!(
        () => client,
        stream
      );

      // Initialize the connection with timeout and retry
      const initRequest: InitializeRequest = {
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            readTextFile: false,
            writeTextFile: false,
          },
        },
        clientInfo: {
          name: 'agentbridge',
          version: '1.0.0',
        },
      };

      const initTimeout = this.transport.getInitTimeout();
      logger.debug(`[AcpBackend] Initializing connection (timeout: ${initTimeout}ms)...`);

      // Initialize the connection with timeout and retry
      const initResult = await withRetry(
        async () => {
          let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
          try {
            const result = await Promise.race([
              this.connection!.initialize(initRequest).then((res: unknown) => {
                if (timeoutHandle) {
                  clearTimeout(timeoutHandle);
                  timeoutHandle = null;
                }
                return res;
              }),
              new Promise<never>((_, reject) => {
                timeoutHandle = setTimeout(() => {
                  reject(new Error(`Initialize timeout after ${initTimeout}ms - ${this.transport.agentName} did not respond`));
                }, initTimeout);
              }),
            ]);
            return result;
          } finally {
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }
          }
        },
        {
          operationName: 'Initialize',
          maxAttempts: RETRY_CONFIG.maxAttempts,
          baseDelayMs: RETRY_CONFIG.baseDelayMs,
          maxDelayMs: RETRY_CONFIG.maxDelayMs,
        }
      );

      // Save agent capabilities for later use (e.g., loadSession)
      if (initResult && typeof initResult === 'object') {
        const result = initResult as { agentCapabilities?: { loadSession?: boolean } };
        this.agentCapabilities = result.agentCapabilities || null;
        logger.debug(`[AcpBackend] Agent capabilities:`, this.agentCapabilities);
      }

      logger.debug(`[AcpBackend] Initialize completed`);

      // Create a new session with retry
      const mcpServers = this.config.mcpServers
        ? Object.entries(this.config.mcpServers).map(([name, config]) => ({
            name,
            command: config.command,
            args: config.args || [],
            env: config.env
              ? Object.entries(config.env).map(([envName, envValue]) => ({ name: envName, value: envValue }))
              : [],
          }))
        : [];

      const newSessionRequest: NewSessionRequest = {
        cwd: this.config.cwd,
        mcpServers: mcpServers as unknown as NewSessionRequest['mcpServers'],
      };

      logger.debug(`[AcpBackend] Creating new session...`);

      const sessionResponse = await withRetry(
        async () => {
          let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
          try {
            const result = await Promise.race([
              this.connection!.newSession(newSessionRequest).then((res: { sessionId: string }) => {
                if (timeoutHandle) {
                  clearTimeout(timeoutHandle);
                  timeoutHandle = null;
                }
                return res;
              }),
              new Promise<never>((_, reject) => {
                timeoutHandle = setTimeout(() => {
                  reject(new Error(`New session timeout after ${initTimeout}ms - ${this.transport.agentName} did not respond`));
                }, initTimeout);
              }),
            ]);
            return result;
          } finally {
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }
          }
        },
        {
          operationName: 'NewSession',
          maxAttempts: RETRY_CONFIG.maxAttempts,
          baseDelayMs: RETRY_CONFIG.baseDelayMs,
          maxDelayMs: RETRY_CONFIG.maxDelayMs,
        }
      );
      this.acpSessionId = sessionResponse.sessionId;
      logger.debug(`[AcpBackend] Session created: ${this.acpSessionId}`);

      this.emitIdleStatus();

      // Send initial prompt if provided
      if (initialPrompt) {
        this.sendPrompt(sessionId, initialPrompt).catch((error) => {
          logger.debug('[AcpBackend] Error sending initial prompt:', error);
          this.emit({ type: 'status', status: 'error', detail: String(error) });
        });
      }

      return { sessionId };

    } catch (error) {
      logger.debug('[AcpBackend] Error starting session:', error);
      this.emit({
        type: 'status',
        status: 'error',
        detail: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Check if the agent supports session loading (resume)
   * @returns true if loadSession capability is supported
   */
  supportsLoadSession(): boolean {
    return this.agentCapabilities?.loadSession === true;
  }

  /**
   * Load an existing session to resume a previous conversation.
   * This is only available if the agent supports the loadSession capability.
   * @param sessionId - The session ID to load
   * @param cwd - Working directory
   * @param mcpServers - MCP servers to connect
   */
  async loadSession(
    sessionId: string,
    cwd: string,
    mcpServers?: Array<{
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }>
  ): Promise<{ sessionId: string }> {
    if (this.disposed) {
      throw new Error('Backend has been disposed');
    }

    if (!this.supportsLoadSession()) {
      throw new Error('Agent does not support loadSession capability');
    }

    if (!this.connection) {
      throw new Error('Connection not initialized');
    }

    logger.debug(`[AcpBackend] Loading session: ${sessionId}`);

    try {
      // Convert mcpServers to ACP format
      const acpMcpServers = mcpServers?.map(server => ({
        name: server.name,
        command: server.command,
        args: server.args || [],
        env: server.env
          ? Object.entries(server.env).map(([name, value]) => ({ name, value }))
          : [],
      })) || [];

      // Call session/load method
      const loadSessionRequest = {
        sessionId,
        cwd,
        mcpServers: acpMcpServers,
      };

      // The agent will replay history via session/update notifications
      await (this.connection as any).loadSession(loadSessionRequest);

      // Store the session ID
      this.acpSessionId = sessionId;

      logger.debug(`[AcpBackend] Session loaded: ${sessionId}`);

      return { sessionId };

    } catch (error) {
      logger.debug('[AcpBackend] Error loading session:', error);
      this.emit({
        type: 'status',
        status: 'error',
        detail: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Create handler context for session update processing
   */
  private createHandlerContext(): HandlerContext {
    return {
      transport: this.transport,
      activeToolCalls: this.activeToolCalls,
      toolCallStartTimes: this.toolCallStartTimes,
      toolCallTimeouts: this.toolCallTimeouts,
      toolCallIdToNameMap: this.toolCallIdToNameMap,
      idleTimeout: this.idleTimeout,
      toolCallCountSincePrompt: this.toolCallCountSincePrompt,
      emit: (msg) => this.emit(msg),
      emitIdleStatus: () => this.emitIdleStatus(),
      clearIdleTimeout: () => {
        if (this.idleTimeout) {
          clearTimeout(this.idleTimeout);
          this.idleTimeout = null;
        }
      },
      setIdleTimeout: (callback, ms) => {
        this.idleTimeout = setTimeout(() => {
          callback();
          this.idleTimeout = null;
        }, ms);
      },
    };
  }

  private handleSessionUpdate(params: SessionNotification): void {
    const notification = params as ExtendedSessionNotification;
    const update = notification.update;

    if (!update) {
      logger.debug('[AcpBackend] Received session update without update field:', params);
      return;
    }

    const sessionUpdateType = (update as { sessionUpdate?: string }).sessionUpdate;

    // Log session updates for debugging (but not every chunk to avoid log spam)
    if (sessionUpdateType !== 'agent_message_chunk') {
      logger.debug(`[AcpBackend] Received session update: ${sessionUpdateType}`, JSON.stringify({
        sessionUpdate: sessionUpdateType,
        toolCallId: (update as { toolCallId?: string }).toolCallId,
        status: (update as { status?: string }).status,
        kind: (update as { kind?: unknown }).kind,
        hasContent: !!(update as { content?: unknown }).content,
        hasLocations: !!(update as { locations?: unknown[] }).locations,
      }, null, 2));
    }

    const ctx = this.createHandlerContext();

    // Dispatch to appropriate handler based on update type
    if (sessionUpdateType === 'agent_message_chunk') {
      handleAgentMessageChunk(update as SessionUpdate, ctx);
      return;
    }

    if (sessionUpdateType === 'tool_call_update') {
      const result = handleToolCallUpdate(update as SessionUpdate, ctx);
      if (result.toolCallCountSincePrompt !== undefined) {
        this.toolCallCountSincePrompt = result.toolCallCountSincePrompt;
      }
      return;
    }

    if (sessionUpdateType === 'agent_thought_chunk') {
      handleAgentThoughtChunk(update as SessionUpdate, ctx);
      return;
    }

    if (sessionUpdateType === 'tool_call') {
      handleToolCall(update as SessionUpdate, ctx);
      return;
    }

    // Handle legacy and auxiliary update types
    handleLegacyMessageChunk(update as SessionUpdate, ctx);
    handlePlanUpdate(update as SessionUpdate, ctx);
    handleThinkingUpdate(update as SessionUpdate, ctx);

    // Log unhandled session update types for debugging
    const updateTypeStr = sessionUpdateType as string;
    const handledTypes = ['agent_message_chunk', 'tool_call_update', 'agent_thought_chunk', 'tool_call'];
    const extendedUpdate = update as { messageChunk?: unknown; plan?: unknown; thinking?: unknown };
    if (updateTypeStr &&
        !handledTypes.includes(updateTypeStr) &&
        !extendedUpdate.messageChunk &&
        !extendedUpdate.plan &&
        !extendedUpdate.thinking) {
      logger.debug(`[AcpBackend] Unhandled session update type: ${updateTypeStr}`, JSON.stringify(update, null, 2));
    }
  }

  // Promise resolver for waitForIdle - set when waiting for response to complete
  private idleResolver: (() => void) | null = null;
  private waitingForResponse = false;

  async sendPrompt(_sessionId: SessionId, prompt: string): Promise<void> {
    // Check if prompt contains change_title instruction (via optional callback)
    const promptHasChangeTitle = this.hasChangeTitleInstruction?.(prompt) ?? false;

    // Reset tool call counter and set flag
    this.toolCallCountSincePrompt = 0;
    this.recentPromptHadChangeTitle = promptHasChangeTitle;

    if (promptHasChangeTitle) {
      logger.debug('[AcpBackend] Prompt contains change_title instruction - will auto-approve first "other" tool call if it matches pattern');
    }

    if (this.disposed) {
      throw new Error('Backend has been disposed');
    }

    if (!this.connection || !this.acpSessionId) {
      throw new Error('Session not started');
    }

    this.emit({ type: 'status', status: 'running' });
    this.waitingForResponse = true;

    try {
      logger.debug(`[AcpBackend] Sending prompt (length: ${prompt.length}): ${prompt.substring(0, 100)}...`);

      const contentBlock: ContentBlock = {
        type: 'text',
        text: prompt,
      };

      const promptRequest: PromptRequest = {
        sessionId: this.acpSessionId,
        prompt: [contentBlock],
      };

      await this.connection.prompt(promptRequest);
      logger.debug('[AcpBackend] Prompt request sent to ACP connection');

      // Don't emit 'idle' here - it will be emitted after all message chunks are received
      // The idle timeout in handleSessionUpdate will emit 'idle' after the last chunk

    } catch (error) {
      logger.debug('[AcpBackend] Error sending prompt:', error);
      this.waitingForResponse = false;

      // Extract error details for better error handling
      let errorDetail: string;
      if (error instanceof Error) {
        errorDetail = error.message;
      } else if (typeof error === 'object' && error !== null) {
        const errObj = error as Record<string, unknown>;
        const fallbackMessage = (typeof errObj.message === 'string' ? errObj.message : undefined) || String(error);
        if (errObj.code !== undefined) {
          errorDetail = JSON.stringify({ code: errObj.code, message: fallbackMessage });
        } else if (typeof errObj.message === 'string') {
          errorDetail = errObj.message;
        } else {
          errorDetail = String(error);
        }
      } else {
        errorDetail = String(error);
      }

      this.emit({
        type: 'status',
        status: 'error',
        detail: errorDetail
      });
      throw error;
    }
  }

  /**
   * Wait for the response to complete (idle status after all chunks received)
   * Call this after sendPrompt to wait for the agent to finish responding
   */
  async waitForResponseComplete(timeoutMs: number = 120000): Promise<void> {
    if (!this.waitingForResponse) {
      return; // Already completed or no prompt sent
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.idleResolver = null;
        this.waitingForResponse = false;
        reject(new Error('Timeout waiting for response to complete'));
      }, timeoutMs);

      this.idleResolver = () => {
        clearTimeout(timeout);
        this.idleResolver = null;
        this.waitingForResponse = false;
        resolve();
      };
    });
  }

  /**
   * Helper to emit idle status and resolve any waiting promises
   */
  private emitIdleStatus(): void {
    this.emit({ type: 'status', status: 'idle' });
    // Resolve any waiting promises
    if (this.idleResolver) {
      logger.debug('[AcpBackend] Resolving idle waiter');
      this.idleResolver();
    }
  }

  async cancel(_sessionId: SessionId): Promise<void> {
    if (!this.connection || !this.acpSessionId) {
      return;
    }

    try {
      await this.connection.cancel({ sessionId: this.acpSessionId });
      this.emit({ type: 'status', status: 'stopped', detail: 'Cancelled by user' });
    } catch (error) {
      logger.debug('[AcpBackend] Error cancelling:', error);
    }
  }

  /**
   * Emit permission response event for UI/logging purposes.
   *
   * **IMPORTANT:** For ACP backends, this method does NOT send the actual permission
   * response to the agent. The ACP protocol requires synchronous permission handling,
   * which is done inside the `requestPermission` RPC handler via `permissionHandler`.
   *
   * This method only emits a `permission-response` event for:
   * - UI updates (e.g., closing permission dialogs)
   * - Logging and debugging
   * - Other parts of the CLI that need to react to permission decisions
   */
  async respondToPermission(requestId: string, approved: boolean): Promise<void> {
    logger.debug(`[AcpBackend] Permission response event (UI only): ${requestId} = ${approved}`);
    this.emit({ type: 'permission-response', id: requestId, approved });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;

    logger.debug('[AcpBackend] Disposing backend');
    this.disposed = true;

    // Try graceful shutdown first
    if (this.connection && this.acpSessionId) {
      try {
        // Send cancel to stop any ongoing work
        await Promise.race([
          this.connection.cancel({ sessionId: this.acpSessionId }),
          new Promise((resolve) => setTimeout(resolve, 2000)), // 2s timeout for graceful shutdown
        ]);
      } catch (error) {
        logger.debug('[AcpBackend] Error during graceful shutdown:', error);
      }
    }

    // Kill the process
    if (this.process) {
      // Try SIGTERM first, then SIGKILL after timeout
      this.process.kill('SIGTERM');

      // Give process 1 second to terminate gracefully
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process) {
            logger.debug('[AcpBackend] Force killing process');
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 1000);

        this.process?.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.process = null;
    }

    // Clear timeouts
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }

    // Clear state
    this.listeners = [];
    this.connection = null;
    this.acpSessionId = null;
    this.activeToolCalls.clear();

    // Clear all tool call timeouts
    for (const timeout of this.toolCallTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.toolCallTimeouts.clear();
    this.toolCallStartTimes.clear();
    this.pendingPermissions.clear();
    this.permissionToToolCallMap.clear();
  }
}

/**
 * Create an ACP backend factory
 */
export function createAcpBackendFactory(): (config: AcpAgentConfig) => IAgentBackend {
  return (config: AcpAgentConfig) => {
    return new AcpBackend(config);
  };
}
