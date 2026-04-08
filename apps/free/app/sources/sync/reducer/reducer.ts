/**
 * Message Reducer for Real-time Sync System
 *
 * This reducer is the core message processing engine that transforms raw messages from
 * the sync system into a structured, deduplicated message history. It handles complex
 * scenarios including tool permissions, sidechains, and message deduplication.
 *
 * ## Core Responsibilities:
 *
 * 1. **Message Deduplication**: Prevents duplicate messages using multiple tracking mechanisms:
 *    - processedIds tracking for deduplication
 *    - messageId tracking for all messages
 *    - Permission ID tracking for tool permissions
 *
 * 2. **Tool Permission Management**: Integrates with AgentState to handle tool permissions:
 *    - Creates placeholder messages for pending permission requests
 *    - Updates permission status (pending → approved/denied/canceled)
 *    - Matches incoming tool calls to approved permissions
 *    - Prioritizes tool calls over permissions when both exist
 *
 * 3. **Tool Call Lifecycle**: Manages the complete lifecycle of tool calls:
 *    - Creation from permission requests or direct tool calls
 *    - Matching tool calls to existing permission messages
 *    - Processing tool results and updating states
 *    - Handling errors and completion states
 *
 * 4. **Sidechain Processing**: Handles nested conversation branches (sidechains):
 *    - Identifies sidechain messages using the tracer
 *    - Stores sidechain messages separately
 *    - Links sidechains to their parent tool calls
 *
 * ## Processing Phases:
 *
 * The reducer processes messages in a specific order to ensure correct behavior:
 *
 * **Phase 0: AgentState Permissions**
 *   - Processes pending and completed permission requests
 *   - Creates tool messages for permissions
 *   - Skips completed permissions if matching tool call (same name AND arguments) exists in incoming messages
 *   - Phase 2 will handle matching tool calls to existing permission messages
 *
 * **Phase 0.5: Message-to-Event Conversion**
 *   - Parses messages to check if they should be converted to events
 *   - Converts matching messages to events immediately
 *   - Converted messages skip all subsequent processing phases
 *   - Supports user commands, tool results, and metadata-driven conversions
 *
 * **Phase 1: User and Text Messages**
 *   - Processes user messages with deduplication
 *   - Processes agent text messages
 *   - Skips tool calls for later phases
 *
 * **Phase 2: Tool Calls**
 *   - Processes incoming tool calls from agents
 *   - Matches to existing permission messages when possible
 *   - Creates new tool messages when no match exists
 *   - Prioritizes newest permission when multiple matches
 *
 * **Phase 3: Tool Results**
 *   - Updates tool messages with results
 *   - Sets completion or error states
 *   - Updates completion timestamps
 *
 * **Phase 4: Sidechains**
 *   - Processes sidechain messages separately
 *   - Stores in sidechain map linked to parent tool
 *   - Handles nested tool calls within sidechains
 *
 * **Phase 5: Mode Switch Events**
 *   - Processes agent event messages
 *   - Handles mode changes and other events
 *
 * ## Key Behaviors:
 *
 * - **Idempotency**: Calling the reducer multiple times with the same data produces no duplicates
 * - **Priority Rules**: When both tool calls and permissions exist, tool calls take priority
 * - **Argument Matching**: Tool calls match to permissions based on both name AND arguments
 * - **Timestamp Preservation**: Original timestamps are preserved when matching tools to permissions
 * - **State Persistence**: The ReducerState maintains all mappings across calls
 * - **Message Immutability**: NEVER modify message timestamps or core properties after creation
 *   Messages can only have their tool state/result updated, never their creation metadata
 * - **Timestamp Preservation**: NEVER change a message's createdAt timestamp. The timestamp
 *   represents when the message was originally created and must be preserved throughout all
 *   processing phases. This is critical for maintaining correct message ordering.
 *
 * ## Permission Matching Algorithm:
 *
 * When a tool call arrives, the matching algorithm:
 * 1. Checks if the tool has already been processed (via toolIdToMessageId)
 * 2. Searches for approved permission messages with:
 *    - Same tool name
 *    - Matching arguments (deep equality)
 *    - Not already linked to another tool
 * 3. Prioritizes the newest matching permission
 * 4. Updates the permission message with tool execution details
 * 5. Falls back to creating a new tool message if no match
 *
 * ## Data Flow:
 *
 * Raw Messages → Normalizer → Reducer → Structured Messages
 *                              ↑
 *                         AgentState
 *
 * The reducer receives:
 * - Normalized messages from the sync system
 * - Current AgentState with permission information
 *
 * And produces:
 * - Structured Message objects for UI rendering
 * - Updated internal state for future processing
 */

import { AgentState } from '../storageTypes';
import { Message, ToolCall } from '../typesMessage';
import { MessageMeta } from '../typesMessageMeta';
import { AgentEvent, NormalizedMessage, UsageData } from '../typesRaw';
import { parseMessageAsEvent } from './messageToEvent';
import { createTracer, traceMessages, TracerState } from './reducerTracer';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/sync/reducer');

type ReducerMessage = {
  id: string;
  realID: string | null;
  seq?: number; // Server-assigned monotonic sequence number for stable sort
  createdAt: number;
  role: 'user' | 'agent';
  text: string | null;
  isThinking?: boolean;
  event: AgentEvent | null;
  tool: ToolCall | null;
  meta?: MessageMeta;
  traceId?: string;
  attachments?: Array<{ id: string; mimeType: string; thumbhash?: string; filename?: string }>;
};

type StoredPermission = {
  tool: string;
  arguments: any;
  createdAt: number;
  completedAt?: number;
  status: 'pending' | 'approved' | 'denied' | 'canceled';
  reason?: string;
  mode?: string;
  allowedTools?: string[];
  decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
};

export type ReducerState = {
  toolIdToMessageId: Map<string, string>; // toolId/permissionId -> messageId (since they're the same now)
  sidechainToolIdToMessageId: Map<string, string>; // toolId -> sidechain messageId (for dual tracking)
  permissions: Map<string, StoredPermission>; // Store permission details by ID for quick lookup
  processedIds: Map<string, string>;
  messageIds: Map<string, string>; // originalId -> internalId
  messages: Map<string, ReducerMessage>;
  rootMessageIds: string[];
  sidechains: Map<string, ReducerMessage[]>;
  tracerState: TracerState; // Tracer state for sidechain processing
  /** Number of tool calls currently in 'running' state. Recomputed at end of each reducer pass. */
  activeToolCallCount: number;
  latestTodos?: {
    todos: Array<{
      content: string;
      status: 'pending' | 'in_progress' | 'completed';
      priority: 'high' | 'medium' | 'low';
      id: string;
    }>;
    timestamp: number;
  };
  latestUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreation: number;
    cacheRead: number;
    contextSize: number;
    contextWindowSize?: number;
    timestamp: number;
  };
};

