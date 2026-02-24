/**
 * @agentbridge/types - Machine Types
 * Machine, metadata, and daemon state types
 */

// ============================================================================
// Machine Metadata
// ============================================================================

/**
 * Machine metadata (stored encrypted)
 */
export interface MachineMetadata {
  /** Hostname */
  host: string;
  /** Platform (darwin, linux, win32) */
  platform: string;
  /** AgentBridge version */
  version: string;
  /** Home directory */
  homeDir: string;
}

// ============================================================================
// Daemon State
// ============================================================================

/**
 * Daemon status
 */
export type DaemonStatus = 'running' | 'shutting-down' | 'stopped';

/**
 * Daemon state (stored encrypted)
 */
export interface DaemonState {
  /** Daemon status */
  status: DaemonStatus;
  /** Process ID */
  pid?: number;
  /** HTTP port */
  httpPort?: number;
  /** Start timestamp */
  startedAt?: number;
}

// ============================================================================
// Machine
// ============================================================================

/**
 * Machine (was Device)
 */
export interface Machine {
  /** Machine ID */
  id: string;
  /** Sequence number for optimistic concurrency */
  seq: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Whether machine is active */
  active: boolean;
  /** Last active timestamp */
  activeAt: number;

  /** Encrypted metadata */
  metadata: MachineMetadata | null;
  /** Metadata version */
  metadataVersion: number;

  /** Encrypted daemon state */
  daemonState: DaemonState | null;
  /** Daemon state version */
  daemonStateVersion: number;
}

// ============================================================================
// Legacy Compatibility
// ============================================================================

/**
 * @deprecated Use Machine instead
 */
export type Device = Machine;

/**
 * @deprecated Use MachineMetadata instead
 */
export type DeviceMetadata = MachineMetadata;
