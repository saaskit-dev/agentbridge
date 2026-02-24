/**
 * @agentbridge/types - Message Types
 * Message types for AI Coding Agent communication
 */

// ============================================================================
// Tool Call Types
// ============================================================================

/**
 * Tool permission status
 */
export interface ToolPermission {
  id: string;
  status: 'pending' | 'approved' | 'denied' | 'canceled';
  date?: number;
  reason?: string;
  mode?: string;
  allowedTools?: string[];
  decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

/**
 * Tool call state
 */
export interface ToolCall {
  name: string;
  state: 'running' | 'completed' | 'error';
  input: Record<string, unknown>;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  description: string | null;
  result: unknown;
  permission?: ToolPermission;
}

// ============================================================================
// Agent Event Types
// ============================================================================

/**
 * Agent event types
 */
export type AgentEvent =
  | { type: 'switch'; mode: 'local' | 'remote' }
  | { type: 'message'; message: string }
  | { type: 'limit-reached'; endsAt: number }
  | { type: 'ready' };

// ============================================================================
// Message Metadata
// ============================================================================

/**
 * Message metadata
 */
export interface MessageMeta {
  displayText?: string;
  sentFrom?: string;
  permissionMode?: string;
  model?: string;
  [key: string]: unknown;
}

// ============================================================================
// Base Message
// ============================================================================

/**
 * Base message interface
 */
export interface BaseMessage {
  id: string;
  localId: string | null;
  createdAt: number;
  meta?: MessageMeta;
}

// ============================================================================
// Message Types (Internal Format)
// ============================================================================

/**
 * User text message
 */
export interface UserTextMessage extends BaseMessage {
  kind: 'user-text';
  text: string;
  displayText?: string;
}

/**
 * Agent text message
 */
export interface AgentTextMessage extends BaseMessage {
  kind: 'agent-text';
  text: string;
  isThinking?: boolean;
}

/**
 * Tool call message
 */
export interface ToolCallMessage extends BaseMessage {
  kind: 'tool-call';
  tool: ToolCall;
  children: Message[];
}

/**
 * Agent event message
 */
export interface AgentEventMessage extends BaseMessage {
  kind: 'agent-event';
  event: AgentEvent;
}

/**
 * Union type of all message types
 */
export type Message =
  | UserTextMessage
  | AgentTextMessage
  | ToolCallMessage
  | AgentEventMessage;

// ============================================================================
// Type Guards
// ============================================================================

export function isUserTextMessage(msg: Message): msg is UserTextMessage {
  return msg.kind === 'user-text';
}

export function isAgentTextMessage(msg: Message): msg is AgentTextMessage {
  return msg.kind === 'agent-text';
}

export function isToolCallMessage(msg: Message): msg is ToolCallMessage {
  return msg.kind === 'tool-call';
}

export function isAgentEventMessage(msg: Message): msg is AgentEventMessage {
  return msg.kind === 'agent-event';
}

// ============================================================================
// Todo Types
// ============================================================================

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

// ============================================================================
// Usage Data Types
// ============================================================================

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  cacheCreation: number;
  cacheRead: number;
  contextSize: number;
}
