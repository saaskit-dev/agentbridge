/**
 * @agentbridge/protocol - Message Reducer
 *
 * Core message processing engine that transforms raw messages into
 * structured, deduplicated message history.
 *
 * Based on happy's 6-phase reducer pattern.
 */

import type { Message, ToolCall, AgentEvent } from '@agentbridge/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Raw usage data from API (snake_case)
 */
export interface RawUsageData {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  service_tier?: string;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Normalized message content types
 */
export type NormalizedContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool-call'; id: string; name: string; input: Record<string, unknown>; description?: string }
  | { type: 'tool-result'; tool_use_id: string; content: unknown; is_error?: boolean; permissions?: ToolResultPermissions }
  | { type: 'sidechain'; prompt: string }
  | { type: 'ready' }
  | { type: 'event'; event: AgentEvent };

/**
 * Tool result permissions
 */
export interface ToolResultPermissions {
  date: number;
  mode?: string;
  result: 'approved' | 'denied';
  allowedTools?: string[];
  decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

/**
 * Normalized message from any provider
 */
export interface NormalizedMessage {
  id: string;
  localId?: string;
  createdAt: number;
  role: 'user' | 'agent' | 'event';
  content: NormalizedContent[];
  usage?: RawUsageData;
  meta?: MessageMeta;
  isSidechain?: boolean;
  sidechainId?: string;
}

/**
 * Message metadata
 */
export interface MessageMeta {
  sentFrom?: string;
  permissionMode?: string;
  model?: string;
  displayText?: string;
}

/**
 * Stored permission info
 */
interface StoredPermission {
  tool: string;
  arguments: Record<string, unknown>;
  createdAt: number;
  completedAt?: number;
  status: 'pending' | 'approved' | 'denied' | 'canceled';
  reason?: string;
  mode?: string;
  allowedTools?: string[];
  decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

/**
 * Internal reducer message
 */
interface ReducerMessage {
  id: string;
  realID: string | null;
  createdAt: number;
  role: 'user' | 'agent';
  text: string | null;
  isThinking?: boolean;
  event: AgentEvent | null;
  tool: ToolCall | null;
  meta?: MessageMeta;
}

/**
 * Permission request from agent state
 */
export interface PermissionRequest {
  tool: string;
  arguments: Record<string, unknown>;
  createdAt: number;
}

/**
 * Completed permission request
 */
export interface CompletedRequest {
  tool: string;
  arguments: Record<string, unknown>;
  createdAt: number;
  completedAt?: number;
  status: 'approved' | 'denied' | 'canceled';
  reason?: string;
  mode?: string;
  allowedTools?: string[];
  decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

/**
 * Agent state for permission management
 */
export interface AgentState {
  requests?: Record<string, PermissionRequest>;
  completedRequests?: Record<string, CompletedRequest>;
  controlledByUser?: boolean;
}

/**
 * Reducer state - maintains all mappings across calls
 */
export interface ReducerState {
  /** Tool ID / Permission ID -> Message ID */
  toolIdToMessageId: Map<string, string>;
  /** Sidechain tool ID -> Message ID */
  sidechainToolIdToMessageId: Map<string, string>;
  /** Permission ID -> Permission details */
  permissions: Map<string, StoredPermission>;
  /** Local ID -> Message ID (for deduplication) */
  localIds: Map<string, string>;
  /** Original ID -> Internal ID */
  messageIds: Map<string, string>;
  /** Message ID -> Message */
  messages: Map<string, ReducerMessage>;
  /** Sidechain ID -> Messages */
  sidechains: Map<string, ReducerMessage[]>;
  /** Latest todos from TodoWrite tool */
  latestTodos?: {
    todos: Array<{
      content: string;
      status: 'pending' | 'in_progress' | 'completed';
      priority: 'high' | 'medium' | 'low';
      id: string;
    }>;
    timestamp: number;
  };
  /** Latest usage data */
  latestUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreation: number;
    cacheRead: number;
    contextSize: number;
    timestamp: number;
  };
}

/**
 * Reducer result
 */
export interface ReducerResult {
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
}

// ============================================================================
// Reducer Factory
// ============================================================================

/**
 * Create a new reducer state
 */
export function createReducer(): ReducerState {
  return {
    toolIdToMessageId: new Map(),
    sidechainToolIdToMessageId: new Map(),
    permissions: new Map(),
    messages: new Map(),
    localIds: new Map(),
    messageIds: new Map(),
    sidechains: new Map(),
  };
}

// ============================================================================
// Main Reducer Function
// ============================================================================

/**
 * Process normalized messages and return structured messages
 *
 * Processing phases:
 * - Phase 0: AgentState Permissions
 * - Phase 0.5: Message-to-Event Conversion
 * - Phase 1: User and Text Messages
 * - Phase 2: Tool Calls
 * - Phase 3: Tool Results
 * - Phase 4: Sidechains
 * - Phase 5: Mode Switch Events
 */
export function reducer(
  state: ReducerState,
  messages: NormalizedMessage[],
  agentState?: AgentState | null
): ReducerResult {
  const newMessages: Message[] = [];
  const changed: Set<string> = new Set();
  let hasReadyEvent = false;

  // Separate sidechain and non-sidechain messages
  const nonSidechainMessages = messages.filter(msg => !msg.sidechainId);
  const sidechainMessages = messages.filter(msg => msg.sidechainId);

  //
  // Phase 0.5: Message-to-Event Conversion
  //

  const messagesToProcess: NormalizedMessage[] = [];
  const convertedEvents: { message: NormalizedMessage; event: AgentEvent }[] = [];

  for (const msg of nonSidechainMessages) {
    // Check for duplicates
    if (msg.role === 'user' && msg.localId && state.localIds.has(msg.localId)) {
      continue;
    }
    if (state.messageIds.has(msg.id)) {
      continue;
    }

    // Filter out ready events
    if (msg.role === 'event') {
      const eventContent = msg.content[0];
      if (eventContent && 'type' in eventContent && eventContent.type === 'ready') {
        state.messageIds.set(msg.id, msg.id);
        hasReadyEvent = true;
        continue;
      }
    }

    // Try to parse message as event
    const event = parseMessageAsEvent(msg);
    if (event) {
      convertedEvents.push({ message: msg, event });
      state.messageIds.set(msg.id, msg.id);
      if (msg.role === 'user' && msg.localId) {
        state.localIds.set(msg.localId, msg.id);
      }
    } else {
      messagesToProcess.push(msg);
    }
  }

  // Process converted events
  for (const { message, event } of convertedEvents) {
    const mid = allocateId();
    state.messages.set(mid, {
      id: mid,
      realID: message.id,
      role: 'agent',
      createdAt: message.createdAt,
      event,
      tool: null,
      text: null,
      meta: message.meta,
    });
    changed.add(mid);
  }

  // Update messages list
  const filteredMessages = messagesToProcess;

  // Build incoming tool IDs
  const incomingToolIds = new Set<string>();
  for (const msg of filteredMessages) {
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

  if (agentState) {
    // Process pending requests
    if (agentState.requests) {
      for (const [permId, request] of Object.entries(agentState.requests)) {
        if (agentState.completedRequests?.[permId]) continue;

        const existingMessageId = state.toolIdToMessageId.get(permId);
        if (existingMessageId) {
          const message = state.messages.get(existingMessageId);
          if (message?.tool && !message.tool.permission) {
            message.tool.permission = {
              id: permId,
              status: 'pending',
            };
            changed.add(existingMessageId);
          }
        } else {
          const mid = allocateId();
          const toolCall: ToolCall = {
            name: request.tool,
            state: 'running',
            input: request.arguments,
            createdAt: request.createdAt || Date.now(),
            startedAt: null,
            completedAt: null,
            description: null,
            result: null,
            permission: { id: permId, status: 'pending' },
          };

          state.messages.set(mid, {
            id: mid,
            realID: null,
            role: 'agent',
            createdAt: request.createdAt || Date.now(),
            text: null,
            tool: toolCall,
            event: null,
          });

          state.toolIdToMessageId.set(permId, mid);
          state.permissions.set(permId, {
            tool: request.tool,
            arguments: request.arguments,
            createdAt: request.createdAt || Date.now(),
            status: 'pending',
          });
          changed.add(mid);
        }
      }
    }

    // Process completed requests
    if (agentState.completedRequests) {
      for (const [permId, completed] of Object.entries(agentState.completedRequests)) {
        const messageId = state.toolIdToMessageId.get(permId);
        if (messageId) {
          const message = state.messages.get(messageId);
          if (message?.tool) {
            if (message.tool.startedAt && message.tool.permission?.status === 'approved') {
              continue;
            }

            const needsUpdate =
              message.tool.permission?.status !== completed.status ||
              message.tool.permission?.reason !== completed.reason;

            if (needsUpdate) {
              message.tool.permission = {
                id: permId,
                status: completed.status,
                mode: completed.mode,
                allowedTools: completed.allowedTools,
                decision: completed.decision,
                reason: completed.reason,
              };

              if (completed.status === 'approved') {
                if (message.tool.state !== 'completed' && message.tool.state !== 'error') {
                  message.tool.state = 'running';
                }
              } else {
                message.tool.state = 'error';
                message.tool.completedAt = completed.completedAt || Date.now();
                if (!message.tool.result && completed.reason) {
                  message.tool.result = { error: completed.reason };
                }
              }
              changed.add(messageId);
            }
          }
        } else if (!incomingToolIds.has(permId) && !agentState.requests?.[permId]) {
          // Create message for completed permission without tool
          const mid = allocateId();
          const toolCall: ToolCall = {
            name: completed.tool,
            state: completed.status === 'approved' ? 'completed' : 'error',
            input: completed.arguments,
            createdAt: completed.createdAt || Date.now(),
            startedAt: null,
            completedAt: completed.completedAt || Date.now(),
            description: null,
            result: completed.status === 'approved' ? 'Approved' : { error: completed.reason },
            permission: {
              id: permId,
              status: completed.status,
              mode: completed.mode,
              allowedTools: completed.allowedTools,
              decision: completed.decision,
              reason: completed.reason,
            },
          };

          state.messages.set(mid, {
            id: mid,
            realID: null,
            role: 'agent',
            createdAt: completed.createdAt || Date.now(),
            text: null,
            tool: toolCall,
            event: null,
          });
          state.toolIdToMessageId.set(permId, mid);
          changed.add(mid);
        }
      }
    }
  }

  //
  // Phase 1: Process user messages and text messages
  //

  for (const msg of filteredMessages) {
    if (msg.role === 'user') {
      if (msg.localId && state.localIds.has(msg.localId)) continue;
      if (state.messageIds.has(msg.id)) continue;

      const mid = allocateId();
      state.messages.set(mid, {
        id: mid,
        realID: msg.id,
        role: 'user',
        createdAt: msg.createdAt,
        text: (msg.content[0] as { text?: string })?.text || null,
        tool: null,
        event: null,
        meta: msg.meta,
      });

      if (msg.localId) state.localIds.set(msg.localId, mid);
      state.messageIds.set(msg.id, mid);
      changed.add(mid);
    } else if (msg.role === 'agent') {
      if (state.messageIds.has(msg.id)) continue;
      state.messageIds.set(msg.id, msg.id);

      // Process usage data
      if (msg.usage) {
        processUsageData(state, msg.usage, msg.createdAt);
      }

      // Process text and thinking content
      for (const c of msg.content) {
        if (c.type === 'text' || c.type === 'thinking') {
          const mid = allocateId();
          const isThinking = c.type === 'thinking';
          state.messages.set(mid, {
            id: mid,
            realID: msg.id,
            role: 'agent',
            createdAt: msg.createdAt,
            text: isThinking ? `*Thinking...*\n\n*${(c as { thinking: string }).thinking}*` : (c as { text: string }).text,
            isThinking,
            tool: null,
            event: null,
            meta: msg.meta,
          });
          changed.add(mid);
        }
      }
    }
  }

  //
  // Phase 2: Process tool calls
  //

  for (const msg of filteredMessages) {
    if (msg.role === 'agent') {
      for (const c of msg.content) {
        if (c.type === 'tool-call') {
          const existingMessageId = state.toolIdToMessageId.get(c.id);

          if (existingMessageId) {
            const message = state.messages.get(existingMessageId);
            if (message?.tool) {
              message.realID = msg.id;
              message.tool.description = c.description || null;
              message.tool.startedAt = msg.createdAt;
              if (message.tool.permission?.status === 'approved' && message.tool.state === 'completed') {
                message.tool.state = 'running';
                message.tool.completedAt = null;
                message.tool.result = null;
              }
              changed.add(existingMessageId);
            }
          } else {
            const permission = state.permissions.get(c.id);
            const toolCall: ToolCall = {
              name: c.name,
              state: 'running',
              input: permission?.arguments ?? c.input,
              createdAt: permission?.createdAt ?? msg.createdAt,
              startedAt: msg.createdAt,
              completedAt: null,
              description: c.description || null,
              result: null,
            };

            if (permission) {
              toolCall.permission = {
                id: c.id,
                status: permission.status,
                reason: permission.reason,
                mode: permission.mode,
                allowedTools: permission.allowedTools,
                decision: permission.decision,
              };
              if (permission.status !== 'approved') {
                toolCall.state = 'error';
                toolCall.completedAt = permission.completedAt || msg.createdAt;
                if (permission.reason) {
                  toolCall.result = { error: permission.reason };
                }
              }
            }

            const mid = allocateId();
            state.messages.set(mid, {
              id: mid,
              realID: msg.id,
              role: 'agent',
              createdAt: msg.createdAt,
              text: null,
              tool: toolCall,
              event: null,
              meta: msg.meta,
            });
            state.toolIdToMessageId.set(c.id, mid);
            changed.add(mid);
          }
        }
      }
    }
  }

  //
  // Phase 3: Process tool results
  //

  for (const msg of filteredMessages) {
    if (msg.role === 'agent') {
      for (const c of msg.content) {
        if (c.type === 'tool-result') {
          const messageId = state.toolIdToMessageId.get(c.tool_use_id);
          if (!messageId) continue;

          const message = state.messages.get(messageId);
          if (!message?.tool || message.tool.state !== 'running') continue;

          message.tool.state = c.is_error ? 'error' : 'completed';
          message.tool.result = c.content;
          message.tool.completedAt = msg.createdAt;

          if (c.permissions) {
            message.tool.permission = {
              ...message.tool.permission,
              id: c.tool_use_id,
              status: c.permissions.result === 'approved' ? 'approved' : 'denied',
              date: c.permissions.date,
              mode: c.permissions.mode,
              allowedTools: c.permissions.allowedTools,
              decision: c.permissions.decision,
            };
          }
          changed.add(messageId);
        }
      }
    }
  }

  //
  // Phase 4: Process sidechains
  //

  for (const msg of sidechainMessages) {
    if (!msg.sidechainId) continue;
    if (state.messageIds.has(msg.id)) continue;
    state.messageIds.set(msg.id, msg.id);

    const existingSidechain = state.sidechains.get(msg.sidechainId) || [];

    if (msg.role === 'agent' && msg.content[0]?.type === 'sidechain') {
      const mid = allocateId();
      const userMsg: ReducerMessage = {
        id: mid,
        realID: msg.id,
        role: 'user',
        createdAt: msg.createdAt,
        text: (msg.content[0] as { prompt: string }).prompt,
        tool: null,
        event: null,
        meta: msg.meta,
      };
      state.messages.set(mid, userMsg);
      existingSidechain.push(userMsg);
    } else if (msg.role === 'agent') {
      for (const c of msg.content) {
        if (c.type === 'text' || c.type === 'thinking') {
          const mid = allocateId();
          const isThinking = c.type === 'thinking';
          const textMsg: ReducerMessage = {
            id: mid,
            realID: msg.id,
            role: 'agent',
            createdAt: msg.createdAt,
            text: isThinking ? `*Thinking...*\n\n*${(c as { thinking: string }).thinking}*` : (c as { text: string }).text,
            isThinking,
            tool: null,
            event: null,
            meta: msg.meta,
          };
          state.messages.set(mid, textMsg);
          existingSidechain.push(textMsg);
        } else if (c.type === 'tool-call') {
          const mid = allocateId();
          const toolCall: ToolCall = {
            name: c.name,
            state: 'running',
            input: c.input,
            createdAt: msg.createdAt,
            startedAt: null,
            completedAt: null,
            description: c.description || null,
            result: null,
          };

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
          state.sidechainToolIdToMessageId.set(c.id, mid);
        }
      }
    }

    state.sidechains.set(msg.sidechainId, existingSidechain);

    // Mark parent Task as changed
    for (const [internalId, message] of state.messages) {
      if (message.realID === msg.sidechainId && message.tool) {
        changed.add(internalId);
        break;
      }
    }
  }

  //
  // Phase 5: Process mode-switch events
  //

  for (const msg of filteredMessages) {
    if (msg.role === 'event') {
      const eventContent = msg.content[0] as unknown as AgentEvent | undefined;
      if (eventContent) {
        const mid = allocateId();
        state.messages.set(mid, {
          id: mid,
          realID: msg.id,
          role: 'agent',
          createdAt: msg.createdAt,
          event: eventContent,
          tool: null,
          text: null,
          meta: msg.meta,
        });
        changed.add(mid);
      }
    }
  }

  //
  // Collect changed messages
  //

  for (const id of changed) {
    const existing = state.messages.get(id);
    if (!existing) continue;

    const message = convertReducerMessageToMessage(existing, state);
    if (message) {
      newMessages.push(message);
    }
  }

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
        }
      : undefined,
    hasReadyEvent: hasReadyEvent || undefined,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function allocateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function processUsageData(state: ReducerState, usage: RawUsageData, timestamp: number): void {
  if (!state.latestUsage || timestamp > state.latestUsage.timestamp) {
    state.latestUsage = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreation: usage.cache_creation_input_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      contextSize:
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0) +
        usage.input_tokens,
      timestamp,
    };
  }
}

function convertReducerMessageToMessage(
  reducerMsg: ReducerMessage,
  state: ReducerState
): Message | null {
  if (reducerMsg.role === 'user' && reducerMsg.text !== null) {
    return {
      id: reducerMsg.id,
      localId: null,
      createdAt: reducerMsg.createdAt,
      kind: 'user-text',
      text: reducerMsg.text,
      displayText: reducerMsg.meta?.displayText,
    };
  } else if (reducerMsg.role === 'agent' && reducerMsg.text !== null) {
    const result: Message = {
      id: reducerMsg.id,
      localId: null,
      createdAt: reducerMsg.createdAt,
      kind: 'agent-text',
      text: reducerMsg.text,
    };
    if (reducerMsg.isThinking) {
      (result as { isThinking?: boolean }).isThinking = true;
    }
    return result;
  } else if (reducerMsg.role === 'agent' && reducerMsg.tool !== null) {
    // Convert children
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
      localId: null,
      createdAt: reducerMsg.createdAt,
      kind: 'tool-call',
      tool: { ...reducerMsg.tool },
      children: childMessages,
    };
  } else if (reducerMsg.role === 'agent' && reducerMsg.event !== null) {
    return {
      id: reducerMsg.id,
      localId: null,
      createdAt: reducerMsg.createdAt,
      kind: 'agent-event',
      event: reducerMsg.event,
    };
  }

  return null;
}

/**
 * Parse message as event (for message-to-event conversion)
 */
function parseMessageAsEvent(msg: NormalizedMessage): AgentEvent | null {
  if (msg.isSidechain) return null;

  if (msg.role === 'agent') {
    for (const content of msg.content) {
      if (content.type === 'text') {
        const text = (content as { text: string }).text;
        // Check for usage limit messages
        const limitMatch = text.match(/^Claude AI usage limit reached\|(\d+)$/);
        if (limitMatch) {
          const timestamp = parseInt(limitMatch[1], 10);
          if (!isNaN(timestamp)) {
            return { type: 'limit-reached', endsAt: timestamp };
          }
        }
      }

      // Check for title change tool calls
      if (content.type === 'tool-call' && content.name === 'mcp__free__change_title') {
        const title = (content.input as { title?: string })?.title;
        if (typeof title === 'string') {
          return { type: 'message', message: `Title changed to "${title}"` };
        }
      }
    }
  }

  return null;
}
