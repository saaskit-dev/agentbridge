import { z } from 'zod';
import { UsageSchema } from '@/claude/types';
import type { SandboxConfig } from '@/persistence';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';

/**
 * Unified permission mode type across all agents.
 * At each agent boundary, these are translated to agent-specific values:
 * - Claude SDK:  read-only→default, accept-edits→acceptEdits, yolo→bypassPermissions
 * - Codex:       read-only→never+read-only, accept-edits→on-request+workspace-write, yolo→on-failure+danger-full-access
 */
export type PermissionMode = 'read-only' | 'accept-edits' | 'yolo';

/**
 * Usage data type from Claude
 */
export type Usage = z.infer<typeof UsageSchema>;

/**
 * Base message content structure for encrypted messages
 */
export const SessionMessageContentSchema = z.object({
  c: z.string(), // Base64 encoded encrypted content
  t: z.literal('encrypted'),
});

export type SessionMessageContent = z.infer<typeof SessionMessageContentSchema>;

/**
 * Update body for new messages
 */
export const UpdateBodySchema = z.object({
  message: z.object({
    id: z.string(),
    seq: z.number(),
    content: SessionMessageContentSchema,
  }),
  sid: z.string(), // Session ID
  t: z.literal('new-message'),
});

export type UpdateBody = z.infer<typeof UpdateBodySchema>;

export const UpdateSessionBodySchema = z.object({
  t: z.literal('update-session'),
  id: z.string(),
  status: z.enum(['active', 'offline', 'archived', 'deleted']).optional(),
  activeAt: z.number().optional(),
  metadata: z
    .object({
      version: z.number(),
      value: z.string(),
    })
    .nullish(),
  agentState: z
    .object({
      version: z.number(),
      value: z.string(),
    })
    .nullish(),
  capabilities: z
    .object({
      version: z.number(),
      value: z.string().nullable(),
    })
    .nullish(),
});

export type UpdateSessionBody = z.infer<typeof UpdateSessionBodySchema>;

/**
 * Update body for machine updates
 */
export const UpdateMachineBodySchema = z.object({
  t: z.literal('update-machine'),
  machineId: z.string(),
  metadata: z
    .object({
      version: z.number(),
      value: z.string(),
    })
    .nullish(),
  daemonState: z
    .object({
      version: z.number(),
      value: z.string(),
    })
    .nullish(),
});

export type UpdateMachineBody = z.infer<typeof UpdateMachineBodySchema>;

/** Wire trace context forwarded from App through Server to CLI */
export const WireTraceSchema = z.object({
  tid: z.string(),
  sid: z.string(),
  pid: z.string().optional(),
  ses: z.string().optional(),
  mid: z.string().optional(),
});

export type WireTrace = z.infer<typeof WireTraceSchema>;

/**
 * Update event from server
 */
export const UpdateSchema = z.object({
  id: z.string(),
  seq: z.number(),
  body: z.union([UpdateBodySchema, UpdateSessionBodySchema, UpdateMachineBodySchema]),
  createdAt: z.number(),
  _trace: WireTraceSchema.optional(),
});

export type Update = z.infer<typeof UpdateSchema>;

/**
 * Socket events from server to client
 */
export interface ServerToClientEvents {
  update: (data: Update) => void;
  'server-draining': (data: {
    reason: 'server-restart';
    reconnectAfterMs: number;
    startedAt: number;
  }) => void;
  'rpc-request': (
    data: { method: string; params: string },
    callback: (response: string) => void
  ) => void;
  'rpc-registered': (data: { method: string }) => void;
  'rpc-unregistered': (data: { method: string }) => void;
  'rpc-error': (data: { type: string; error: string }) => void;
  ephemeral: (data: {
    type: 'activity';
    id: string;
    active: boolean;
    activeAt: number;
    thinking: boolean;
  }) => void;
  'session-archived': (data: { sid: string }) => void;
  replay: (data: { sessionId: string; messages: any[]; hasMore: boolean }) => void;
  auth: (data: { success: boolean; user: string }) => void;
  error: (data: { message: string }) => void;
  'file-transfer': (
    payload: { id: string; sessionId: string; data: Buffer; mimeType: string; filename?: string },
    ack: (result: { ok: boolean }) => void
  ) => void;
  'fetch-attachment': (
    payload: { id: string; mimeType: string },
    ack: (result: { ok: boolean; data?: Buffer; mimeType?: string; error?: string }) => void
  ) => void;
}

/**
 * Socket events from client to server
 */
