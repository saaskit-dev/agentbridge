/**
 * AcpBackend - Agent Client Protocol backend using official SDK
 *
 * This module provides a universal backend implementation using the official
 * @agentclientprotocol/sdk. Agent-specific behavior (timeouts, filtering,
 * error handling) is delegated to TransportHandler implementations.
 *
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { inspect } from 'node:util';
import type {
  IAgentBackend,
  AgentMessage,
  AgentMessageHandler,
  SessionId,
  StartSessionResult,
  PromptContentBlock,
} from '../../interfaces/agent';
import type { ITransportHandler, StderrContext, ToolNameContext } from '../../interfaces/transport';
import type { AcpAgentConfig, AcpPermissionHandler } from '../../types/agent';
import { Logger } from '../../telemetry/index.js';
import { safeStringify, toError } from '../../utils/stringify.js';
import {
  type SessionUpdate,
  type HandlerContext,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  DEFAULT_RESPONSE_TIMEOUT_MS,
  TOOL_CALL_ACTIVE_TIMEOUT_MS,
  handleAgentMessageChunk,
  handleAgentThoughtChunk,
  handleToolCallUpdate,
  handleToolCall,
  handleLegacyMessageChunk,
  handlePlanUpdate,
  handleThinkingUpdate,
  shouldLogUnhandledSessionUpdate,
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
  mcpServers?: Array<
    | { name: string; command: string; args?: string[]; env?: Array<{ name: string; value: string }> }
    | { name: string; url: string; headers?: Record<string, string> }
  >;
}

interface NewSessionResponse {
  sessionId: string;
  models?: unknown;
  modes?: unknown;
  configOptions?: unknown;
}

interface SetSessionModeResponse {
  [key: string]: unknown;
}

interface SetSessionModelResponse {
  [key: string]: unknown;
}

interface SetSessionConfigOptionResponse {
  configOptions?: unknown;
  [key: string]: unknown;
}

interface PromptRequest {
  sessionId: string;
  prompt: Array<{ type: string; [key: string]: unknown }>;
  _meta?: Record<string, unknown>;
}

/** ACP PromptResponse — returned by session/prompt when the agent turn completes. */
interface PromptResponse {
  stopReason: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';
  _meta?: Record<string, unknown> | null;
  usage?: { inputTokens?: number; outputTokens?: number } | null;
}

/** ContentBlock union matching the ACP protocol schema. */
type ContentBlock = PromptContentBlock;

interface Client {
  sessionUpdate: (params: SessionNotification) => Promise<void>;
  requestPermission: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
}

// Optional ACP SDK imports - only available when @agentclientprotocol/sdk is installed
// We use dynamic imports to avoid build errors when SDK is not installed
type ClientSideConnectionType = {
  initialize(request: InitializeRequest): Promise<unknown>;
  newSession(request: NewSessionRequest): Promise<{ sessionId: string }>;
  prompt(request: PromptRequest): Promise<PromptResponse>;
  cancel(request: { sessionId: string }): Promise<void>;
  setSessionMode?(request: { sessionId: string; modeId: string }): Promise<SetSessionModeResponse>;
  unstable_setSessionModel?(request: {
    sessionId: string;
    modelId: string;
  }): Promise<SetSessionModelResponse>;
  setSessionConfigOption?(request: {
    sessionId: string;
    configId: string;
    value: string;
  }): Promise<SetSessionConfigOptionResponse>;
  loadSession?(request: { sessionId: string; cwd: string; mcpServers?: unknown }): Promise<void>;
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

type PermissionOptionShape = {
  optionId?: string;
  name?: string;
  kind?: string;
};

function hasPermissionOptionKind(
  option: PermissionOptionShape,
  expectedKind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
): boolean {
  return option.kind === expectedKind;
}

function selectApprovalOption(
  options: PermissionOptionShape[],
  decision: 'approved' | 'approved_for_session'
): string {
  const proceedOnceOption = options.find(
    opt =>
      hasPermissionOptionKind(opt, 'allow_once') ||
      opt.optionId === 'proceed_once' ||
      (typeof opt.name === 'string' && opt.name.toLowerCase().includes('once'))
  );
  const proceedAlwaysOption = options.find(
    opt =>
      hasPermissionOptionKind(opt, 'allow_always') ||
      opt.optionId === 'proceed_always' ||
      (typeof opt.name === 'string' && opt.name.toLowerCase().includes('always'))
  );

  if (decision === 'approved_for_session' && proceedAlwaysOption) {
    return proceedAlwaysOption.optionId || 'proceed_always';
  }
  if (proceedOnceOption) {
    return proceedOnceOption.optionId || 'proceed_once';
  }
  if (options.length > 0) {
    const firstOpt = options[0] as { optionId?: string };
    return firstOpt.optionId || 'proceed_once';
  }
  return 'proceed_once';
}

export function selectPermissionOptionId(
  options: PermissionOptionShape[],
  decision: 'approved' | 'approved_for_session' | 'denied' | 'abort'
): string {
  if (decision === 'approved' || decision === 'approved_for_session') {
    return selectApprovalOption(options, decision);
  }

  // For a one-shot deny, prefer reject_once over reject_always to avoid persisting
  // the rejection beyond the current request. For abort, prefer persistent rejection.
  if (decision === 'denied') {
    const onceOption = options.find(opt => hasPermissionOptionKind(opt, 'reject_once'));
    if (onceOption) return onceOption.optionId;
  }

  const cancelOption = options.find(
    opt =>
      hasPermissionOptionKind(opt, 'reject_always') ||
      hasPermissionOptionKind(opt, 'reject_once') ||
      opt.optionId === 'cancel' ||
      (typeof opt.name === 'string' && opt.name.toLowerCase().includes('cancel'))
  );

  return cancelOption?.optionId || 'cancel';
}

/**
 * Extended SessionNotification with additional fields
 */
type ExtendedSessionNotification = SessionNotification & {
  update?: {
    sessionUpdate?: string;
    toolCallId?: string;
    status?: string;
    kind?: string | unknown;
    content?:
      | {
          text?: string;
          error?: string | { message?: string };
          [key: string]: unknown;
        }
      | string
      | unknown;
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
const logger = new Logger('agent/acp');

type StreamLogHooks = {
  onClientWrite?: (chunk: string) => void;
  onAgentStdoutChunk?: (chunk: string) => void;
};

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function serializeForLog(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return inspect(value, { depth: 8, breakLength: 120 });
  }
}

function summarizeEnvKeys(env?: Record<string, string>): string[] {
  return Object.keys(env ?? {}).sort();
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
      lastError = toError(error);

      if (attempt < options.maxAttempts) {
        // Calculate delay with exponential backoff
        const delayMs = Math.min(
          options.baseDelayMs * Math.pow(2, attempt - 1),
          options.maxDelayMs
        );

        logger.debug(
          `${options.operationName} failed (attempt ${attempt}/${options.maxAttempts}): ${lastError.message}. Retrying in ${delayMs}ms...`
        );
        options.onRetry?.(attempt, lastError);

        await delay(delayMs);
      }
    }
  }

  throw lastError;
}