export function createReducer(): ReducerState {
  return {
    toolIdToMessageId: new Map(),
    sidechainToolIdToMessageId: new Map(),
    permissions: new Map(),
    messages: new Map(),
    rootMessageIds: [],
    processedIds: new Map(),
    messageIds: new Map(),
    sidechains: new Map(),
    tracerState: createTracer(),
    activeToolCallCount: 0,
  };
}

const ENABLE_LOGGING = false;
const STREAM_CHUNK_WINDOW_MS = 60_000;

export type ReducerResult = {
  messages: Message[];
  todos?: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'high' | 'medium' | 'low';
    id: string;
  }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreation: number;
    cacheRead: number;
    contextSize: number;
  };
  hasReadyEvent?: boolean;
  latestStatus?: 'working' | 'idle';
};

/**
 * Stable JSON serialization for arbitrary values.
 * Object keys are sorted recursively so that `{ b: 1, a: 2 }` and `{ a: 2, b: 1 }`
 * produce the same string. Used for content-based permission dedup.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const sorted = Object.keys(value as object)
    .sort()
    .map(k => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`);
  return '{' + sorted.join(',') + '}';
}

/**
 * Normalize tool result for permission-only tools.
 * When a permission tool's result is a raw `{ status, decision }` object from the backend,
 * replace it with a human-readable "Approved" string for consistent display across web/app.
 */
function normalizePermissionResult(
  hasPermission: boolean,
  content: unknown,
  isError: boolean
): unknown {
  if (
    hasPermission &&
    !isError &&
    content != null &&
    typeof content === 'object' &&
    'status' in content &&
    (content as Record<string, unknown>).status === 'approved' &&
    'decision' in content
  ) {
    return 'Approved';
  }
  return content;
}

function resolvePendingPermissionCreatedAt(
  request: { createdAt?: number | null },
  fallback: number
): number {
  return typeof request.createdAt === 'number' ? request.createdAt : fallback;
}

function resolveCompletedPermissionCreatedAt(
  completed: { createdAt?: number | null; completedAt?: number | null },
  fallback: number
): number {
  if (typeof completed.createdAt === 'number') return completed.createdAt;
  if (typeof completed.completedAt === 'number') return completed.completedAt;
  return fallback;
}

function resolveCompletedPermissionCompletedAt(
  completed: { completedAt?: number | null },
  fallback: number
): number {
  return typeof completed.completedAt === 'number' ? completed.completedAt : fallback;
}

