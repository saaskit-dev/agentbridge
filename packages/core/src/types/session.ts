export type PermissionMode = 'read-only' | 'accept-edits' | 'yolo';

export type ModelMode = 'default' | 'gemini-2.5-pro' | 'gemini-2.5-flash' | 'gemini-2.5-flash-lite';

export interface SessionMetadata {
  path: string;
  host: string;
  version?: string;
  name?: string;
  os?: string;
  summary?: {
    text: string;
    updatedAt: number;
  };
  machineId?: string;
  claudeSessionId?: string;
  tools?: string[];
  slashCommands?: string[];
  homeDir?: string; // User's home directory on the machine
  configDir?: string; // Configuration directory
  libDir?: string;
  toolsDir?: string;
  startedFromDaemon?: boolean;
  hostPid?: number; // Process ID of the session
  startedBy?: 'daemon' | 'terminal';
  lifecycleState?: 'running' | 'archiveRequested' | 'archived' | string;
  lifecycleStateSince?: number;
  archivedBy?: string;
  archiveReason?: string;
  flavor?: string | null; // Session flavor/variant identifier
}

export interface AgentState {
  controlledByUser?: boolean | null;
  requests?: Record<
    string,
    {
      tool: string;
      arguments: unknown;
      createdAt?: number | null;
    }
  > | null;
  completedRequests?: Record<
    string,
    {
      tool: string;
      arguments: unknown;
      createdAt?: number | null;
      completedAt?: number | null;
      status: 'canceled' | 'denied' | 'approved';
      reason?: string | null;
      mode?: string | null;
      allowedTools?: string[] | null;
      decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort' | null;
    }
  > | null;
}

export type EncryptionVariant = 'legacy' | 'dataKey';

/**
 * Usage statistics for a session
 * IMPORTANT: latestUsage is extracted from reducerState.latestUsage after message processing.
 * We store it directly on Session to ensure it's available immediately on load.
 */
export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreation: number;
  cacheRead: number;
  contextSize: number;
  timestamp: number;
}

export interface Session {
  id: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
  active: boolean;
  activeAt: number;
  encryptionKey?: Uint8Array; // Optional - not stored in free-app's Session
  encryptionVariant?: EncryptionVariant; // Optional - not stored in free-app's Session
  metadata: SessionMetadata | null;
  metadataVersion: number;
  agentState: AgentState | null;
  agentStateVersion: number;
  thinking: boolean;
  thinkingAt: number;
  presence: 'online' | number; // "online" when active, timestamp when last seen
  todos?: Array<{
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority?: 'high' | 'medium' | 'low';
  }>;
  draft?: string | null; // Local draft message, not synced to server
  permissionMode?: PermissionMode | null; // Local permission mode, not synced to server
  modelMode?: ModelMode | null; // Local model mode, not synced to server
  latestUsage?: SessionUsage | null;
}

export interface SessionOptions {
  path: string;
  permissionMode?: PermissionMode;
  flavor?: string | null;
  machineId?: string;
}

// Re-export for backward compatibility
export type { SessionUsage as LatestUsage };
