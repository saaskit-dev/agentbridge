/**
 * @agentbridge/types - Session Types
 * Session, metadata, and agent state types
 */

import type { PermissionMode } from './permission';

// ============================================================================
// Session Metadata
// ============================================================================

/**
 * Session metadata (stored encrypted)
 */
export interface SessionMetadata {
  /** Working directory path */
  path: string;
  /** Hostname */
  host: string;
  /** Version string */
  version?: string;
  /** Session name */
  name?: string;
  /** OS name */
  os?: string;
  /** Machine ID */
  machineId?: string;
  /** Claude session ID (if using Claude) */
  claudeSessionId?: string;
  /** Available tools */
  tools?: string[];
  /** Available slash commands */
  slashCommands?: string[];
  /** Agent flavor */
  flavor?: string;
}

// ============================================================================
// Agent State
// ============================================================================

/**
 * Permission request in agent state
 */
export interface AgentPermissionRequest {
  id: string;
  tool: string;
  arguments: unknown;
  createdAt: number;
}

/**
 * Completed permission request
 */
export interface CompletedPermissionRequest {
  id: string;
  allowed: boolean;
  reason?: string;
  mode?: PermissionMode;
  allowedTools?: string[];
}

/**
 * Agent state (stored encrypted)
 */
export interface AgentState {
  /** Whether user has control */
  controlledByUser?: boolean;
  /** Pending permission requests */
  requests?: Record<string, AgentPermissionRequest>;
  /** Completed permission requests */
  completedRequests?: Record<string, CompletedPermissionRequest>;
}

// ============================================================================
// Session
// ============================================================================

/**
 * Session options for creating a new session
 */
export interface SessionOptions {
  /** Working directory */
  workingDir: string;
  /** Permission mode */
  permissionMode?: PermissionMode;
  /** Agent adapter to use */
  agent?: string;
  /** Additional CLI arguments */
  cliArgs?: string[];
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Session type
 */
export interface Session {
  /** Session ID */
  id: string;
  /** Sequence number for optimistic concurrency */
  seq: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Whether session is active */
  active: boolean;
  /** Last active timestamp */
  activeAt: number;

  /** Encrypted metadata */
  metadata: SessionMetadata | null;
  /** Metadata version */
  metadataVersion: number;

  /** Encrypted agent state */
  agentState: AgentState | null;
  /** Agent state version */
  agentStateVersion: number;

  /** Whether agent is thinking */
  thinking: boolean;
  /** Thinking started timestamp */
  thinkingAt: number;
  /** Presence status ('online' or last seen timestamp) */
  presence: 'online' | number;
}

/**
 * Session with messages
 */
export interface SessionWithMessages extends Session {
  messages: unknown[];
}