export function reducer(
  state: ReducerState,
  messages: NormalizedMessage[],
  agentState?: AgentState | null
): ReducerResult {
  if (ENABLE_LOGGING) {
    logger.debug(
      `[REDUCER] Called with ${messages.length} messages, agentState: ${agentState ? 'YES' : 'NO'}`
    );
    if (agentState?.requests) {
      logger.debug(
        `[REDUCER] AgentState has ${Object.keys(agentState.requests).length} pending requests`
      );
    }
    if (agentState?.completedRequests) {
      logger.debug(
        `[REDUCER] AgentState has ${Object.keys(agentState.completedRequests).length} completed requests`
      );
    }
  }

  const newMessages: Message[] = [];
  const changed: Set<string> = new Set();
  let hasReadyEvent = false;
  let latestStatus: 'working' | 'idle' | undefined;

  // First, trace all messages to identify sidechains
  const tracedMessages = traceMessages(state.tracerState, messages);

  // Separate sidechain and non-sidechain messages
  let nonSidechainMessages = tracedMessages.filter(msg => !msg.sidechainId);
  const sidechainMessages = tracedMessages.filter(msg => msg.sidechainId);

  //
  // Phase 0.5: Message-to-Event Conversion
  // Convert certain messages to events before normal processing
  //

  if (ENABLE_LOGGING) {
    logger.debug(`[REDUCER] Phase 0.5: Message-to-Event Conversion`);
  }

  const messagesToProcess: NormalizedMessage[] = [];
  const convertedEvents: { message: NormalizedMessage; event: AgentEvent }[] = [];

  for (const msg of nonSidechainMessages) {
    // Check if we've already processed this message
    if (state.processedIds.has(msg.id)) {
      continue;
    }
    if (state.messageIds.has(msg.id)) {
      continue;
    }

    // Filter out ready events completely - they should not create any message
    if (msg.role === 'event' && msg.content.type === 'ready') {
      // Mark as processed to prevent duplication but don't add to messages
      state.messageIds.set(msg.id, msg.id);
      hasReadyEvent = true;
      continue;
    }

    if (msg.role === 'event' && msg.content.type === 'status') {
      state.messageIds.set(msg.id, msg.id);
      latestStatus = msg.content.state;
      continue;
    }

    // Session protocol turn-start markers are lifecycle-only and should stay invisible.
    if (
      msg.role === 'event' &&
      msg.content.type === 'message' &&
      msg.content.message === 'Turn started'
    ) {
      state.messageIds.set(msg.id, msg.id);
      continue;
    }

    // Handle context reset events - reset state and let the message be shown
    if (
      msg.role === 'event' &&
      msg.content.type === 'message' &&
      msg.content.message === 'Context was reset'
    ) {
      // Reset todos to empty array and reset usage to zero
      state.latestTodos = {
        todos: [],
        timestamp: msg.createdAt, // Use message timestamp, not current time
      };
      state.latestUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreation: 0,
        cacheRead: 0,
        contextSize: 0,
        timestamp: msg.createdAt, // Use message timestamp to avoid blocking older usage data
      };
      // Don't continue - let the event be processed normally to create a message
    }

    // Handle compaction completed events - reset context but keep todos
    if (
      msg.role === 'event' &&
      msg.content.type === 'message' &&
      msg.content.message === 'Compaction completed'
    ) {
      // Reset usage/context to zero but keep todos unchanged
      state.latestUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreation: 0,
        cacheRead: 0,
        contextSize: 0,
        timestamp: msg.createdAt, // Use message timestamp to avoid blocking older usage data
      };
      // Don't continue - let the event be processed normally to create a message
    }

    // Try to parse message as event
    const event = parseMessageAsEvent(msg);
    if (event) {
      if (ENABLE_LOGGING) {
        logger.debug(`[REDUCER] Converting message ${msg.id} to event:`, event);
      }
      convertedEvents.push({ message: msg, event });
      // Mark as processed to prevent duplication
      state.messageIds.set(msg.id, msg.id);
      state.processedIds.set(msg.id, msg.id);
    } else {
      messagesToProcess.push(msg);
    }
  }

  // Process converted events immediately
  for (const { message, event } of convertedEvents) {
    const mid = allocateId();
    storeRootMessage(state, {
      id: mid,
      realID: message.id,
      role: 'agent',
      createdAt: message.createdAt,
      event: event,
      tool: null,
      text: null,
      meta: message.meta,
    });
    changed.add(mid);
  }

  // Update nonSidechainMessages to only include messages that weren't converted
  nonSidechainMessages = messagesToProcess;

  // Build a set of incoming tool IDs for quick lookup
  const incomingToolIds = new Set<string>();
  for (const msg of nonSidechainMessages) {
    if (msg.role === 'agent') {
      for (const c of msg.content) {
        if (c.type === 'tool-call') {
          incomingToolIds.add(c.id);
        }
      }
    }
  }

  //
  // Phase 0: Process AgentState permissions
  //

  if (ENABLE_LOGGING) {
    logger.debug(`[REDUCER] Phase 0: Processing AgentState`);
  }
  if (agentState) {
    // Process pending permission requests
    if (agentState.requests) {
      for (const [permId, request] of Object.entries(agentState.requests)) {
        const requestCreatedAt = resolvePendingPermissionCreatedAt(request, Date.now());
        // Skip if this permission is also in completedRequests (completed takes precedence)
        if (agentState.completedRequests && agentState.completedRequests[permId]) {
          continue;
        }

        // Check if we already have a message for this permission ID
        const existingMessageId = state.toolIdToMessageId.get(permId);
        if (existingMessageId) {
          // Update existing tool message with permission info
          const message = state.messages.get(existingMessageId);
          if (message?.tool && !message.tool.permission) {
            if (ENABLE_LOGGING) {
              logger.debug(`[REDUCER] Updating existing tool ${permId} with permission`);
            }
            message.tool.permission = {
              id: permId,
              status: 'pending',
            };
            changed.add(existingMessageId);
          }
        } else {
          // Content-based dedup: check if a pending message already exists for the same
          // tool + arguments. This handles agents (e.g. Cursor) that emit a fresh random ID
          // for each request_permission call, so the same tool call doesn't appear twice.
          // stableStringify ensures key-order differences don't break the comparison.
          const requestArgKey = stableStringify(request.arguments);
          let dedupedMsgId: string | undefined;
          for (const [existingPermId, existingPerm] of state.permissions) {
            if (
              existingPerm.status === 'pending' &&
              existingPerm.tool === request.tool &&
              stableStringify(existingPerm.arguments) === requestArgKey
            ) {
              dedupedMsgId = state.toolIdToMessageId.get(existingPermId);
              break;
            }
          }

          if (dedupedMsgId) {
            // Reuse existing message — just alias the new permId to the same message
            if (ENABLE_LOGGING) {
              logger.debug(
                `[REDUCER] Dedup: aliasing permission ${permId} to existing message ${dedupedMsgId}`
              );
            }
            state.toolIdToMessageId.set(permId, dedupedMsgId);
          } else {
            if (ENABLE_LOGGING) {
              logger.debug(`[REDUCER] Creating new message for permission ${permId}`);
            }

            // Create a new tool message for the permission request
            const mid = allocateId();
            const toolCall: ToolCall = {
              name: request.tool,
              state: 'running' as const,
              input: request.arguments,
              createdAt: requestCreatedAt,
              startedAt: null,
              completedAt: null,
              description: null,
              result: undefined,
              permission: {
                id: permId,
                status: 'pending',
              },
            };

            storeRootMessage(state, {
              id: mid,
              realID: null,
              role: 'agent',
              createdAt: requestCreatedAt,
              text: null,
              tool: toolCall,
              event: null,
            });

            // Store by permission ID (which will match tool ID)
            state.toolIdToMessageId.set(permId, mid);

            changed.add(mid);
          }
        }

        // Store permission details for quick lookup
        state.permissions.set(permId, {
          tool: request.tool,
          arguments: request.arguments,
          createdAt: requestCreatedAt,
          status: 'pending',
        });
      }
    }

    // Process completed permission requests
    if (agentState.completedRequests) {
      for (const [permId, completed] of Object.entries(agentState.completedRequests)) {
        const completedCreatedAt = resolveCompletedPermissionCreatedAt(completed, Date.now());
        const completedCompletedAt = resolveCompletedPermissionCompletedAt(completed, Date.now());
        // Check if we have a message for this permission ID
        const messageId = state.toolIdToMessageId.get(permId);
        if (messageId) {
          const message = state.messages.get(messageId);
          if (message?.tool) {
            // Skip if tool has already started actual execution with approval
            if (message.tool.startedAt && message.tool.permission?.status === 'approved') {
              continue;
            }

            // Skip if permission already has date (came from tool result - preferred over agentState)
            if (message.tool.permission?.date) {
              continue;
            }

            // Check if we need to update ANY field
            const needsUpdate =
              message.tool.permission?.status !== completed.status ||
              message.tool.permission?.reason !== completed.reason ||
              message.tool.permission?.mode !== completed.mode ||
              message.tool.permission?.allowedTools !== completed.allowedTools ||
              message.tool.permission?.decision !== completed.decision;

            if (!needsUpdate) {
              continue;
            }

            let hasChanged = false;

            // Update permission status
            if (!message.tool.permission) {
              message.tool.permission = {
                id: permId,
                status: completed.status,
                mode: completed.mode || undefined,
                allowedTools: completed.allowedTools || undefined,
                decision: completed.decision || undefined,
                reason: completed.reason || undefined,
              };
              hasChanged = true;
            } else {
              // Update all fields
              message.tool.permission.status = completed.status;
              message.tool.permission.mode = completed.mode || undefined;
              message.tool.permission.allowedTools = completed.allowedTools || undefined;
              message.tool.permission.decision = completed.decision || undefined;
              if (completed.reason) {
                message.tool.permission.reason = completed.reason;
              }
              hasChanged = true;
            }

            // Update tool state based on permission status
            if (completed.status === 'approved') {
              if (
                message.tool.state !== 'completed' &&
                message.tool.state !== 'error' &&
                message.tool.state !== 'running'
              ) {
                message.tool.state = 'running';
                hasChanged = true;
              }
            } else {
              // denied or canceled
              if (message.tool.state !== 'error' && message.tool.state !== 'completed') {
                message.tool.state = 'error';
                message.tool.completedAt = completedCompletedAt;
                if (!message.tool.result && completed.reason) {
                  message.tool.result = { error: completed.reason };
                }
                hasChanged = true;
              }
            }

            // Update stored permission
            state.permissions.set(permId, {
              tool: completed.tool,
              arguments: completed.arguments,
              createdAt: completedCreatedAt,
              completedAt: typeof completed.completedAt === 'number' ? completed.completedAt : undefined,
              status: completed.status,
              reason: completed.reason || undefined,
              mode: completed.mode || undefined,
              allowedTools: completed.allowedTools || undefined,
              decision: completed.decision || undefined,
            });

            if (hasChanged) {
              changed.add(messageId);
            }
          }
        } else {
          // No existing message - check if tool ID is in incoming messages
          if (incomingToolIds.has(permId)) {
            if (ENABLE_LOGGING) {
              logger.debug(`[REDUCER] Storing permission ${permId} for incoming tool`);
            }
            // Store permission for when tool arrives in Phase 2
            state.permissions.set(permId, {
              tool: completed.tool,
              arguments: completed.arguments,
              createdAt: completedCreatedAt,
              completedAt: typeof completed.completedAt === 'number' ? completed.completedAt : undefined,
              status: completed.status,
              reason: completed.reason || undefined,
            });
            continue;
          }

          // Skip if already processed as pending
          if (agentState.requests && agentState.requests[permId]) {
            continue;
          }

          // Create a new message for completed permission without tool
          const mid = allocateId();
          const toolCall: ToolCall = {
            name: completed.tool,
            state: completed.status === 'approved' ? 'completed' : 'error',
            input: completed.arguments,
            createdAt: completedCreatedAt,
            startedAt: null,
            completedAt: completedCompletedAt,
            description: null,
            result:
              completed.status === 'approved'
                ? 'Approved'
                : completed.reason
                  ? { error: completed.reason }
                  : undefined,
            permission: {
              id: permId,
              status: completed.status,
              reason: completed.reason || undefined,
              mode: completed.mode || undefined,
              allowedTools: completed.allowedTools || undefined,
              decision: completed.decision || undefined,
            },
          };

          storeRootMessage(state, {
            id: mid,
            realID: null,
            role: 'agent',
            createdAt: completedCreatedAt,
            text: null,
            tool: toolCall,
            event: null,
          });

          state.toolIdToMessageId.set(permId, mid);

          // Store permission details
          state.permissions.set(permId, {
            tool: completed.tool,
            arguments: completed.arguments,
            createdAt: completedCreatedAt,
            completedAt: typeof completed.completedAt === 'number' ? completed.completedAt : undefined,
            status: completed.status,
            reason: completed.reason || undefined,
            mode: completed.mode || undefined,
            allowedTools: completed.allowedTools || undefined,
            decision: completed.decision || undefined,
          });

          changed.add(mid);
        }
      }
    }
  }

  //
  // Phase 1: Process non-sidechain user messages and text messages
  //
  // Tool-call boundary tracking: during batch loads, Phase 2 (which creates
  // tool-call roots) hasn't run yet. Without this flag, Phase 1 would merge
  // text from before and after tool calls into one block. The flag prevents
  // merging across tool-call boundaries even when no tool-call roots exist yet.
  //
  let toolCallSeenSinceLastText = false;

  for (const msg of nonSidechainMessages) {
    if (msg.role === 'user') {
      // Check if we've seen this message before
      if (state.processedIds.has(msg.id) || state.messageIds.has(msg.id)) {
        continue;
      }

      // Create a new message
      const mid = allocateId();
      storeRootMessage(state, {
        id: mid,
        realID: msg.id,
        seq: msg.seq,
        role: 'user',
        createdAt: msg.createdAt,
        text: msg.content.text,
        tool: null,
        event: null,
        meta: msg.meta,
        traceId: msg.traceId,
        ...(msg.content.attachments?.length && { attachments: msg.content.attachments }),
      });

      state.processedIds.set(msg.id, mid);
      state.messageIds.set(msg.id, mid);

      changed.add(mid);
      toolCallSeenSinceLastText = false;
    } else if (msg.role === 'agent') {
      // Check if we've seen this agent message before
      if (state.messageIds.has(msg.id)) {
        continue;
      }

      // Mark this message as seen
      state.messageIds.set(msg.id, msg.id);

      // Process usage data if present
      if (msg.usage) {
        processUsageData(state, msg.usage, msg.createdAt);
      }

      // Track tool-call/tool-result positions so text doesn't merge across them.
      // Both tool-call and tool-result are boundaries: tool-result handles the case
      // where tool-call was emitted in a previous reducer call or is missing entirely
      // (e.g. Claude ACP adapter emitting tool_call_update completions without a
      // preceding tool_call start event).
      for (const c of msg.content) {
        if (c.type === 'tool-call' || c.type === 'tool-result') {
          toolCallSeenSinceLastText = true;
        }
      }

      // Process text and thinking content (tool calls handled in Phase 2)
      for (const c of msg.content) {
        if (c.type === 'text' || c.type === 'thinking') {
          const isThinking = c.type === 'thinking';
          const chunkText = isThinking ? c.thinking : c.text;

          if (msg.content.length === 1 && !toolCallSeenSinceLastText) {
            const mergedIntoId = mergeIntoPreviousRootAgentText(state, msg.createdAt, chunkText, isThinking, msg.traceId);
            if (mergedIntoId) {
              // Diagnostic: log merges near tool boundaries
              if (messages.length > 50 && msg.seq !== undefined && msg.seq >= 100 && msg.seq <= 200) {
                const target = state.messages.get(mergedIntoId);
                logger.info(`[REDUCER] P1 MERGE seq=${msg.seq} ${isThinking?'K':'X'} into root seq=${target?.seq} ${target?.isThinking?'K':'X'}[${target?.text?.length}]`);
              }
              changed.add(mergedIntoId);
              continue;
            }
          }

          // Diagnostic: log root creation near tool boundaries
          if (messages.length > 50 && msg.seq !== undefined && msg.seq >= 100 && msg.seq <= 200) {
            logger.info(`[REDUCER] P1 NEW ROOT seq=${msg.seq} ${isThinking?'K':'X'} flag=${toolCallSeenSinceLastText} contentLen=${msg.content.length}`);
          }

          const mid = allocateId();
          storeRootMessage(state, {
            id: mid,
            realID: msg.id,
            seq: msg.seq,
            role: 'agent',
            createdAt: msg.createdAt,
            text: chunkText,
            isThinking,
            tool: null,
            event: null,
            meta: msg.meta,
            traceId: msg.traceId,
          });
          changed.add(mid);
          toolCallSeenSinceLastText = false;
        }
      }
    }
  }

  //
  // Phase 2: Process non-sidechain tool calls
  //

  if (ENABLE_LOGGING) {
    logger.debug(`[REDUCER] Phase 2: Processing tool calls`);
  }
  for (const msg of nonSidechainMessages) {
    if (msg.role === 'agent') {
      for (const c of msg.content) {
        if (c.type === 'tool-call') {
          // Direct lookup by tool ID (since permission ID = tool ID now)
          const existingMessageId = state.toolIdToMessageId.get(c.id);

          if (existingMessageId) {
            if (ENABLE_LOGGING) {
              logger.debug(`[REDUCER] Found existing message for tool ${c.id}`);
            }
            // Update existing message with tool execution details
            const message = state.messages.get(existingMessageId);
            if (message?.tool) {
              message.realID = msg.id;
              if (message.seq === undefined && msg.seq !== undefined) {
                message.seq = msg.seq;
              }
              if (!message.meta && msg.meta) {
                message.meta = msg.meta;
              }
              if (!message.traceId && msg.traceId) {
                message.traceId = msg.traceId;
              }
              if (message.createdAt > msg.createdAt) {
                message.createdAt = msg.createdAt;
              }
              if (message.tool.createdAt > msg.createdAt) {
                message.tool.createdAt = msg.createdAt;
              }
              message.tool.description = c.description;
              message.tool.startedAt = msg.createdAt;
              // If permission was approved and shown as completed (no tool), now it's running
              if (
                message.tool.permission?.status === 'approved' &&
                message.tool.state === 'completed'
              ) {
                message.tool.state = 'running';
                message.tool.completedAt = null;
                message.tool.result = undefined;
              }
              changed.add(existingMessageId);

              // Track TodoWrite tool inputs when updating existing messages
              if (
                message.tool.name === 'TodoWrite' &&
                message.tool.state === 'running' &&
                message.tool.input?.todos
              ) {
                // Only update if this is newer than existing todos
                if (!state.latestTodos || message.tool.createdAt > state.latestTodos.timestamp) {
                  state.latestTodos = {
                    todos: message.tool.input.todos,
                    timestamp: message.tool.createdAt,
                  };
                }
              }
            }
          } else {
            if (ENABLE_LOGGING) {
              logger.debug(`[REDUCER] Creating new message for tool ${c.id}`);
            }
            // Check if there's a stored permission for this tool
            const permission = state.permissions.get(c.id);

            const toolCall: ToolCall = {
              name: c.name,
              state: 'running' as const,
              input: permission ? permission.arguments : c.input, // Use permission args if available
              createdAt: permission ? permission.createdAt : msg.createdAt, // Use permission timestamp if available
              startedAt: msg.createdAt,
              completedAt: null,
              description: c.description,
              result: undefined,
            };

            // Add permission info if found
            if (permission) {
              if (ENABLE_LOGGING) {
                logger.debug(`[REDUCER] Found stored permission for tool ${c.id}`);
              }
              toolCall.permission = {
                id: c.id,
                status: permission.status,
                reason: permission.reason,
                mode: permission.mode,
                allowedTools: permission.allowedTools,
                decision: permission.decision,
              };

              // Update state based on permission status
              if (permission.status !== 'approved') {
                toolCall.state = 'error';
                toolCall.completedAt = permission.completedAt || msg.createdAt;
                if (permission.reason) {
                  toolCall.result = { error: permission.reason };
                }
              }
            }

            const mid = allocateId();
            storeRootMessage(state, {
              id: mid,
              realID: msg.id,
              seq: msg.seq,
              role: 'agent',
              createdAt: msg.createdAt,
              text: null,
              tool: toolCall,
              event: null,
              meta: msg.meta,
              traceId: msg.traceId,
            });

            state.toolIdToMessageId.set(c.id, mid);
            changed.add(mid);

            // Track TodoWrite tool inputs
            if (
              toolCall.name === 'TodoWrite' &&
              toolCall.state === 'running' &&
              toolCall.input?.todos
            ) {
              // Only update if this is newer than existing todos
              if (!state.latestTodos || toolCall.createdAt > state.latestTodos.timestamp) {
                state.latestTodos = {
                  todos: toolCall.input.todos,
                  timestamp: toolCall.createdAt,
                };
              }
            }
          }
        }
      }
    }
  }

  //
  // Phase 2.5: Re-sort rootMessageIds by seq/createdAt.
  //
  // Phase 1 inserts text roots, then Phase 2 inserts tool-call roots. This means
  // rootMessageIds follows Phase-processing order, not the original message sequence.
  // Re-sorting ensures tool-call roots appear between text roots at the correct position,
  // which is critical for Phase 5.5 (merge consecutive agent-texts) to correctly treat
  // tool-call roots as merge boundaries.
  //
  state.rootMessageIds.sort((a, b) => {
    const ma = state.messages.get(a);
    const mb = state.messages.get(b);
    if (!ma || !mb) return 0;
    // Prefer seq (server monotonic) for stable ordering; fall back to createdAt
    if (ma.seq !== undefined && mb.seq !== undefined) return ma.seq - mb.seq;
    return ma.createdAt - mb.createdAt;
  });

  // Diagnostic: dump Phase 2.5 sort result for debugging interleaving issues
  if (messages.length > 50) {
    const sortDiag = state.rootMessageIds.slice(0, 30).map(id => {
      const m = state.messages.get(id);
      if (!m) return '?';
      const kind = m.tool ? 'T' : m.text !== null ? 'X' : m.event ? 'E' : '?';
      return `${kind}:${m.seq ?? '-'}`;
    });
    logger.info(`[REDUCER] Phase2.5 roots(${state.rootMessageIds.length}): ${sortDiag.join(' ')}`);
  }

  //
  // Phase 3: Process non-sidechain tool results
  //

  for (const msg of nonSidechainMessages) {
    if (msg.role === 'agent') {
      for (const c of msg.content) {
        if (c.type === 'tool-result') {
          // Find the message containing this tool
          const messageId = state.toolIdToMessageId.get(c.tool_use_id);
          if (!messageId) {
            continue;
          }

          const message = state.messages.get(messageId);
          if (!message || !message.tool) {
            continue;
          }

          if (message.tool.state !== 'running') {
            // Allow late result updates: session tool-call-end sets state=completed with null result,
            // then the raw output tool_result arrives with actual data — accept it.
            if (
              message.tool.state === 'completed' &&
              message.tool.result == null &&
              c.content != null
            ) {
              message.tool.result = c.content;
              changed.add(messageId!);
            }
            continue;
          }

          // Update tool state and result
          message.tool.state = c.is_error ? 'error' : 'completed';
          message.tool.result = normalizePermissionResult(
            !!message.tool.permission,
            c.content,
            c.is_error
          );
          message.tool.completedAt = msg.createdAt;

          // Update permission data if provided by backend
          if (c.permissions) {
            // Merge with existing permission to preserve decision field from agentState
            if (message.tool.permission) {
              // Preserve existing decision if not provided in tool result
              const existingDecision = message.tool.permission.decision;
              message.tool.permission = {
                ...message.tool.permission,
                id: c.tool_use_id,
                status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                date: c.permissions.date,
                mode: c.permissions.mode,
                allowedTools: c.permissions.allowedTools,
                decision: c.permissions.decision || existingDecision,
              };
            } else {
              message.tool.permission = {
                id: c.tool_use_id,
                status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                date: c.permissions.date,
                mode: c.permissions.mode,
                allowedTools: c.permissions.allowedTools,
                decision: c.permissions.decision,
              };
            }
          }

          changed.add(messageId);
        }
      }
    }
  }

  //
  // Phase 4: Process sidechains and store them in state
  //

  // For each sidechain message, store it in the state and mark the Task as changed
  for (const msg of sidechainMessages) {
    if (!msg.sidechainId) continue;

    // Skip if we already processed this message
    if (state.messageIds.has(msg.id)) continue;

    // Mark as processed
    state.messageIds.set(msg.id, msg.id);

    // Get or create the sidechain array for this Task
    const existingSidechain = state.sidechains.get(msg.sidechainId) || [];

    // Process and add new sidechain messages
    if (msg.role === 'agent' && msg.content[0]?.type === 'sidechain') {
      // This is the sidechain root - create a user message
      const mid = allocateId();
      const userMsg: ReducerMessage = {
        id: mid,
        realID: msg.id,
        role: 'user',
        createdAt: msg.createdAt,
        text: msg.content[0].prompt,
        tool: null,
        event: null,
        meta: msg.meta,
      };
      state.messages.set(mid, userMsg);
      existingSidechain.push(userMsg);
    } else if (msg.role === 'agent') {
      // Process agent content in sidechain
      for (const c of msg.content) {
        if (c.type === 'text' || c.type === 'thinking') {
          const mid = allocateId();
          const isThinking = c.type === 'thinking';
          const textMsg: ReducerMessage = {
            id: mid,
            realID: msg.id,
            role: 'agent',
            createdAt: msg.createdAt,
            text: isThinking ? `*Thinking...*\n\n*${c.thinking}*` : c.text,
            isThinking,
            tool: null,
            event: null,
            meta: msg.meta,
          };
          state.messages.set(mid, textMsg);
          existingSidechain.push(textMsg);
        } else if (c.type === 'tool-call') {
          // Check if there's already a permission message for this tool
          const existingPermissionMessageId = state.toolIdToMessageId.get(c.id);

          const mid = allocateId();
          const toolCall: ToolCall = {
            name: c.name,
            state: 'running' as const,
            input: c.input,
            createdAt: msg.createdAt,
            startedAt: null,
            completedAt: null,
            description: c.description,
            result: undefined,
          };

          // If there's a permission message, copy its permission info
          if (existingPermissionMessageId) {
            const permissionMessage = state.messages.get(existingPermissionMessageId);
            if (permissionMessage?.tool?.permission) {
              toolCall.permission = { ...permissionMessage.tool.permission };
              // Update the permission message to show it's running
              if (
                permissionMessage.tool.state !== 'completed' &&
                permissionMessage.tool.state !== 'error'
              ) {
                permissionMessage.tool.state = 'running';
                permissionMessage.tool.startedAt = msg.createdAt;
                permissionMessage.tool.description = c.description;
                changed.add(existingPermissionMessageId);
              }
            }
          }

          const toolMsg: ReducerMessage = {
            id: mid,
            realID: msg.id,
            role: 'agent',
            createdAt: msg.createdAt,
            text: null,
            tool: toolCall,
            event: null,
            meta: msg.meta,
          };
          state.messages.set(mid, toolMsg);
          existingSidechain.push(toolMsg);

          // Map sidechain tool separately to avoid overwriting permission mapping
          state.sidechainToolIdToMessageId.set(c.id, mid);
        } else if (c.type === 'tool-result') {
          // Process tool result in sidechain - update BOTH messages

          // Update the sidechain tool message
          const sidechainMessageId = state.sidechainToolIdToMessageId.get(c.tool_use_id);
          if (sidechainMessageId) {
            const sidechainMessage = state.messages.get(sidechainMessageId);
            if (
              sidechainMessage &&
              sidechainMessage.tool &&
              sidechainMessage.tool.state === 'running'
            ) {
              sidechainMessage.tool.state = c.is_error ? 'error' : 'completed';
              sidechainMessage.tool.result = normalizePermissionResult(
                !!sidechainMessage.tool.permission,
                c.content,
                c.is_error
              );
              sidechainMessage.tool.completedAt = msg.createdAt;

              // Update permission data if provided by backend
              if (c.permissions) {
                // Merge with existing permission to preserve decision field from agentState
                if (sidechainMessage.tool.permission) {
                  const existingDecision = sidechainMessage.tool.permission.decision;
                  sidechainMessage.tool.permission = {
                    ...sidechainMessage.tool.permission,
                    id: c.tool_use_id,
                    status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                    date: c.permissions.date,
                    mode: c.permissions.mode,
                    allowedTools: c.permissions.allowedTools,
                    decision: c.permissions.decision || existingDecision,
                  };
                } else {
                  sidechainMessage.tool.permission = {
                    id: c.tool_use_id,
                    status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                    date: c.permissions.date,
                    mode: c.permissions.mode,
                    allowedTools: c.permissions.allowedTools,
                    decision: c.permissions.decision,
                  };
                }
              }
            }
          }

          // Also update the main permission message if it exists
          const permissionMessageId = state.toolIdToMessageId.get(c.tool_use_id);
          if (permissionMessageId) {
            const permissionMessage = state.messages.get(permissionMessageId);
            if (
              permissionMessage &&
              permissionMessage.tool &&
              permissionMessage.tool.state === 'running'
            ) {
              permissionMessage.tool.state = c.is_error ? 'error' : 'completed';
              permissionMessage.tool.result = normalizePermissionResult(
                !!permissionMessage.tool.permission,
                c.content,
                c.is_error
              );
              permissionMessage.tool.completedAt = msg.createdAt;

              // Update permission data if provided by backend
              if (c.permissions) {
                // Merge with existing permission to preserve decision field from agentState
                if (permissionMessage.tool.permission) {
                  const existingDecision = permissionMessage.tool.permission.decision;
                  permissionMessage.tool.permission = {
                    ...permissionMessage.tool.permission,
                    id: c.tool_use_id,
                    status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                    date: c.permissions.date,
                    mode: c.permissions.mode,
                    allowedTools: c.permissions.allowedTools,
                    decision: c.permissions.decision || existingDecision,
                  };
                } else {
                  permissionMessage.tool.permission = {
                    id: c.tool_use_id,
                    status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                    date: c.permissions.date,
                    mode: c.permissions.mode,
                    allowedTools: c.permissions.allowedTools,
                    decision: c.permissions.decision,
                  };
                }
              }

              changed.add(permissionMessageId);
            }
          }
        }
      }
    }

    // Update the sidechain in state
    state.sidechains.set(msg.sidechainId, existingSidechain);

    // Find the Task tool message that owns this sidechain and mark it as changed
    // msg.sidechainId is the realID of the Task message
    for (const [internalId, message] of state.messages) {
      if (message.realID === msg.sidechainId && message.tool) {
        changed.add(internalId);
        break;
      }
    }
  }

  //
  // Phase 5: Process mode-switch messages
  //

  for (const msg of nonSidechainMessages) {
    if (msg.role === 'event') {
      const mid = allocateId();
      storeRootMessage(state, {
        id: mid,
        realID: msg.id,
        seq: msg.seq,
        role: 'agent',
        createdAt: msg.createdAt,
        event: msg.content,
        tool: null,
        text: null,
        meta: msg.meta,
      });
      changed.add(mid);
    }
  }

  //
  // Phase 5.5: Post-processing merge of consecutive agent-text messages
  //
  // Streaming text chunks from the ACP backend arrive as separate NormalizedMessages.
  // When they land in different reducer calls, consecutive text chunks that belong to
  // the same text segment may end up as separate root messages. This pass scans
  // rootMessageIds for adjacent agent-text blocks that should be one message
  // (same isThinking, compatible traceId, within the streaming window) and merges them.
  // Tool-call roots are merge boundaries — text never merges across tool calls.
  //

  mergeConsecutiveAgentTexts(state, changed);

  // Diagnostic: dump post-Phase 5.5 state with text length to spot over-merging
  if (messages.length > 50) {
    const postDiag = state.rootMessageIds.map(id => {
      const m = state.messages.get(id);
      if (!m) return '?';
      if (m.tool) return `T:${m.seq ?? '-'}`;
      if (m.text !== null) return `${m.isThinking ? 'K' : 'X'}:${m.seq ?? '-'}[${m.text.length}]`;
      if (m.event) return `E:${m.seq ?? '-'}`;
      return `?:${m.seq ?? '-'}`;
    });
    logger.info(`[REDUCER] Phase5.5 ALL roots(${postDiag.length}): ${postDiag.join(' ')}`);
  }

  //
  // Collect changed messages (only root-level messages)
  //

  for (const id of changed) {
    const existing = state.messages.get(id);
    if (!existing) continue;

    const message = convertReducerMessageToMessage(existing, state);
    if (message) {
      newMessages.push(message);
    }
  }

  //
  // Debug changes
  //

  if (ENABLE_LOGGING) {
    logger.debug(JSON.stringify(messages, null, 2));
    logger.debug(`[REDUCER] Changed messages: ${changed.size}`);
  }

  // Recount running tool calls so useSessionStatus can distinguish tool_running from thinking.
  let runningCount = 0;
  for (const [, msg] of state.messages) {
    if (msg.tool?.state === 'running') runningCount++;
  }
  state.activeToolCallCount = runningCount;

  return {
    messages: newMessages,
    todos: state.latestTodos?.todos,
    usage: state.latestUsage
      ? {
          inputTokens: state.latestUsage.inputTokens,
          outputTokens: state.latestUsage.outputTokens,
          cacheCreation: state.latestUsage.cacheCreation,
          cacheRead: state.latestUsage.cacheRead,
          contextSize: state.latestUsage.contextSize,
          contextWindowSize: state.latestUsage.contextWindowSize,
        }
      : undefined,
    hasReadyEvent: hasReadyEvent || undefined,
    latestStatus,
  };
}

