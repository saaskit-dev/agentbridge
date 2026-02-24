/**
 * @agentbridge/protocol - Session Protocol Message Types
 * Message types for AI Coding Agent communication
 */

// ============================================================================
// Usage Data Types
// ============================================================================

export interface UsageData {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens: number;
  service_tier?: string;
}

// ============================================================================
// Agent Event Types
// ============================================================================

export type AgentEvent =
  | { type: 'switch'; mode: 'local' | 'remote' }
  | { type: 'message'; message: string }
  | { type: 'limit-reached'; endsAt: number }
  | { type: 'ready' };

// ============================================================================
// Session Protocol Types
// ============================================================================

/**
 * Session event types (discriminated union)
 */
export type SessionEvent =
  | { t: 'text'; text: string; thinking?: boolean }
  | { t: 'service'; text: string }
  | { t: 'tool-call-start'; call: string; name: string; title?: string; description: string; args: Record<string, unknown> }
  | { t: 'tool-call-end'; call: string }
  | { t: 'file'; ref: string; name: string }
  | { t: 'photo'; ref: string; thumbhash: string; width: number; height: number }
  | { t: 'turn-start' }
  | { t: 'start'; title?: string }
  | { t: 'turn-end'; status: 'completed' | 'failed' | 'cancelled' }
  | { t: 'stop' };

/**
 * Session envelope wraps events with metadata
 */
export interface SessionEnvelope {
  /** Message ID (CUID2) */
  id: string;
  /** Timestamp in ms */
  time: number;
  /** Message role */
  role: 'user' | 'agent';
  /** Turn ID */
  turn?: string;
  /** Subagent ID (for nested calls) */
  subagent?: string;
  /** Event payload */
  ev: SessionEvent;
}

// ============================================================================
// Message Metadata
// ============================================================================

export interface MessageMeta {
  displayText?: string;
  sentFrom?: string;
  permissionMode?: string;
  model?: string;
  [key: string]: unknown;
}

// ============================================================================
// Normalized Content Types
// ============================================================================

export type NormalizedAgentContent =
  | {
      type: 'text';
      text: string;
      uuid: string;
      parentUUID: string | null;
    }
  | {
      type: 'thinking';
      thinking: string;
      uuid: string;
      parentUUID: string | null;
    }
  | {
      type: 'tool-call';
      id: string;
      name: string;
      input: Record<string, unknown>;
      description: string | null;
      uuid: string;
      parentUUID: string | null;
    }
  | {
      type: 'tool-result';
      tool_use_id: string;
      content: unknown;
      is_error: boolean;
      uuid: string;
      parentUUID: string | null;
      permissions?: {
        date: number;
        result: 'approved' | 'denied';
        mode?: string;
        allowedTools?: string[];
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
      };
    }
  | {
      type: 'summary';
      summary: string;
    }
  | {
      type: 'sidechain';
      uuid: string;
      prompt: string;
      parentUUID?: string | null;
    };

// ============================================================================
// Normalized Message Type
// ============================================================================

/**
 * NormalizedMessage - Normalized message format for internal processing
 */
export type NormalizedMessage = (
  | {
      role: 'user';
      content: {
        type: 'text';
        text: string;
      };
    }
  | {
      role: 'agent';
      content: NormalizedAgentContent[];
      usage?: UsageData;
    }
  | {
      role: 'event';
      content: AgentEvent;
    }
) & {
  id: string;
  localId: string | null;
  createdAt: number;
  isSidechain: boolean;
  meta?: MessageMeta;
};

// ============================================================================
// Raw Record Types (for parsing)
// ============================================================================

/**
 * Raw agent output data
 */
export interface RawAgentOutput {
  type: 'output';
  data: {
    type: 'system' | 'result' | 'summary' | 'assistant' | 'user';
    message?: {
      role: string;
      model?: string;
      content: unknown;
      usage?: UsageData;
    };
    isSidechain?: boolean | null;
    isCompactSummary?: boolean | null;
    isMeta?: boolean | null;
    uuid?: string | null;
    parentUuid?: string | null;
    parent_tool_use_id?: string | null;
    toolUseResult?: unknown;
    summary?: string;
  };
}

/**
 * Raw event output
 */
export interface RawEventOutput {
  type: 'event';
  id: string;
  data: AgentEvent;
}

/**
 * Raw session output
 */
export interface RawSessionOutput {
  type: 'session';
  data: SessionEnvelope;
}

/**
 * Raw record (union of all types)
 */
export type RawRecord =
  | { role: 'user'; content: { type: 'text'; text: string }; meta?: MessageMeta }
  | { role: 'agent'; content: RawAgentOutput | RawEventOutput | RawSessionOutput; meta?: MessageMeta };
