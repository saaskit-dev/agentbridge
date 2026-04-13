import { z } from 'zod';
import type { SessionCapabilities } from './sessionCapabilities';

//
// Agent states
//

export const MetadataSchema = z.object({
  path: z.string(),
  host: z.string(),
  version: z.string().optional(),
  name: z.string().optional(),
  os: z.string().optional(),
  summary: z
    .object({
      text: z.string(),
      updatedAt: z.number(),
    })
    .optional(),
  machineId: z.string().optional(),
  agentSessionId: z.string().optional(), // Agent backend's internal session ID
  importedAgentSessionId: z.string().optional(), // Original external listSessions ID used for import
  /** @deprecated Use agentSessionId. Kept for backward compat with existing encrypted metadata. */
  claudeSessionId: z.string().optional(),
  tools: z.array(z.string()).optional(),
  slashCommands: z.array(z.string()).optional(),
  homeDir: z.string().optional(), // User's home directory on the machine
  freeHomeDir: z.string().optional(), // Free configuration directory
  hostPid: z.number().optional(), // Process ID of the session
  flavor: z.string().nullish(), // Session flavor/variant identifier
  sandbox: z.any().nullish(), // Sandbox config metadata from CLI (or null when disabled)
  dangerouslySkipPermissions: z.boolean().nullish(), // Claude --dangerously-skip-permissions mode (or null when unknown)
  agentModel: z.string().optional(),
  agentMode: z.string().optional(),
  agentPermissionMode: z.enum(['read-only', 'accept-edits', 'yolo']).optional(),
  agentStartingMode: z.enum(['local', 'remote']).optional(),
});

export type Metadata = z.infer<typeof MetadataSchema>;

export const AgentStateSchema = z.object({
  controlledByUser: z.boolean().nullish(),
  requests: z
    .record(
      z.string(),
      z.object({
        tool: z.string(),
        arguments: z.any(),
        createdAt: z.number().nullish(),
      })
    )
    .nullish(),
  completedRequests: z
    .record(
      z.string(),
      z.object({
        tool: z.string(),
        arguments: z.any(),
        createdAt: z.number().nullish(),
        completedAt: z.number().nullish(),
        status: z.enum(['canceled', 'denied', 'approved']),
        reason: z.string().nullish(),
        mode: z.string().nullish(),
        allowedTools: z.array(z.string()).nullish(),
        decision: z.enum(['approved', 'approved_for_session', 'denied', 'abort']).nullish(),
      })
    )
    .nullish(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

export interface QueuedAttachment {
  id: string;
  mimeType: string;
  thumbhash?: string;
  filename?: string;
  localUri?: string | null;
}

export interface QueuedMessage {
  id: string;
  text: string;
  displayText?: string;
  createdAt: number;
  updatedAt: number;
  permissionMode: 'read-only' | 'accept-edits' | 'yolo';
  model: string | null;
  fallbackModel: string | null;
  attachments?: QueuedAttachment[];
}

export interface Session {
  id: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'offline' | 'archived' | 'deleted';
  activeAt: number;
  metadata: Metadata | null;
  metadataVersion: number;
  agentState: AgentState | null;
  agentStateVersion: number;
  capabilities: SessionCapabilities | null;
  capabilitiesVersion: number;
  thinking: boolean;
  thinkingAt: number;
  presence: 'online' | number; // "online" when active, timestamp when last seen
  todos?: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'high' | 'medium' | 'low';
    id: string;
  }>;
  draft?: string | null; // Local draft message, not synced to server
  queuedMessages?: QueuedMessage[]; // Local app-side pre-send queue, not synced to server
  permissionMode?: 'read-only' | 'accept-edits' | 'yolo' | null; // Local permission mode, not synced to server
  desiredAgentMode?: string | null; // Local desired ACP mode, persisted for replay/display
  modelMode?: string | null; // Local desired model selection, persisted for replay/display
  desiredConfigOptions?: Record<string, string> | null; // Local desired config selections, persisted for replay/display
  // IMPORTANT: latestUsage is extracted from reducerState.latestUsage after message processing.
  // We store it directly on Session to ensure it's available immediately on load.
  // Do NOT store reducerState itself on Session - it's mutable and should only exist in SessionMessages.
  latestUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreation: number;
    cacheRead: number;
    contextSize: number;
    contextWindowSize?: number;
    timestamp: number;
  } | null;
}

export interface DecryptedMessage {
  id: string;
  seq: number | null;
  content: any;
  createdAt: number;
  traceId?: string; // RFC §19.3: preserved from server for cross-layer trace correlation
}

//
// Machine states
//

export const MachineMetadataSchema = z.object({
  host: z.string(),
  platform: z.string(),
  freeCliVersion: z.string(),
  freeHomeDir: z.string(), // Directory for Free auth, settings, logs (usually .free/ or .free-dev/)
  homeDir: z.string(), // User's home directory (matches CLI field name)
  // Optional fields that may be added in future versions
  username: z.string().optional(),
  arch: z.string().optional(),
  displayName: z.string().optional(), // Custom display name for the machine
  // Daemon status fields
  daemonLastKnownStatus: z.enum(['running', 'shutting-down']).optional(),
  daemonLastKnownPid: z.number().optional(),
  shutdownRequestedAt: z.number().optional(),
  shutdownSource: z.enum(['free-app', 'free-cli', 'os-signal', 'unknown']).optional(),
});

export type MachineMetadata = z.infer<typeof MachineMetadataSchema>;

export interface Machine {
  id: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
  active: boolean;
  activeAt: number; // Changed from lastActiveAt to activeAt for consistency
  metadata: MachineMetadata | null;
  metadataVersion: number;
  daemonState: any | null; // Dynamic daemon state (runtime info)
  daemonStateVersion: number;
}

//
// Git Status
//

export interface GitStatus {
  branch: string | null;
  isDirty: boolean;
  modifiedCount: number;
  untrackedCount: number;
  stagedCount: number;
  lastUpdatedAt: number;
  // Line change statistics - separated by staged vs unstaged
  stagedLinesAdded: number;
  stagedLinesRemoved: number;
  unstagedLinesAdded: number;
  unstagedLinesRemoved: number;
  // Computed totals
  linesAdded: number; // stagedLinesAdded + unstagedLinesAdded
  linesRemoved: number; // stagedLinesRemoved + unstagedLinesRemoved
  linesChanged: number; // Total lines that were modified (added + removed)
  // Branch tracking information (from porcelain v2)
  upstreamBranch?: string | null; // Name of upstream branch
  aheadCount?: number; // Commits ahead of upstream
  behindCount?: number; // Commits behind upstream
  stashCount?: number; // Number of stash entries
}
