/**
 * @agentbridge/interfaces - Event Interface
 * Event types and event router interface
 */

// ============================================================================
// Connection Types
// ============================================================================

export type ConnectionType = 'session-scoped' | 'user-scoped' | 'machine-scoped';

export interface SessionScopedConnection {
  connectionType: 'session-scoped';
  userId: string;
  sessionId: string;
}

export interface UserScopedConnection {
  connectionType: 'user-scoped';
  userId: string;
}

export interface MachineScopedConnection {
  connectionType: 'machine-scoped';
  userId: string;
  machineId: string;
}

export type ClientConnection = SessionScopedConnection | UserScopedConnection | MachineScopedConnection;

// ============================================================================
// Recipient Filter Types
// ============================================================================

export type RecipientFilter =
  | { type: 'all-interested-in-session'; sessionId: string }
  | { type: 'user-scoped-only' }
  | { type: 'machine-scoped-only'; machineId: string }
  | { type: 'all-user-authenticated-connections' };

// ============================================================================
// Update Event Types (Persistent)
// ============================================================================

export interface NewMessageEvent {
  type: 'new-message';
  sessionId: string;
  message: {
    id: string;
    seq: number;
    content: unknown;
    localId: string | null;
    createdAt: number;
    updatedAt: number;
  };
}

export interface NewSessionEvent {
  type: 'new-session';
  sessionId: string;
  seq: number;
  metadata: string;
  metadataVersion: number;
  agentState: string | null;
  agentStateVersion: number;
  dataEncryptionKey: string | null;
  active: boolean;
  activeAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface UpdateSessionEvent {
  type: 'update-session';
  sessionId: string;
  metadata?: {
    value: string | null;
    version: number;
  } | null;
  agentState?: {
    value: string | null;
    version: number;
  } | null;
}

export interface UpdateAccountEvent {
  type: 'update-account';
  userId: string;
  settings?: {
    value: string | null;
    version: number;
  } | null;
  github?: {
    id: number;
    login: string;
    avatar_url: string;
  } | null;
}

export interface NewMachineEvent {
  type: 'new-machine';
  machineId: string;
  seq: number;
  metadata: string;
  metadataVersion: number;
  daemonState: string | null;
  daemonStateVersion: number;
  dataEncryptionKey: string | null;
  active: boolean;
  activeAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface UpdateMachineEvent {
  type: 'update-machine';
  machineId: string;
  metadata?: {
    value: string;
    version: number;
  };
  daemonState?: {
    value: string;
    version: number;
  };
  activeAt?: number;
}

export interface DeleteSessionEvent {
  type: 'delete-session';
  sessionId: string;
}

export interface NewArtifactEvent {
  type: 'new-artifact';
  artifactId: string;
  seq: number;
  header: string;
  headerVersion: number;
  body: string;
  bodyVersion: number;
  dataEncryptionKey: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpdateArtifactEvent {
  type: 'update-artifact';
  artifactId: string;
  header?: {
    value: string;
    version: number;
  };
  body?: {
    value: string;
    version: number;
  };
}

export interface DeleteArtifactEvent {
  type: 'delete-artifact';
  artifactId: string;
}

export interface RelationshipUpdatedEvent {
  type: 'relationship-updated';
  uid: string;
  status: 'none' | 'requested' | 'pending' | 'friend' | 'rejected';
  timestamp: number;
}

export interface NewFeedPostEvent {
  type: 'new-feed-post';
  id: string;
  body: unknown;
  cursor: string;
  createdAt: number;
}

export interface KVBatchUpdateEvent {
  type: 'kv-batch-update';
  changes: Array<{
    key: string;
    value: string | null;
    version: number;
  }>;
}

export type UpdateEvent =
  | NewMessageEvent
  | NewSessionEvent
  | UpdateSessionEvent
  | UpdateAccountEvent
  | NewMachineEvent
  | UpdateMachineEvent
  | DeleteSessionEvent
  | NewArtifactEvent
  | UpdateArtifactEvent
  | DeleteArtifactEvent
  | RelationshipUpdatedEvent
  | NewFeedPostEvent
  | KVBatchUpdateEvent;

// ============================================================================
// Ephemeral Event Types (Transient)
// ============================================================================

export interface ActivityEvent {
  type: 'activity';
  id: string;
  active: boolean;
  activeAt: number;
  thinking?: boolean;
}

export interface MachineActivityEvent {
  type: 'machine-activity';
  id: string;
  active: boolean;
  activeAt: number;
}

export interface UsageEvent {
  type: 'usage';
  id: string;
  key: string;
  tokens: Record<string, number>;
  cost: Record<string, number>;
  timestamp: number;
}

export interface MachineStatusEvent {
  type: 'machine-status';
  machineId: string;
  online: boolean;
  timestamp: number;
}

export type EphemeralEvent =
  | ActivityEvent
  | MachineActivityEvent
  | UsageEvent
  | MachineStatusEvent;

// ============================================================================
// Event Payload Types
// ============================================================================

export interface UpdatePayload {
  id: string;
  seq: number;
  body: UpdateEvent;
  createdAt: number;
}

export interface EphemeralPayload<T extends EphemeralEvent = EphemeralEvent> {
  type: T['type'];
  [key: string]: unknown;
}

// ============================================================================
// Event Router Interface
// ============================================================================

/**
 * ServerConnection - Represents a connected client
 */
export interface ServerConnection {
  /** Unique connection identifier */
  id: string;
  /** User ID */
  userId: string;
  /** Connection type */
  connectionType: ConnectionType;
  /** Session ID (for session-scoped connections) */
  sessionId?: string;
  /** Machine ID (for machine-scoped connections) */
  machineId?: string;
  /** Send event to this connection */
  emit(event: string, data: unknown): void;
  /** Disconnect this connection */
  disconnect(): void;
}

/**
 * IEventRouter - Route events to connected clients
 */
export interface IEventRouter {
  /**
   * Add a connection for a user
   */
  addConnection(userId: string, connection: ServerConnection): void;

  /**
   * Remove a connection
   */
  removeConnection(userId: string, connection: ServerConnection): void;

  /**
   * Get all connections for a user
   */
  getConnections(userId: string): Set<ServerConnection> | undefined;

  /**
   * Get total connection count
   */
  getConnectionCount(): number;

  /**
   * Get unique user count
   */
  getUserCount(): number;

  /**
   * Emit update event to matching connections
   */
  emitUpdate(params: {
    userId: string;
    payload: UpdatePayload;
    recipientFilter?: RecipientFilter;
    skipConnection?: ServerConnection;
  }): void;

  /**
   * Emit ephemeral event to matching connections
   */
  emitEphemeral(params: {
    userId: string;
    payload: EphemeralPayload;
    recipientFilter?: RecipientFilter;
    skipConnection?: ServerConnection;
  }): void;
}