//
// Helpers
//

function allocateId() {
  return Math.random().toString(36).substring(2, 15);
}

function processUsageData(state: ReducerState, usage: UsageData, timestamp: number) {
  // Only update if this is newer than the current latest usage
  if (!state.latestUsage || timestamp > state.latestUsage.timestamp) {
    state.latestUsage = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreation: usage.cache_creation_input_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      contextSize:
        usage.context_used_tokens ??
        (usage.cache_creation_input_tokens || 0) +
          (usage.cache_read_input_tokens || 0) +
          usage.input_tokens,
      contextWindowSize: usage.context_window_size,
      timestamp: timestamp,
    };
  }
}

function storeRootMessage(state: ReducerState, message: ReducerMessage) {
  state.messages.set(message.id, message);
  state.rootMessageIds.push(message.id);
}

function getLastRootMessage(state: ReducerState): ReducerMessage | null {
  const lastRootMessageId = state.rootMessageIds.at(-1);
  if (!lastRootMessageId) return null;
  return state.messages.get(lastRootMessageId) ?? null;
}

/**
 * Post-processing: merge consecutive agent text/thinking root messages that
 * should be one block.
 *
 * Two adjacent agent roots are mergeable when:
 * - same isThinking flag (both text or both thinking)
 * - compatible traceId (both undefined, or same value)
 * - second message's createdAt is within STREAM_CHUNK_WINDOW_MS of the first
 * - different realID (from different streaming chunks, not same source message)
 * - no tool-call root between them (tool calls are always merge boundaries)
 *
 * When merged, the second message's text is appended to the first and the second
 * is removed from rootMessageIds (and state.messages).
 */
