/**
 * @agentbridge/protocol
 * Protocol encoding/decoding for AgentBridge SDK
 */

// Session protocol message types
export type {
  UsageData,
  AgentEvent,
  SessionEvent,
  SessionEnvelope,
  MessageMeta,
  NormalizedAgentContent,
  NormalizedMessage,
  RawAgentOutput,
  RawEventOutput,
  RawSessionOutput,
  RawRecord,
} from './message';

// Event types and encoding
export type {
  UpdateType,
  UpdateEvent,
  EphemeralType,
  EphemeralEvent,
  SessionTextEvent,
  SessionServiceEvent,
  SessionToolCallStartEvent,
  SessionToolCallEndEvent,
  SessionFileEvent,
  SessionPhotoEvent,
  SessionTurnStartEvent,
  SessionStartEvent,
  SessionTurnEndEvent,
  SessionStopEvent,
  Recipient,
} from './event';

export {
  encodeUpdate,
  decodeUpdate,
  encodeEphemeral,
  decodeEphemeral,
  encodeSessionEnvelope,
  decodeSessionEnvelope,
  isUpdateEvent,
  isEphemeralEvent,
  isSessionTextEvent,
  isSessionToolCallStartEvent,
  isSessionToolCallEndEvent,
} from './event';

// Reducer
export type {
  NormalizedContent,
  ToolResultPermissions,
  MessageMeta as ReducerMessageMeta,
  PermissionRequest,
  CompletedRequest,
  AgentState,
  ReducerState,
  ReducerResult,
} from './reducer';

export {
  createReducer,
  reducer,
} from './reducer';