export interface ClientToServerEvents {
  message: (data: { sid: string; message: any }) => void;
  'session-alive': (data: {
    sid: string;
    time: number;
    thinking: boolean;
    mode?: 'local' | 'remote';
    _trace?: WireTrace;
  }) => void;
  'session-end': (data: { sid: string; time: number; _trace?: WireTrace }) => void;
  'update-metadata': (
    data: { sid: string; expectedVersion: number; metadata: string; _trace?: WireTrace },
    cb: (
      answer:
        | {
            result: 'error';
          }
        | {
            result: 'version-mismatch';
            version: number;
            metadata: string;
          }
        | {
            result: 'success';
            version: number;
            metadata: string;
          }
    ) => void
  ) => void;
  'update-state': (
    data: { sid: string; expectedVersion: number; agentState: string | null; _trace?: WireTrace },
    cb: (
      answer:
        | {
            result: 'error';
          }
        | {
            result: 'version-mismatch';
            version: number;
            agentState: string | null;
          }
        | {
            result: 'success';
            version: number;
            agentState: string | null;
          }
    ) => void
  ) => void;
  'update-capabilities': (
    data: { sid: string; expectedVersion: number; capabilities: string | null; _trace?: WireTrace },
    cb: (
      answer:
        | {
            result: 'error';
          }
        | {
            result: 'version-mismatch';
            version: number;
            capabilities: string | null;
          }
        | {
            result: 'success';
            version: number;
            capabilities: string | null;
          }
    ) => void
  ) => void;
  ping: (callback: () => void) => void;
  'rpc-register': (data: { method: string }) => void;
  'rpc-unregister': (data: { method: string }) => void;
  'rpc-call': (
    data: { method: string; params: string },
    callback: (response: { ok: boolean; result?: string; error?: string }) => void
  ) => void;
  'usage-report': (data: {
    key: string;
    sessionId: string;
    timestamp?: number;
    agentType?: string;
    model?: string;
    startedBy?: 'cli' | 'daemon' | 'app';
    tokens: {
      total: number;
      [key: string]: number;
    };
    cost: {
      total: number;
      [key: string]: number;
    };
    _trace?: WireTrace;
  }) => void;
  // Streaming events (typewriter effect)
  'streaming:text-delta': (data: {
    type: 'text_delta';
    sessionId: string;
    messageId: string;
    delta: string;
    timestamp: number;
    _trace?: WireTrace;
  }) => void;
  'streaming:text-complete': (data: {
    type: 'text_complete';
    sessionId: string;
    messageId: string;
    fullText: string;
    timestamp: number;
    _trace?: WireTrace;
  }) => void;
  'streaming:thinking-delta': (data: {
    type: 'thinking_delta';
    sessionId: string;
    messageId: string;
    delta: string;
    timestamp: number;
    _trace?: WireTrace;
  }) => void;
  'send-messages': (
    data: {
      sessionId: string;
      messages: Array<{ id: string; content: string; _trace?: WireTrace }>;
    },
    cb: (response: {
      ok: boolean;
      messages?: Array<{ id: string; seq: number; createdAt: number; updatedAt: number }>;
      error?: string;
    }) => void
  ) => void;
  'fetch-messages': (
    data: { sessionId: string; after_seq: number; limit: number },
    cb: (response: { ok: boolean; messages?: any[]; hasMore?: boolean; error?: string }) => void
  ) => void;
}

/**
 * Session information
 */
export type Session = {
  id: string;
  seq: number;
  encryptionKey: Uint8Array;
  encryptionVariant: 'legacy' | 'dataKey';
  metadata: Metadata;
  metadataVersion: number;
  agentState: AgentState | null;
  agentStateVersion: number;
  capabilities?: SessionCapabilities | null;
  capabilitiesVersion?: number;
  /** Restored from persistence — avoids re-fetching all messages after recovery. */
  lastSeq?: number;
};

/**
 * Machine metadata - static information (rarely changes)
 */
export const MachineMetadataSchema = z.object({
  host: z.string(),
  platform: z.string(),
  freeCliVersion: z.string(),
  homeDir: z.string(),
  freeHomeDir: z.string(),
  freeLibDir: z.string(),
});

export type MachineMetadata = z.infer<typeof MachineMetadataSchema>;

/**
 * Daemon state - dynamic runtime information (frequently updated)
 */
export const DaemonStateSchema = z.object({
  status: z.union([
    z.enum(['running', 'shutting-down']),
    z.string(), // Forward compatibility
  ]),
  pid: z.number().optional(),
  httpPort: z.number().optional(),
  startedAt: z.number().optional(),
  shutdownRequestedAt: z.number().optional(),
  shutdownSource: z
    .union([
      z.enum(['mobile-app', 'cli', 'os-signal', 'unknown']),
      z.string(), // Forward compatibility
    ])
    .optional(),
  failedRecoveries: z
    .array(
      z.object({
        sessionId: z.string(),
        error: z.string(),
        failedAt: z.number(),
      })
    )
    .optional(),
});