function mergeConsecutiveAgentTexts(state: ReducerState, changed: Set<string>): void {
  let i = 0;
  while (i < state.rootMessageIds.length - 1) {
    const currentId = state.rootMessageIds[i];
    const current = state.messages.get(currentId);

    // Only consider text or thinking agent roots (skip tools, events, non-text)
    if (
      !current ||
      current.role !== 'agent' ||
      current.text === null ||
      current.tool ||
      current.event
    ) {
      i++;
      continue;
    }

    // Look at the immediately next root
    const j = i + 1;
    if (j >= state.rootMessageIds.length) {
      i++;
      continue;
    }

    const nextId = state.rootMessageIds[j];
    const next = state.messages.get(nextId);

    if (
      next &&
      next.role === 'agent' &&
      next.text !== null &&
      !next.tool &&
      !next.event &&
      // Same type: both thinking or both non-thinking
      next.isThinking === current.isThinking &&
      // Only merge chunks from DIFFERENT source messages (streaming chunks).
      // Multiple text blocks within a single agent message (same realID) are
      // intentionally separate and must not be merged.
      current.realID !== next.realID &&
      next.createdAt >= current.createdAt &&
      next.createdAt - current.createdAt <= STREAM_CHUNK_WINDOW_MS &&
      !(current.traceId && next.traceId && current.traceId !== next.traceId)
    ) {
      // Merge next into current
      current.text += next.text;
      changed.add(currentId);
      state.rootMessageIds.splice(j, 1);
      state.messages.delete(nextId);
      changed.delete(nextId);
      // Don't increment i — check the new j against the merged current
    } else {
      i++;
    }
  }
}

