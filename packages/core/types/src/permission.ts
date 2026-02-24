/**
 * @agentbridge/types - Permission Types
 * Permission modes and request types for AI Coding Agents
 */

// ============================================================================
// Permission Mode
// ============================================================================

/**
 * Permission modes controlling how tools are approved
 */
export type PermissionMode =
  | 'default'        // Ask for each permission
  | 'accept-edits'   // Auto-accept file edits
  | 'bypass'         // Bypass most permission checks
  | 'plan'           // Plan mode - restricted operations
  | 'read-only'      // Only read operations allowed
  | 'safe-yolo'      // Auto-approve safe operations
  | 'yolo';          // Auto-approve everything (dangerous)

/**
 * Protocol permission mode (server format)
 */
export type ProtocolPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'read-only'
  | 'safe-yolo'
  | 'yolo';

// ============================================================================
// Permission Request
// ============================================================================

/**
 * Permission request sent to client for approval
 */
export interface PermissionRequest {
  /** Unique request ID */
  id: string;
  /** Session ID */
  sessionId: string;
  /** Tool name */
  tool: string;
  /** Action description */
  action: string;
  /** Tool parameters */
  params: Record<string, unknown>;
  /** Request timestamp */
  timestamp: number;
}

/**
 * Permission response from client
 */
export interface PermissionResponse {
  /** Original request ID */
  requestId: string;
  /** Whether permission was granted */
  allowed: boolean;
  /** Applied permission mode (if any) */
  mode?: PermissionMode;
  /** Reason for denial (if denied) */
  reason?: string;
  /** Allowed tools for session (if approved_for_session) */
  allowedTools?: string[];
}

/**
 * Permission decision types
 */
export type PermissionDecision =
  | 'approved'                // Approved for this call only
  | 'approved_for_session'    // Approved for entire session
  | 'denied'                  // Denied
  | 'abort';                  // Abort the operation

/**
 * Permission result with decision
 */
export interface PermissionResult {
  decision: PermissionDecision;
  reason?: string;
  allowedTools?: string[];
}

// ============================================================================
// Permission Mode Utilities
// ============================================================================

/**
 * Convert protocol mode to internal mode
 */
export function toPermissionMode(mode: ProtocolPermissionMode): PermissionMode {
  const mapping: Record<ProtocolPermissionMode, PermissionMode> = {
    'default': 'default',
    'acceptEdits': 'accept-edits',
    'bypassPermissions': 'bypass',
    'plan': 'plan',
    'read-only': 'read-only',
    'safe-yolo': 'safe-yolo',
    'yolo': 'yolo',
  };
  return mapping[mode];
}

/**
 * Convert internal mode to protocol mode
 */
export function toProtocolPermissionMode(mode: PermissionMode): ProtocolPermissionMode {
  const mapping: Record<PermissionMode, ProtocolPermissionMode> = {
    'default': 'default',
    'accept-edits': 'acceptEdits',
    'bypass': 'bypassPermissions',
    'plan': 'plan',
    'read-only': 'read-only',
    'safe-yolo': 'safe-yolo',
    'yolo': 'yolo',
  };
  return mapping[mode];
}
