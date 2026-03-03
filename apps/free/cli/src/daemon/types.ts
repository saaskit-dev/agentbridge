/**
 * Daemon-specific types (not related to API/server communication)
 */

import { ChildProcess } from 'child_process';
import { Metadata } from '@/api/types';

/**
 * Session tracking for daemon
 */
export interface TrackedSession {
  startedBy: 'daemon' | string;
  freeSessionId?: string;
  freeSessionMetadataFromLocalWebhook?: Metadata;
  pid: number;
  childProcess?: ChildProcess;
  error?: string;
  directoryCreated?: boolean;
  message?: string;
  /** tmux session identifier (format: session:window) */
  tmuxSessionId?: string;
}