/**
 * Try to merge a text/thinking chunk into a previous root agent-text message.
 * Returns the internal ID of the root message that was merged into, or null if
 * no suitable merge target was found.
 *
 * Walks backwards through rootMessageIds, skipping over thinking root messages
 * that may have been interleaved by the ACP backend during streaming (e.g.
 * agent_thought_chunk between agent_message_chunk updates).
 */
function mergeIntoPreviousRootAgentText(
  state: ReducerState,
  createdAt: number,
  chunkText: string,
  isThinking: boolean,
  traceId?: string
): string | null {
  for (let i = state.rootMessageIds.length - 1; i >= 0; i--) {
    const rootId = state.rootMessageIds[i];
    const candidate = state.messages.get(rootId);
    if (!candidate) break;

    // Thinking root messages are always merge boundaries.
    // Text must not merge across thinking blocks — they represent distinct content segments.
    if (candidate.role === 'agent' && candidate.text !== null && candidate.isThinking && !isThinking) {
      return null;
    }

    // Tool call roots are always merge boundaries.
    // Text after a tool call must be a separate block so tool cards render
    // interleaved with text, not stacked at the bottom.
    if (candidate.role === 'agent' && candidate.tool !== null) {
      return null;
    }

    // Found a non-thinking, non-tool root: check if it's compatible for merge
    if (candidate.role !== 'agent' || candidate.text === null || candidate.event) {
      return null;
    }
    if (Boolean(candidate.isThinking) !== isThinking) return null;
    if (createdAt < candidate.createdAt) return null;
    if (createdAt - candidate.createdAt > STREAM_CHUNK_WINDOW_MS) return null;
    if (candidate.traceId && traceId && candidate.traceId !== traceId) return null;

    candidate.text += chunkText;
    return rootId;
  }
  return null;
}

