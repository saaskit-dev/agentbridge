/**
 * WebSocket events
 */

import type { MachineMetadata } from '../types/machine';
import type { SessionMessage } from '../types/message';
import type { SessionMetadata } from '../types/session';
import type { WireTrace } from '../telemetry/types.js';

// === Persistent Events (Updates) ===

/** New message event */
export interface NewMessageEvent {
  type: 'new-message';
  sessionId: string;
  message: SessionMessage;
}

/** New session event */
export interface NewSessionEvent {
  type: 'new-session';
  sessionId: string;
  metadata: SessionMetadata;
  dataEncryptionKey: Uint8Array;
}

/** Update session event */
export interface UpdateSessionEvent {
  type: 'update-session';
  sessionId: string;
  metadata?: {
    version: number;
    value: string;
  };
  agentState?: {
    version: number;
    value: string;
  };
}

/** New machine event */
export interface NewMachineEvent {
  type: 'new-machine';
  machineId: string;
  metadata: MachineMetadata;
  dataEncryptionKey: Uint8Array;
}

/** Update machine event */
export interface UpdateMachineEvent {
  type: 'update-machine';
  machineId: string;
  metadata?: {
    version: number;
    value: string;
  };
  daemonState?: {
    version: number;
    value: string;
  };
}

/** Delete session event */
export interface DeleteSessionEvent {
  type: 'delete-session';
  sessionId: string;
}

/** KV batch update event */
export interface KvBatchUpdateEvent {
  type: 'kv-batch-update';
  changes: Array<{
    key: string;
    value: unknown;
    version: number;
  }>;
}

// === Artifact Events ===

/** New artifact event */
export interface NewArtifactEvent {
  type: 'new-artifact';
  artifactId: string;
  seq: number;
  header: string;
  headerVersion: number;
  body: string;
  bodyVersion: number;
  dataEncryptionKey: Uint8Array | null;
  createdAt: number;
  updatedAt: number;
}

/** Update artifact event */
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

/** Delete artifact event */
export interface DeleteArtifactEvent {
  type: 'delete-artifact';
  artifactId: string;
}

// === Account Events ===

/** Update account event */
export interface UpdateAccountEvent {
  type: 'update-account';
  userId: string;
  settings?: {
    version: number;
    value: string | null;
  };
  github?: {
    id: number;
    login: string;
    name: string | null;
    avatarUrl: string;
  } | null;
}

// === Social Events ===

/** Relationship updated event */
export interface RelationshipUpdatedEvent {
  type: 'relationship-updated';
  uid: string;
  status: 'none' | 'requested' | 'pending' | 'friend' | 'rejected';
  timestamp: number;
}

/** New feed post event */
export interface NewFeedPostEvent {
  type: 'new-feed-post';
  id: string;
  body: unknown;
  cursor: string;
  createdAt: number;
}

/** Union of all persistent update events */
export type UpdateEvent =
  | NewMessageEvent
  | NewSessionEvent
  | UpdateSessionEvent
  | NewMachineEvent
  | UpdateMachineEvent
  | DeleteSessionEvent
  | KvBatchUpdateEvent
  | NewArtifactEvent
  | UpdateArtifactEvent
  | DeleteArtifactEvent
  | UpdateAccountEvent
  | RelationshipUpdatedEvent
  | NewFeedPostEvent;

// === Ephemeral Events ===

/** Session activity event */
export interface ActivityEvent {
  type: 'activity';
  id: string;
  active: boolean;
  activeAt: number;
  thinking: boolean;
}

/** Machine activity event */
export interface MachineActivityEvent {
  type: 'machine-activity';
  id: string;
  active: boolean;
  activeAt: number;
}

/** Machine status event */
export interface MachineStatusEvent {
  type: 'machine-status';
  machineId: string;
  online: boolean;
  timestamp: number;
}

/** Usage event - tokens and cost broken down by model */
export interface UsageEvent {
  type: 'usage';
  id: string;
  key: string;
  tokens: Record<string, number>;
  cost: Record<string, number>;
  timestamp: number;
}

/** Union of all ephemeral events */
export type EphemeralEvent = ActivityEvent | MachineActivityEvent | MachineStatusEvent | UsageEvent;

// === RPC Events ===

/** RPC request event */
export interface RpcRequestEvent {
  method: string;
  params: unknown;
}

/** RPC call event */
export interface RpcCallEvent {
  method: string;
  params: string;
}

/** RPC registered event */
export interface RpcRegisteredEvent {
  method: string;
}

/** RPC error event */
export interface RpcErrorEvent {
  type: string;
  error: string;
}

// === Event Payloads ===

/** Update payload structure */
export interface UpdatePayload {
  id: string;
  seq: number;
  body: {
    t: UpdateEvent['type'];
    [key: string]: unknown;
  };
  createdAt: number;
  _trace?: WireTrace;
}

/** Ephemeral payload structure */
export interface EphemeralPayload {
  type: EphemeralEvent['type'];
  [key: string]: unknown;
  _trace?: WireTrace;
}
