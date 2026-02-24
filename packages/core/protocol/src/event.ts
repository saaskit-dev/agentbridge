/**
 * @agentbridge/protocol - Event Types and Encoding
 *
 * Event types for real-time sync and encoding/decoding utilities.
 * Based on happy's event system.
 */

// ============================================================================
// Update Events (Persistent)
// ============================================================================

/**
 * Types of persistent update events
 */
export type UpdateType =
  | 'new-message'
  | 'new-session'
  | 'update-session'
  | 'delete-session'
  | 'new-machine'
  | 'update-machine'
  | 'new-artifact'
  | 'update-artifact'
  | 'delete-artifact'
  | 'update-account'
  | 'relationship-updated'
  | 'new-feed-post'
  | 'kv-batch-update';

/**
 * Persistent update event
 */
export interface UpdateEvent {
  type: UpdateType;
  payload: unknown;
  seq: number;
  timestamp: number;
}

// ============================================================================
// Ephemeral Events (Non-persistent)
// ============================================================================

/**
 * Types of ephemeral events
 */
export type EphemeralType =
  | 'activity'
  | 'usage'
  | 'machine-activity'
  | 'machine-status';

/**
 * Ephemeral event (not persisted)
 */
export interface EphemeralEvent {
  type: EphemeralType;
  payload: unknown;
  timestamp: number;
}

// ============================================================================
// Agent Events
// ============================================================================

/**
 * Agent event types for mode switching and notifications
 */
export type AgentEvent =
  | { type: 'switch'; mode: 'local' | 'remote' }
  | { type: 'message'; message: string }
  | { type: 'limit-reached'; endsAt: number }
  | { type: 'ready' };

// ============================================================================
// Session Protocol Events
// ============================================================================

/**
 * Session text event
 */
export interface SessionTextEvent {
  t: 'text';
  text: string;
  thinking?: boolean;
}

/**
 * Session service message event
 */
export interface SessionServiceEvent {
  t: 'service';
  text: string;
}

/**
 * Session tool call start event
 */
export interface SessionToolCallStartEvent {
  t: 'tool-call-start';
  call: string;
  name: string;
  title?: string;
  description?: string;
  args?: Record<string, unknown>;
}

/**
 * Session tool call end event
 */
export interface SessionToolCallEndEvent {
  t: 'tool-call-end';
  call: string;
}

/**
 * Session file event
 */
export interface SessionFileEvent {
  t: 'file';
  ref: string;
  name: string;
}

/**
 * Session photo event
 */
export interface SessionPhotoEvent {
  t: 'photo';
  ref: string;
  thumbhash: string;
  width: number;
  height: number;
}

/**
 * Session turn start event
 */
export interface SessionTurnStartEvent {
  t: 'turn-start';
}

/**
 * Session start event
 */
export interface SessionStartEvent {
  t: 'start';
  title?: string;
}

/**
 * Session turn end event
 */
export interface SessionTurnEndEvent {
  t: 'turn-end';
  status: 'completed' | 'failed' | 'cancelled';
}

/**
 * Session stop event
 */
export interface SessionStopEvent {
  t: 'stop';
}

/**
 * All session event types
 */
export type SessionEvent =
  | SessionTextEvent
  | SessionServiceEvent
  | SessionToolCallStartEvent
  | SessionToolCallEndEvent
  | SessionFileEvent
  | SessionPhotoEvent
  | SessionTurnStartEvent
  | SessionStartEvent
  | SessionTurnEndEvent
  | SessionStopEvent;

// ============================================================================
// Session Envelope
// ============================================================================

/**
 * Session protocol envelope
 */
export interface SessionEnvelope {
  /** CUID2 message ID */
  id: string;
  /** Timestamp */
  time: number;
  /** Role (user or agent) */
  role: 'user' | 'agent';
  /** Turn ID */
  turn?: string;
  /** Subagent CUID2 */
  subagent?: string;
  /** Event */
  ev: SessionEvent;
}

// ============================================================================
// Recipient Filtering
// ============================================================================

/**
 * Recipient types for event routing
 */
export type Recipient =
  | { type: 'all' }
  | { type: 'user-scoped' }
  | { type: 'session'; sessionId: string }
  | { type: 'machine'; machineId: string };

// ============================================================================
// Encoding/Decoding
// ============================================================================

/**
 * Encode update event to JSON string
 */
export function encodeUpdate(event: UpdateEvent): string {
  return JSON.stringify(event);
}

/**
 * Decode update event from JSON string
 */
export function decodeUpdate(data: string): UpdateEvent {
  const parsed = JSON.parse(data) as UpdateEvent;
  return {
    type: parsed.type,
    payload: parsed.payload,
    seq: parsed.seq,
    timestamp: parsed.timestamp,
  };
}

/**
 * Encode ephemeral event to JSON string
 */
export function encodeEphemeral(event: EphemeralEvent): string {
  return JSON.stringify(event);
}

/**
 * Decode ephemeral event from JSON string
 */
export function decodeEphemeral(data: string): EphemeralEvent {
  const parsed = JSON.parse(data) as EphemeralEvent;
  return {
    type: parsed.type,
    payload: parsed.payload,
    timestamp: parsed.timestamp,
  };
}

/**
 * Encode session envelope to JSON string
 */
export function encodeSessionEnvelope(envelope: SessionEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * Decode session envelope from JSON string
 */
export function decodeSessionEnvelope(data: string): SessionEnvelope {
  return JSON.parse(data) as SessionEnvelope;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if an object is a valid UpdateEvent
 */
export function isUpdateEvent(value: unknown): value is UpdateEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as UpdateEvent;
  return (
    typeof event.type === 'string' &&
    typeof event.seq === 'number' &&
    typeof event.timestamp === 'number'
  );
}

/**
 * Check if an object is a valid EphemeralEvent
 */
export function isEphemeralEvent(value: unknown): value is EphemeralEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as EphemeralEvent;
  return (
    typeof event.type === 'string' &&
    typeof event.timestamp === 'number'
  );
}

/**
 * Check if session event is a text event
 */
export function isSessionTextEvent(event: SessionEvent): event is SessionTextEvent {
  return event.t === 'text';
}

/**
 * Check if session event is a tool call start event
 */
export function isSessionToolCallStartEvent(event: SessionEvent): event is SessionToolCallStartEvent {
  return event.t === 'tool-call-start';
}

/**
 * Check if session event is a tool call end event
 */
export function isSessionToolCallEndEvent(event: SessionEvent): event is SessionToolCallEndEvent {
  return event.t === 'tool-call-end';
}