function convertReducerMessageToMessage(
  reducerMsg: ReducerMessage,
  state: ReducerState
): Message | null {
  if (reducerMsg.role === 'user' && reducerMsg.text !== null) {
    return {
      id: reducerMsg.id,
      ...(reducerMsg.seq !== undefined && { seq: reducerMsg.seq }),
      createdAt: reducerMsg.createdAt,
      kind: 'user-text',
      text: reducerMsg.text,
      ...(reducerMsg.meta?.displayText && { displayText: reducerMsg.meta.displayText }),
      ...(reducerMsg.attachments?.length && { attachments: reducerMsg.attachments }),
      meta: reducerMsg.meta,
      ...(reducerMsg.traceId && { traceId: reducerMsg.traceId }),
    };
  } else if (reducerMsg.role === 'agent' && reducerMsg.text !== null) {
    return {
      id: reducerMsg.id,
      ...(reducerMsg.seq !== undefined && { seq: reducerMsg.seq }),
      ...(reducerMsg.realID ? { sourceId: reducerMsg.realID } : {}),
      createdAt: reducerMsg.createdAt,
      kind: 'agent-text',
      text: reducerMsg.isThinking ? `*Thinking...*\n\n*${reducerMsg.text}*` : reducerMsg.text,
      ...(reducerMsg.isThinking && { isThinking: true }),
      meta: reducerMsg.meta,
      ...(reducerMsg.traceId && { traceId: reducerMsg.traceId }),
    };
  } else if (reducerMsg.role === 'agent' && reducerMsg.tool !== null) {
    // Convert children recursively
    const childMessages: Message[] = [];
    const children = reducerMsg.realID ? state.sidechains.get(reducerMsg.realID) || [] : [];
    for (const child of children) {
      const childMessage = convertReducerMessageToMessage(child, state);
      if (childMessage) {
        childMessages.push(childMessage);
      }
    }

    return {
      id: reducerMsg.id,
      ...(reducerMsg.seq !== undefined && { seq: reducerMsg.seq }),
      createdAt: reducerMsg.createdAt,
      kind: 'tool-call',
      tool: { ...reducerMsg.tool },
      children: childMessages,
      meta: reducerMsg.meta,
      ...(reducerMsg.traceId && { traceId: reducerMsg.traceId }),
    };
  } else if (reducerMsg.role === 'agent' && reducerMsg.event !== null) {
    return {
      id: reducerMsg.id,
      ...(reducerMsg.seq !== undefined && { seq: reducerMsg.seq }),
      createdAt: reducerMsg.createdAt,
      kind: 'agent-event',
      event: reducerMsg.event,
      meta: reducerMsg.meta,
    };
  }

  return null;
}