/**
 * Run a promise with a timeout. Rejects with a descriptive error if the
 * operation doesn't complete within `ms` milliseconds.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          logger.warn(`[AcpBackend] ${label} timed out after ${ms / 1000}s`);
          reject(new Error(`${label} timed out after ${ms / 1000}s`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Convert Node.js streams to Web Streams for ACP SDK
 */
function nodeToWebStreams(
  stdin: Writable,
  stdout: Readable,
  hooks?: StreamLogHooks
): { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> } {
  const decoder = new TextDecoder();
  // Convert Node writable to Web WritableStream
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise((resolve, reject) => {
        hooks?.onClientWrite?.(decoder.decode(chunk));
        const ok = stdin.write(chunk, err => {
          if (err) {
            logger.warn(`[AcpBackend] Error writing to stdin:`, err);
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
      return new Promise(resolve => {
        stdin.end(resolve);
      });
    },
    abort(reason) {
      stdin.destroy(toError(reason));
    },
  });

  // Convert Node readable to Web ReadableStream
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      stdout.on('data', (chunk: Buffer) => {
        hooks?.onAgentStdoutChunk?.(chunk.toString());
        controller.enqueue(new Uint8Array(chunk));
      });
      stdout.on('end', () => {
        controller.close();
      });
      stdout.on('error', err => {
        logger.warn(`[AcpBackend] Stdout error:`, err);
        controller.error(err);
      });
    },
    cancel() {
      stdout.destroy();
    },
  });

  return { writable, readable };
}

/**
 * ACP backend using the official @agentclientprotocol/sdk
 */
export class AcpBackend implements IAgentBackend {
  private listeners: AgentMessageHandler[] = [];
  private sessionStartedListeners: Array<(response: NewSessionResponse) => void> = [];
  private sessionUpdateListeners: Array<(update: SessionUpdate) => void> = [];
  private process: ChildProcess | null = null;
  private connection: ClientSideConnectionType | null = null;
  private localSessionId: string | null = null;
  private acpSessionId: string | null = null;
  private agentCapabilities: { loadSession?: boolean } | null = null;
  private disposed = false;
  private lastStopReason: string | null = null;

  /** Track active tool calls to prevent duplicate events */
  private activeToolCalls = new Set<string>();
  private toolCallTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  /** Track tool call start times for performance monitoring */
  private toolCallStartTimes = new Map<string, number>();

  /** Pending permission requests that need response */
  private pendingPermissions = new Map<string, (response: RequestPermissionResponse) => void>();

  /** Map from permission request ID to real tool call ID for tracking (reserved for future use) */

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

  private logAcpRequest(method: string, payload: unknown, extra?: Record<string, unknown>): void {
    logger.debug('[AcpBackend] ACP request', {
      method,
      agentName: this.config.agentName,
      childPid: this.process?.pid ?? null,
      payload: serializeForLog(payload),
      ...extra,
    });
  }

  private logAcpResponse(method: string, payload: unknown, extra?: Record<string, unknown>): void {
    logger.debug('[AcpBackend] ACP response', {
      method,
      agentName: this.config.agentName,
      childPid: this.process?.pid ?? null,
      payload: serializeForLog(payload),
      ...extra,
    });
  }