export type DaemonState = z.infer<typeof DaemonStateSchema>;

export type Machine = {
  id: string;
  encryptionKey: Uint8Array;
  encryptionVariant: 'legacy' | 'dataKey';
  metadata: MachineMetadata;
  metadataVersion: number;
  daemonState: DaemonState | null;
  daemonStateVersion: number;
};

/**
 * Session message from API
 */
export const SessionMessageSchema = z.object({
  content: SessionMessageContentSchema,
  createdAt: z.number(),
  id: z.string(),
  seq: z.number(),
  updatedAt: z.number(),
});

export type SessionMessage = z.infer<typeof SessionMessageSchema>;

/**
 * Message metadata schema
 */
export const MessageMetaSchema = z.object({
  sentFrom: z.string().optional(), // Source identifier
  permissionMode: z.enum(['read-only', 'accept-edits', 'yolo']).optional(), // Permission mode for this message
  model: z.string().nullable().optional(), // Model name for this message (null = reset)
  fallbackModel: z.string().nullable().optional(), // Fallback model for this message (null = reset)
  customSystemPrompt: z.string().nullable().optional(), // Custom system prompt for this message (null = reset)
  appendSystemPrompt: z.string().nullable().optional(), // Append to system prompt for this message (null = reset)
  allowedTools: z.array(z.string()).nullable().optional(), // Allowed tools for this message (null = reset)
  disallowedTools: z.array(z.string()).nullable().optional(), // Disallowed tools for this message (null = reset)
});

export type MessageMeta = z.infer<typeof MessageMetaSchema>;

/**
 * API response types
 */
export const CreateSessionResponseSchema = z.object({
  session: z.object({
    id: z.string(),
    tag: z.string().nullable(),
    seq: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    status: z.enum(['active', 'offline', 'archived', 'deleted']),
    metadata: z.string(),
    metadataVersion: z.number(),
    agentState: z.string().nullable(),
    agentStateVersion: z.number(),
    capabilities: z.string().nullable().optional(),
    capabilitiesVersion: z.number().optional(),
    dataEncryptionKey: z.string().nullable().optional(),
  }),
});

export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

export const AttachmentRefSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  thumbhash: z.string().optional(),
  filename: z.string().optional(),
});

export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

export const UserMessageSchema = z.object({
  role: z.literal('user'),
  content: z.object({
    type: z.literal('text'),
    text: z.string(),
    attachments: z.array(AttachmentRefSchema).optional(),
  }),
  localKey: z.string().optional(), // Mobile messages include this
  meta: MessageMetaSchema.optional(),
});

export type UserMessage = z.infer<typeof UserMessageSchema>;

export const AgentMessageSchema = z.object({
  role: z.literal('agent'),
  content: z.object({
    type: z.literal('output'),
    data: z.any(),
  }),
  meta: MessageMetaSchema.optional(),
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const MessageContentSchema = z.union([UserMessageSchema, AgentMessageSchema]);

export type MessageContent = z.infer<typeof MessageContentSchema>;

export type Metadata = {
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
  agentSessionId?: string; // Agent backend's internal session ID (e.g. Claude Code session UUID)
  /** @deprecated Use agentSessionId. Kept for backward compat with existing encrypted metadata. */
  claudeSessionId?: string;
  tools?: string[];
  slashCommands?: string[];
  homeDir: string;
  freeHomeDir: string;
  freeLibDir: string;
  freeToolsDir: string;
  startedFromDaemon?: boolean;
  hostPid?: number;
  startedBy?: 'cli' | 'daemon' | 'app';
  // Lifecycle state management
  lifecycleState?: 'running' | 'archiveRequested' | 'archived' | string;
  lifecycleStateSince?: number;
  archivedBy?: string;
  archiveReason?: string;
  flavor?: string;
  sandbox?: SandboxConfig | null;
  dangerouslySkipPermissions?: boolean | null;
  // Agent session opts — persisted to server so corrupted local files can be reconstructed.
  // All encrypted end-to-end; server never sees plaintext.
  agentModel?: string;
  agentMode?: string;
  agentPermissionMode?: PermissionMode;
  agentStartingMode?: 'local' | 'remote';
  agentEnv?: Record<string, string>;
};

export type AgentState = {
  controlledByUser?: boolean | null | undefined;
  requests?: {
    [id: string]: {
      tool: string;
      arguments: any;
      createdAt: number;
    };
  };
  completedRequests?: {
    [id: string]: {
      tool: string;
      arguments: any;
      createdAt: number;
      completedAt: number;
      status: 'canceled' | 'denied' | 'approved';
      reason?: string;
      mode?: PermissionMode;
      decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
      allowTools?: string[];
    };
  };
};
