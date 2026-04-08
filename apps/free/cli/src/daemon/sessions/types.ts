/**
 * Daemon Session Types
 *
 * NormalizedMessage is the unified message format used throughout the daemon:
 *   - Backend output → NormalizedMessage
 *   - IPC broadcast to CLI/TUI clients
 *   - sendNormalizedMessage() → Server DB storage
 *   - App pulls from DB and renders directly (no re-normalization needed)
 *
 * ⚠️ SYNC WARNING: The core structure must stay in sync with
 *   apps/free/app/sources/sync/typesRaw.ts: NormalizedMessage
 *   The App definition is source of truth. A CI check script must be maintained to
 *   detect structural drift (see RFC-002 §"NormalizedMessage 类型重复定义").
 *
 * The AgentEvent type here is a SUPERSET of the App's AgentEvent:
 *   - App types: 'switch' | 'message' | 'limit-reached' | 'ready' | 'daemon-log'
 *   - Daemon-only types (ephemeral, not persisted): 'status' | 'token_count'
 * The App's normalizeRawMessage() returns null for unknown event types → forward compatible.
 */

import { randomUUID } from 'node:crypto';
import type { MessageMeta } from '@/api/types';

// Re-export so consumers of this module have everything they need
export type { MessageMeta };

// ---------------------------------------------------------------------------
// NormalizedEvent factory — single source of truth for event message creation
// ---------------------------------------------------------------------------

/**
 * Create a NormalizedMessage with role='event'.
 * Centralizes id generation (randomUUID) and boilerplate fields.
 */
export function createNormalizedEvent(content: AgentEvent): NormalizedMessage {
  return {
    id: randomUUID(),
    createdAt: Date.now(),
    isSidechain: false,
    role: 'event',
    content,
  };
}

// ---------------------------------------------------------------------------
// UsageData — mirrors App's typesRaw.ts usageDataSchema
// ---------------------------------------------------------------------------

export type UsageData = {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens: number;
  context_used_tokens?: number;
  context_window_size?: number;
  service_tier?: string;
};

// ---------------------------------------------------------------------------
// PermissionResult — mirrors App's tool-result.permissions shape
// ---------------------------------------------------------------------------

export type PermissionResult = {
  date: number;
  result: 'approved' | 'denied';
  mode?: string;
  allowedTools?: string[];
  decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
};

// ---------------------------------------------------------------------------
// NormalizedAgentContent — mirrors App's typesRaw.ts NormalizedAgentContent
// ---------------------------------------------------------------------------

export type NormalizedAgentContent =
  | { type: 'text'; text: string; uuid: string; parentUUID: string | null }
  | { type: 'thinking'; thinking: string; uuid: string; parentUUID: string | null }
  | {
      type: 'tool-call';
      id: string;
      name: string;
      input: unknown;
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
      permissions?: PermissionResult;
    }
  | { type: 'summary'; summary: string }
  | { type: 'sidechain'; uuid: string; prompt: string };

// ---------------------------------------------------------------------------
// AgentEvent — App-compatible base types + daemon-only operational signals
// ---------------------------------------------------------------------------

export type AgentEvent =
  // ── App-compatible types (App renders these) ──────────────────────────────
  | { type: 'switch'; mode: 'local' | 'remote' }
  | { type: 'message'; message: string }
  | { type: 'limit-reached'; endsAt: number }
  | { type: 'ready'; stopReason?: string }
  | { type: 'daemon-log'; level: 'error'; component: string; message: string; error?: string }
  // ── Daemon-only operational signals (delivered via ephemeral channels, not persisted as messages)
  | { type: 'status'; state: 'working' | 'idle' }
  | { type: 'token_count'; usage: UsageData; reportToServer?: boolean }
  | {
      type: 'permission_request';
      requestId: string;
      toolName: string;
      toolInput: unknown;
      permissionMode: string;
    };

// ---------------------------------------------------------------------------
// NormalizedMessage — the single unified format for daemon → IPC → DB → App
// ---------------------------------------------------------------------------

export type NormalizedMessage = (
  | { role: 'user'; content: { type: 'text'; text: string } }
  | { role: 'agent'; content: NormalizedAgentContent[] }
  | { role: 'event'; content: AgentEvent }
) & {
  /** Client-generated UUID, globally unique message ID */
  id: string;
  /** Unix timestamp (ms) */
  createdAt: number;
  /** Whether this came from a subagent call chain */
  isSidechain: boolean;
  meta?: MessageMeta;
  /** Token usage — only present on agent messages */
  usage?: UsageData;
  /** RFC §19.3: cross-layer trace correlation (App → Server → Daemon → Agent) */
  traceId?: string;
  /** RFC-010 §3.3: monotonically increasing sequence number for replay dedup */
  seq?: number;
};

// ---------------------------------------------------------------------------
// AgentType — open string type; known values listed for IDE autocomplete
// New agents only need AgentSessionFactory.register(), not a type change.
// ---------------------------------------------------------------------------

export type AgentType =
  | 'claude'
  | 'claude-native'
  | 'codex'
  | 'gemini'
  | 'opencode'
  | 'cursor'
  | (string & {});

// ---------------------------------------------------------------------------
// SessionLifecycleState
// ---------------------------------------------------------------------------

export type SessionLifecycleState = 'initializing' | 'ready' | 'working' | 'idle' | 'archived';

/**
 * Who initiated a session.
 *   'cli'    — user at the CLI terminal
 *   'daemon' — daemon-initiated (recovery, orphan re-attach)
 *   'app'    — app-initiated (iOS/Android/Web/Watch)
 */
export type SessionInitiator = 'cli' | 'daemon' | 'app';

export interface SessionSummary {
  sessionId: string;
  agentType: AgentType;
  cwd: string;
  state: SessionLifecycleState;
  startedAt: string;
  startedBy: SessionInitiator;
  /** Number of CLI sockets currently attached. 0 = orphan (no CLI connected). */
  attachedClients?: number;
}
