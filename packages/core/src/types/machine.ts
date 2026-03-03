export interface MachineMetadata {
  host: string;
  platform: string;
  cliVersion: string;
  configDir: string; // Directory for auth, settings, logs
  homeDir: string; // User's home directory (matches CLI field name)
  libDir?: string;
  toolsDir?: string;
  username?: string;
  arch?: string;
  displayName?: string; // Custom display name for the machine
  // Daemon status fields
  daemonLastKnownStatus?: 'running' | 'shutting-down';
  daemonLastKnownPid?: number;
  shutdownRequestedAt?: number;
  shutdownSource?: 'free-app' | 'free-cli' | 'mobile-app' | 'cli' | 'os-signal' | 'unknown';
}

export interface DaemonState {
  status: 'running' | 'shutting-down' | string;
  pid?: number;
  httpPort?: number;
  startedAt?: number;
  shutdownRequestedAt?: number;
  shutdownSource?:
    | 'mobile-app'
    | 'cli'
    | 'free-cli'
    | 'free-app'
    | 'os-signal'
    | 'unknown'
    | string;
}

export interface Machine {
  id: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
  active: boolean;
  activeAt: number; // Changed from lastActiveAt to activeAt for consistency
  encryptionKey?: Uint8Array; // Optional - not stored in free-app's Machine
  encryptionVariant?: 'legacy' | 'dataKey'; // Optional - not stored in free-app's Machine
  metadata: MachineMetadata | null;
  metadataVersion: number;
  daemonState: DaemonState | null; // Dynamic daemon state (runtime info)
  daemonStateVersion: number;
}

/**
 * Git status information for a session
 */
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