  private logAcpNotification(
    method: string,
    payload: unknown,
    extra?: Record<string, unknown>
  ): void {
    logger.debug('[AcpBackend] ACP notification', {
      method,
      agentName: this.config.agentName,
      childPid: this.process?.pid ?? null,
      payload: serializeForLog(payload),
      ...extra,
    });
  }

  private logWire(
    direction: 'outbound' | 'inbound' | 'stderr',
    payload: string,
    extra?: Record<string, unknown>
  ): void {
    logger.debug('[AcpBackend] ACP wire', {
      direction,
      agentName: this.config.agentName,
      childPid: this.process?.pid ?? null,
      payload,
      ...extra,
    });
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

  onSessionStarted(handler: (response: NewSessionResponse) => void): void {
    this.sessionStartedListeners.push(handler);
  }

  onSessionUpdate(handler: (update: SessionUpdate) => void): void {
    this.sessionUpdateListeners.push(handler);
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

  private emitSessionStarted(response: NewSessionResponse): void {
    this.logAcpNotification('session/started', response);
    for (const listener of this.sessionStartedListeners) {
      try {
        listener(response);
      } catch (error) {
        logger.warn('[AcpBackend] Error in session started handler:', error);
      }
    }
  }

  private emitSessionUpdate(update: SessionUpdate): void {
    this.logAcpNotification('session/update', update, {
      sessionUpdate: update.sessionUpdate ?? null,
    });
    for (const listener of this.sessionUpdateListeners) {
      try {
        listener(update);
      } catch (error) {
        logger.warn('[AcpBackend] Error in session update handler:', error);
      }
    }
  }

  async startSession(initialPrompt?: string): Promise<StartSessionResult> {
    if (this.disposed) {
      throw new Error('Backend has been disposed');
    }

    if (!ClientSideConnectionClass || !ndJsonStreamFunc) {
      throw new Error(
        '@agentclientprotocol/sdk is not installed. Please install it to use AcpBackend.'
      );
    }

    const sessionId = randomUUID();
    this.localSessionId = sessionId;
    this.emit({ type: 'status', status: 'starting' });

    try {
      logger.info(`[AcpBackend] Starting session: ${sessionId}`);

      // Spawn the ACP agent process
      const args = this.config.args || [];
      logger.debug('[AcpBackend] Spawning ACP agent process', {
        localSessionId: sessionId,
        agentName: this.config.agentName,
        command: this.config.command,
        args,
        cwd: this.config.cwd,
        envKeys: summarizeEnvKeys(this.config.env),
        hasPermissionHandler: this.permissionHandler != null,
        mcpServerNames: Object.keys(this.config.mcpServers ?? {}),
      });

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
      logger.debug('[AcpBackend] ACP agent process spawned', {
        agentName: this.config.agentName,
        localSessionId: this.localSessionId,
        childPid: this.process.pid ?? null,
      });

      // Handle stderr output via transport handler
      this.process.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        if (!text.trim()) return;
        this.logWire('stderr', text, { agentName: this.config.agentName });

        // Build context for transport handler
        const hasActiveInvestigation = this.transport.isInvestigationTool
          ? Array.from(this.activeToolCalls).some(id => this.transport.isInvestigationTool!(id))
          : false;

        const context: StderrContext = {
          activeToolCalls: this.activeToolCalls,
          hasActiveInvestigation,
        };

        logger.warn(`[AcpBackend] Agent stderr: ${text.trim()}`);

        // Let transport handler process stderr and optionally emit messages
        if (this.transport.handleStderr) {
          const result = this.transport.handleStderr(text, context);
          if (result.message) {
            this.emit(result.message);
          }
        }
      });

      this.process.on('error', err => {
        logger.error('[ACP] Process error', err, { agent: this.transport.agentName });
        this.emit({ type: 'status', status: 'error', detail: err.message });
      });

      this.process.on('exit', (code, signal) => {
        if (this.disposed) return;

        const reason = `Process exited (code=${code ?? 'null'}, signal=${signal ?? 'none'})`;

        if (code !== 0 && code !== null) {
          logger.error('[ACP] Process exit', undefined, {
            agent: this.transport.agentName,
            code,
            signal: signal || 'none',
          });
        } else {
          logger.info('[ACP] Process exit', {
            agent: this.transport.agentName,
            code,
            signal: signal || 'none',
          });
        }

        // Immediately reject any pending waitForResponseComplete so the caller
        // (messageLoop) is unblocked instead of waiting for the response timeout.
        this.rejectPendingResponse(new Error(reason));

        this.emit({ type: 'status', status: 'stopped', detail: reason });
      });

      // Create Web Streams from Node streams
      const streams = nodeToWebStreams(this.process.stdin, this.process.stdout, {
        onClientWrite: chunk => {
          this.logWire('outbound', chunk, { agentName: this.config.agentName });
        },
        onAgentStdoutChunk: chunk => {
          this.logWire('inbound', chunk, { agentName: this.config.agentName });
        },
      });
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
                  const action =
                    filtered === undefined ? 'pass' : filtered === null ? 'filter' : 'transform';
                  logger.debug('[AcpBackend] ACP stdout line', {
                    agentName: transport.agentName,
                    action,
                    line: buffer,
                    transformedLine:
                      filtered !== undefined && filtered !== null && filtered !== buffer
                        ? filtered
                        : undefined,
                  });
                  if (filtered === undefined) {
                    controller.enqueue(encoder.encode(buffer));
                  } else if (filtered !== null) {
                    controller.enqueue(encoder.encode(filtered));
                  } else {
                    filteredCount++;
                  }
                }
                if (filteredCount > 0) {
                  logger.debug(
                    `[AcpBackend] Filtered out ${filteredCount} non-JSON lines from ${transport.agentName} stdout`
                  );
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
                const action =
                  filtered === undefined ? 'pass' : filtered === null ? 'filter' : 'transform';
                logger.debug('[AcpBackend] ACP stdout line', {
                  agentName: transport.agentName,
                  action,
                  line,
                  transformedLine:
                    filtered !== undefined && filtered !== null && filtered !== line
                      ? filtered
                      : undefined,
                });
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
            logger.warn(`[AcpBackend] Error filtering stdout stream:`, error);
            controller.error(error);
          } finally {
            reader.releaseLock();
          }
        },
      });

      // Create ndJSON stream for ACP
      const stream = ndJsonStreamFunc(writable, filteredReadable);

      // Create Client implementation
      const client: Client = {
        sessionUpdate: async (params: SessionNotification) => {
          this.logAcpNotification('session/update', params);
          this.handleSessionUpdate(params);
        },
        requestPermission: async (
          params: RequestPermissionRequest
        ): Promise<RequestPermissionResponse> => {
          this.logAcpRequest('request_permission', params);
          const extendedParams = params as ExtendedRequestPermissionRequest;
          const toolCall = extendedParams.toolCall;
          let toolName =
            toolCall?.kind || toolCall?.toolName || extendedParams.kind || 'Unknown tool';
          // Use toolCallId as the single source of truth for permission ID
          const toolCallId = toolCall?.id || randomUUID();
          const permissionId = toolCallId; // Use same ID for consistency!

          // Extract input/arguments from various possible locations
          let input: Record<string, unknown> = {};
          if (toolCall) {
            input = toolCall.input || toolCall.arguments || toolCall.content || {};
          } else {
            input =
              extendedParams.input || extendedParams.arguments || extendedParams.content || {};
          }

          // If toolName is "other" or "Unknown tool", try to determine real tool name
          const context: ToolNameContext = {
            recentPromptHadChangeTitle: this.recentPromptHadChangeTitle,
            toolCallCountSincePrompt: this.toolCallCountSincePrompt,
          };
          toolName =
            this.transport.determineToolName?.(toolName, toolCallId, input, context) ?? toolName;

          // Increment tool call counter
          this.toolCallCountSincePrompt++;

          const options = extendedParams.options || [];

          logger.debug(
            `[AcpBackend] Permission request: tool=${toolName}, toolCallId=${toolCallId}, hasPermissionHandler=${this.permissionHandler ? 'yes' : 'no'}, options=${options.length}`
          );

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
              logger.debug(
                `[AcpBackend] Permission handler decision: tool=${toolName}, toolCallId=${toolCallId}, decision=${result.decision}`
              );

              // Map permission decision to ACP response
              const optionId = selectPermissionOptionId(options, result.decision);

              if (result.decision === 'approved' || result.decision === 'approved_for_session') {
                // Emit tool-result so UI can close the timer
                this.emit({
                  type: 'tool-result',
                  toolName,
                  result: { status: 'approved', decision: result.decision },
                  callId: permissionId,
                });
              } else {
                this.emit({
                  type: 'tool-result',
                  toolName,
                  result: { status: 'denied', decision: result.decision },
                  callId: permissionId,
                });
              }

              const acpResponse = { outcome: { outcome: 'selected', optionId } };
              this.logAcpResponse('request_permission', acpResponse, {
                toolCallId,
                toolName,
                decision: result.decision,
              });
              return acpResponse;
            } catch (error) {
              logger.warn('[AcpBackend] Error in permission handler', {
                toolName,
                toolCallId,
                error: safeStringify(error),
              });
              const acpResponse = { outcome: { outcome: 'selected', optionId: 'cancel' } };
              this.logAcpResponse('request_permission', acpResponse, {
                toolCallId,
                toolName,
                decision: 'error',
                error: safeStringify(error),
              });
              return acpResponse;
            }
          }

          // Auto-approve with the ACP-standard one-off allow option if no permission handler
          const defaultOptionId = selectPermissionOptionId(options, 'approved');
          logger.warn(
            '[AcpBackend] No permission handler attached, auto-approving permission request',
            {
              toolName,
              toolCallId,
              selectedOptionId: defaultOptionId,
              options: options.map((opt: { optionId?: string; name?: string; kind?: string }) => ({
                optionId: opt.optionId ?? null,
                name: opt.name ?? null,
                kind: opt.kind ?? null,
              })),
            }
          );
          const acpResponse = { outcome: { outcome: 'selected', optionId: defaultOptionId } };
          this.logAcpResponse('request_permission', acpResponse, {
            toolCallId,
            toolName,
            decision: 'auto-approve',
          });
          return acpResponse;
        },
      };

      // Create ClientSideConnection (we already checked ClientSideConnectionClass is defined above)

      this.connection = new ClientSideConnectionClass!(() => client, stream);

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
          name: 'free',
          version: '1.0.0',
        },
      };

      const initTimeout = this.transport.getInitTimeout();
      logger.info(`[AcpBackend] Initializing connection (timeout: ${initTimeout}ms)...`);
      this.logAcpRequest('initialize', initRequest, { timeoutMs: initTimeout });

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
                  reject(
                    new Error(
                      `Initialize timeout after ${initTimeout}ms - ${this.transport.agentName} did not respond`
                    )
                  );
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
      this.logAcpResponse('initialize', initResult, { timeoutMs: initTimeout });

      // Save agent capabilities for later use (e.g., loadSession)
      if (initResult && typeof initResult === 'object') {
        const result = initResult as { agentCapabilities?: { loadSession?: boolean } };
        this.agentCapabilities = result.agentCapabilities || null;
        logger.debug(`[AcpBackend] Agent capabilities:`, this.agentCapabilities);
      }

      logger.info(`[AcpBackend] Initialize completed`);

      // Create a new session with retry
      const mcpServers = this.config.mcpServers
        ? Object.entries(this.config.mcpServers).map(([name, config]) => {
            if ('url' in config && config.transport === 'http') {
              return { name, url: config.url, ...(config.headers ? { headers: config.headers } : {}) };
            }
            // stdio transport (default)
            const stdioConfig = config as { command: string; args?: string[]; env?: Record<string, string> };
            return {
              name,
              command: stdioConfig.command,
              args: stdioConfig.args || [],
              env: stdioConfig.env
                ? Object.entries(stdioConfig.env).map(([envName, envValue]) => ({
                    name: envName,
                    value: envValue,
                  }))
                : [],
            };
          })
        : [];

      const newSessionRequest: NewSessionRequest = {
        cwd: this.config.cwd,
        mcpServers: mcpServers as unknown as NewSessionRequest['mcpServers'],
      };

      logger.info(`[AcpBackend] Creating new session...`);
      this.logAcpRequest('new_session', newSessionRequest);

      const sessionResponse = await withRetry(
        async () => {
          let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
          try {
            const result = await Promise.race([
              this.connection!.newSession(newSessionRequest).then((res: NewSessionResponse) => {
                if (timeoutHandle) {
                  clearTimeout(timeoutHandle);
                  timeoutHandle = null;
                }
                return res;
              }),
              new Promise<never>((_, reject) => {
                timeoutHandle = setTimeout(() => {
                  reject(
                    new Error(
                      `New session timeout after ${initTimeout}ms - ${this.transport.agentName} did not respond`
                    )
                  );
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
      this.logAcpResponse('new_session', sessionResponse);
      logger.info(`[AcpBackend] Session created: ${this.acpSessionId}`);
      this.emitSessionStarted(sessionResponse);

      this.emitIdleStatus();

      // Send initial prompt if provided
      if (initialPrompt) {
        this.sendPrompt(sessionId, [{ type: 'text', text: initialPrompt }]).catch(error => {
          logger.error('[ACP] Initial prompt send failed', undefined, {
            agent: this.transport.agentName,
            error: safeStringify(error),
          });
          this.emit({ type: 'status', status: 'error', detail: safeStringify(error) });
        });
      }

      // Return the real ACP session ID (from session/new response) so callers can persist it
      // for crash recovery. localSessionId is only an internal log-correlation UUID and has
      // no corresponding on-disk session file — using it as a resume ID would always fail.
      return { sessionId: this.acpSessionId };
    } catch (error) {
      logger.warn('[ACP] Session start failed', {
        agent: this.transport.agentName,
        error: safeStringify(error),
      });
      throw new Error(`[ACP] Session start failed: ${safeStringify(error)}`);
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

    logger.info(`[AcpBackend] Loading session: ${sessionId}`);

    try {
      // Convert mcpServers to ACP format
      const acpMcpServers =
        mcpServers?.map(server => ({
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
      this.logAcpRequest('load_session', loadSessionRequest);

      // The agent will replay history via session/update notifications
      if (!this.connection.loadSession) {
        throw new Error('ACP session/load is not supported by this SDK connection');
      }

      // loadSession replays history which can take a while, but if the agent
      // never responds at all the await hangs forever.
      await withTimeout(
        this.connection.loadSession(loadSessionRequest),
        5 * 60_000,
        'loadSession()'
      );
      this.logAcpResponse('load_session', { ok: true });

      // Store the session ID
      this.acpSessionId = sessionId;

      logger.info(`[AcpBackend] Session loaded: ${sessionId}`);

      return { sessionId };
    } catch (error) {
      logger.warn('[ACP] Session load failed', {
        agent: this.transport.agentName,
        error: safeStringify(error),
      });
      throw new Error(`[ACP] Session load failed: ${safeStringify(error)}`);
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
      mcpServerNames: Object.keys(this.config.mcpServers ?? {}),
      emit: msg => this.emit(msg),
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
      resetResponseCompleteTimeout: () => this.resetResponseCompleteTimeout(),
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
      logger.debug(
        `[AcpBackend] Received session update: ${sessionUpdateType}`,
        JSON.stringify(
          {
            sessionUpdate: sessionUpdateType,
            toolCallId: (update as { toolCallId?: string }).toolCallId,
            status: (update as { status?: string }).status,
            kind: (update as { kind?: unknown }).kind,
            hasContent: !!(update as { content?: unknown }).content,
            hasLocations: !!(update as { locations?: unknown[] }).locations,
          },
          null,
          2
        )
      );
    }

    const ctx = this.createHandlerContext();
    this.emitSessionUpdate(update as SessionUpdate);

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
    if (shouldLogUnhandledSessionUpdate(update as SessionUpdate)) {
      logger.warn(
        `[AcpBackend] Unhandled session update type: ${updateTypeStr}`,
        JSON.stringify(update, null, 2)
      );
    }
  }

  // Promise resolver for waitForIdle - set when waiting for response to complete
  private idleResolver: (() => void) | null = null;
  private waitingForResponse = false;

  /**
   * True when emitIdleStatus ran while idleResolver was not yet registered.
   * DiscoveredAcpBackendBase calls sendPrompt (await prompt) then waitForResponseComplete;
   * the 500ms idle timer can fire after the last agent_message_chunk before prompt()
   * returns, so idle is emitted with no waiter — waitForResponseComplete must not
   * wait 10 minutes for a second idle that will never arrive.
   */
  private idleEmittedBeforeWaitForResponseComplete = false;

  // Dynamic response complete timeout (activity-based reset)
  private responseCompleteTimeout: ReturnType<typeof setTimeout> | null = null;
  private responseCompleteRejecter: ((error: Error) => void) | null = null;

  async sendPrompt(_sessionId: SessionId, prompt: ContentBlock[], meta?: { _meta?: Record<string, unknown> }): Promise<void> {
    // Check if prompt contains change_title instruction (via optional callback)
    const textContent = prompt
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('');
    const promptHasChangeTitle = this.hasChangeTitleInstruction?.(textContent) ?? false;

    // Reset tool call counter and set flag
    this.toolCallCountSincePrompt = 0;
    this.recentPromptHadChangeTitle = promptHasChangeTitle;

    if (promptHasChangeTitle) {
      logger.debug(
        '[AcpBackend] Prompt contains change_title instruction - will auto-approve first "other" tool call if it matches pattern'
      );
    }

    if (this.disposed) {
      throw new Error('Backend has been disposed');
    }

    if (!this.connection || !this.acpSessionId) {
      throw new Error('Session not started');
    }

    this.emit({ type: 'status', status: 'running' });
    this.waitingForResponse = true;
    this.idleEmittedBeforeWaitForResponseComplete = false;

    try {
      logger.info(
        `[AcpBackend] Sending prompt (${prompt.length} blocks, text: ${textContent.substring(0, 100)}...)`
      );

      const promptRequest: PromptRequest = {
        sessionId: this.acpSessionId,
        prompt,
        ...(meta?._meta ? { _meta: meta._meta } : {}),
      };

      this.logAcpRequest('prompt', promptRequest, {
        promptLength: prompt.length,
      });

      // connection.prompt() is a JSONRPC request that resolves when the agent
      // finishes the full turn (returns PromptResponse with StopReason).
      // A normal turn can easily take 2–20+ minutes with tool calls, so we
      // do NOT apply a timeout here.  The activity-based responseCompleteTimeout
      // (10/20 min inactivity) in waitForResponseComplete() is the safeguard —
      // it cancels the turn if the agent goes silent, which causes prompt()
      // to resolve with StopReason::Cancelled.
      // If the child process dies, the process exit handler calls
      // rejectPendingResponse() which unblocks waitForResponseComplete().
      const promptResponse = await this.connection.prompt(promptRequest);
      this.lastStopReason = promptResponse?.stopReason ?? null;

      this.logAcpResponse(
        'prompt',
        { ok: true, stopReason: this.lastStopReason },
        {
          promptLength: prompt.length,
        }
      );
      logger.info('[AcpBackend] Prompt turn completed', { stopReason: this.lastStopReason });

      // connection.prompt() resolving means the agent turn is definitively complete.
      // If idle was never emitted (e.g. all tool calls timed out but no new chunks
      // arrived after the last timeout), force-emit it now so waitForResponseComplete()
      // does not hang until the 10-20 min activity timeout.
      if (this.waitingForResponse && !this.idleEmittedBeforeWaitForResponseComplete) {
        logger.info('[AcpBackend] prompt() resolved with no prior idle — forcing idle emission', {
          agent: this.transport.agentName,
          activeToolCalls: this.activeToolCalls.size,
        });
        this.emitIdleStatus();
      }
    } catch (error) {
      // Use warn (not error) so DaemonLogSink does not forward this log entry to
      // the App as a second visible error. The caller (messageLoop) will catch the
      // re-thrown error and call publishVisibleError(), which is the single
      // user-facing error path.
      logger.warn('[ACP] Prompt failed', {
        agent: this.transport.agentName,
        error: safeStringify(error),
      });
      this.waitingForResponse = false;
      this.idleEmittedBeforeWaitForResponseComplete = false;

      // Don't emit status:error here — the caller (messageLoop) already
      // catches the throw and calls publishVisibleError().  Emitting AND
      // throwing causes the same error to reach the server twice via two
      // independent paths (onMessage→drainBackendOutput vs catch→publishVisibleError).
      //
      // Wrap with context so publishVisibleError() shows a human-readable message
      // instead of a raw JSON object.
      throw new Error(`[ACP] Prompt failed: ${safeStringify(error)}`);
    }
  }

  /**
   * Reject the pending waitForResponseComplete promise (if any) and clean up
   * timer state. Safe to call multiple times — subsequent calls are no-ops.
   */
  private rejectPendingResponse(error: Error): void {
    const hadPending = this.responseCompleteRejecter != null;
    if (this.responseCompleteTimeout) {
      clearTimeout(this.responseCompleteTimeout);
      this.responseCompleteTimeout = null;
    }
    const rejecter = this.responseCompleteRejecter;
    this.responseCompleteRejecter = null;
    this.idleResolver = null;
    this.waitingForResponse = false;
    this.idleEmittedBeforeWaitForResponseComplete = false;
    if (rejecter) {
      logger.warn('[AcpBackend] rejecting pending response', {
        agent: this.transport.agentName,
        reason: error.message,
      });
      rejecter(error);
    } else if (hadPending) {
      logger.debug('[AcpBackend] rejectPendingResponse called but rejecter already consumed', {
        reason: error.message,
      });
    }
  }

  /**
   * Get appropriate timeout based on current activity state
   */
  private getResponseCompleteTimeoutMs(): number {
    if (this.activeToolCalls.size > 0) {
      return TOOL_CALL_ACTIVE_TIMEOUT_MS; // 20 minutes when tool calls are active
    }
    return DEFAULT_RESPONSE_TIMEOUT_MS; // 10 minutes default
  }

  /**
   * Reset the response complete timeout (called on activity)
   */
  private resetResponseCompleteTimeout(): void {
    if (!this.waitingForResponse) {
      return; // Not waiting, nothing to reset
    }

    // Clear the previous timeout to prevent orphaned timers from corrupting
    // state on subsequent turns (idleResolver, responseCompleteRejecter, waitingForResponse).
    if (this.responseCompleteTimeout) {
      clearTimeout(this.responseCompleteTimeout);
    }

    const timeoutMs = this.getResponseCompleteTimeoutMs();
    this.responseCompleteTimeout = setTimeout(() => {
      const timeoutMin = Math.round(timeoutMs / 60000);
      logger.warn('[AcpBackend] response complete timeout fired', {
        agent: this.transport.agentName,
        timeoutMin,
        activeToolCalls: this.activeToolCalls.size,
      });
      const error = new Error(
        `Response timed out after ${timeoutMin} minutes. ` +
          `The LLM may still be running. You can continue sending messages.`
      );

      // Reject FIRST to unblock the caller immediately — cancelCurrentTurn
      // may hang if the child process is dead or the connection is broken.
      this.rejectPendingResponse(error);

      // Fire-and-forget cancel so we don't block the reject
      this.cancelCurrentTurn().catch(err =>
        logger.warn('[AcpBackend] cancelCurrentTurn error after timeout:', err)
      );
    }, timeoutMs);
  }

  /**
   * Helper to cancel current LLM turn on timeout
   */
  private async cancelCurrentTurn(): Promise<void> {
    if (!this.acpSessionId || !this.connection) {
      return;
    }

    try {
      const cancelRequest = { sessionId: this.acpSessionId };
      this.logAcpRequest('cancel', cancelRequest, { reason: 'response-timeout' });
      await withTimeout(this.connection.cancel(cancelRequest), 10_000, 'cancel()');

      this.logAcpResponse('cancel', { ok: true }, { reason: 'response-timeout' });
      this.emit({
        type: 'status',
        status: 'stopped',
        detail: 'Response timed out after inactivity',
      });
    } catch (error) {
      logger.warn('[AcpBackend] Error cancelling turn on timeout:', error);
    }
  }

  /**
   * Wait for the response to complete (idle status after all chunks received)
   * Call this after sendPrompt to wait for the agent to finish responding
   *
   * Timeout is dynamic and activity-based:
   * - 10 minutes default (reset on each activity)
   * - 20 minutes when tool calls are active
   *
   * On timeout, the current LLM turn is cancelled automatically.
   * The session remains active and users can continue sending messages.
   */
  async waitForResponseComplete(_timeoutMs?: number): Promise<void> {
    if (!this.waitingForResponse) {
      return; // Already completed or no prompt sent
    }

    // Idle already fired (500ms after last chunk) while await prompt() was still pending;
    // idleResolver was null so emitIdleStatus could not resolve the waiter.
    if (this.idleEmittedBeforeWaitForResponseComplete) {
      this.idleEmittedBeforeWaitForResponseComplete = false;
      this.waitingForResponse = false;
      logger.info('[AcpBackend] waitForResponseComplete: idle already emitted before waiter');
      return;
    }

    return new Promise((resolve, reject) => {
      // Store rejecter for timeout callback
      this.responseCompleteRejecter = reject;

      // Set initial timeout
      this.resetResponseCompleteTimeout();

      this.idleResolver = () => {
        // Clear timeout on success
        if (this.responseCompleteTimeout) {
          clearTimeout(this.responseCompleteTimeout);
          this.responseCompleteTimeout = null;
        }
        this.responseCompleteRejecter = null;
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
    // Clear response complete timeout
    if (this.responseCompleteTimeout) {
      clearTimeout(this.responseCompleteTimeout);
      this.responseCompleteTimeout = null;
    }

    this.emit({ type: 'status', status: 'idle' });
    // Resolve any waiting promises
    if (this.idleResolver) {
      logger.info('[AcpBackend] Resolving idle waiter');
      this.idleResolver();
    } else if (this.waitingForResponse) {
      this.idleEmittedBeforeWaitForResponseComplete = true;
    }
  }

  async cancel(_sessionId: SessionId): Promise<void> {
    if (!this.connection || !this.acpSessionId) {
      return;
    }

    try {
      const cancelRequest = { sessionId: this.acpSessionId };
      this.logAcpRequest('cancel', cancelRequest, { requestedSessionId: _sessionId });
      await withTimeout(this.connection.cancel(cancelRequest), 10_000, 'cancel()');
      this.logAcpResponse('cancel', { ok: true }, { requestedSessionId: _sessionId });
    } catch (error) {
      logger.warn('[AcpBackend] Error cancelling:', error);
    }
  }

  async setSessionMode(_sessionId: SessionId, modeId: string): Promise<SetSessionModeResponse> {
    if (!this.connection || !this.acpSessionId) {
      throw new Error('Session not started');
    }
    if (!this.connection.setSessionMode) {
      throw new Error('ACP session/set_mode is not supported by this SDK connection');
    }
    const request = {
      sessionId: this.acpSessionId,
      modeId,
    };
    this.logAcpRequest('set_mode', request, { requestedSessionId: _sessionId });
    const response = await withTimeout(
      this.connection.setSessionMode(request),
      30_000,
      'setSessionMode()'
    );
    this.logAcpResponse('set_mode', response, { requestedSessionId: _sessionId });
    return response;
  }

  /**
   * Set the session model via the ACP SDK's unstable_setSessionModel API.
   *
   * The `unstable_` prefix comes from the official @agentclientprotocol/sdk — this is not
   * a non-standard extension. DiscoveredAcpBackendBase.applyModelSelection() tries this first
   * and falls back to setSessionConfigOption() (the fully standardized session/set_config_option
   * path) if it fails. Both paths are correct per the ACP spec.
   */
  async setSessionModel(_sessionId: SessionId, modelId: string): Promise<SetSessionModelResponse> {
    if (!this.connection || !this.acpSessionId) {
      throw new Error('Session not started');
    }
    if (!this.connection.unstable_setSessionModel) {
      throw new Error('ACP unstable_setSessionModel is not supported by this SDK connection');
    }
    const request = {
      sessionId: this.acpSessionId,
      modelId,
    };
    this.logAcpRequest('set_model', request, { requestedSessionId: _sessionId });
    const response = await withTimeout(
      this.connection.unstable_setSessionModel(request),
      30_000,
      'setSessionModel()'
    );
    this.logAcpResponse('set_model', response, { requestedSessionId: _sessionId });
    return response;
  }

  async setSessionConfigOption(
    _sessionId: SessionId,
    configId: string,
    value: string
  ): Promise<SetSessionConfigOptionResponse> {
    if (!this.connection || !this.acpSessionId) {
      throw new Error('Session not started');
    }
    if (!this.connection.setSessionConfigOption) {
      throw new Error('ACP session/set_config_option is not supported by this SDK connection');
    }
    const request = {
      sessionId: this.acpSessionId,
      configId,
      value,
    };
    this.logAcpRequest('set_config_option', request, { requestedSessionId: _sessionId });
    const response = await withTimeout(
      this.connection.setSessionConfigOption(request),
      30_000,
      'setSessionConfigOption()'
    );
    this.logAcpResponse('set_config_option', response, { requestedSessionId: _sessionId });
    return response;
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

  getLastStopReason(): string | null {
    return this.lastStopReason;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;

    logger.info('[AcpBackend] Disposing backend');
    this.disposed = true;

    // Try graceful shutdown first
    if (this.connection && this.acpSessionId) {
      try {
        // Send cancel to stop any ongoing work
        this.logAcpRequest('cancel', { sessionId: this.acpSessionId }, { reason: 'dispose' });
        await Promise.race([
          this.connection.cancel({ sessionId: this.acpSessionId }),
          new Promise(resolve => setTimeout(resolve, 2000)), // 2s timeout for graceful shutdown
        ]);
        this.logAcpResponse('cancel', { ok: true }, { reason: 'dispose' });
      } catch (error) {
        logger.warn('[AcpBackend] Error during graceful shutdown:', error);
      }
    }

    // Kill the process
    if (this.process) {
      // Try SIGTERM first, then SIGKILL after timeout
      this.process.kill('SIGTERM');

      // Give process 1 second to terminate gracefully
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          if (this.process) {
            logger.info('[AcpBackend] Force killing process');
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
