/**
 * Daemon IPC Protocol
 *
 * Unix socket (daemon.sock) message types for CLI ↔ Daemon communication.
 * Wire format: newline-delimited JSON (one JSON object per line).
 *
 * pty_data encoding: base64
 *   PTY streams are binary. chunk.toString('base64') on send,
 *   Buffer.from(data, 'base64') on receive. Using UTF-8 would corrupt
 *   control sequences (arrow keys, function keys, Ctrl combos).
 */

import type { NormalizedMessage, AgentType, SessionLifecycleState, SessionSummary, SessionInitiator } from '@/daemon/sessions/types';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';
import type { PermissionMode } from '@/api/types';

export type { SessionLifecycleState, SessionSummary };

// ---------------------------------------------------------------------------
// SpawnSessionOptions — passed via IPC spawn_session or directly to spawnSession()
// ---------------------------------------------------------------------------

export interface SpawnSessionOptions {
  agent?: AgentType;
  directory: string;
  resumeAgentSessionId?: string;
  startedBy?: SessionInitiator;
  permissionMode?: PermissionMode;
  model?: string;
  mode?: string;
  /** Provided when the session is triggered from the mobile app */
  token?: string;
  /**
   * Claude-only: how the backend should run.
   *   'local'  — spawn claude process with piped stdio; raw bytes flow over IPC as pty_data
   *   'remote' — SDK headless mode (default)
   * Determined by CLIClient based on whether stdin is a real TTY.
   */
  startingMode?: 'local' | 'remote';
}

export type SpawnSessionResult =
  | { type: 'success'; sessionId: string }
  | { type: 'error'; error: string };

// ---------------------------------------------------------------------------
// IPC message types
// ---------------------------------------------------------------------------

export type IPCClientMessage =
  | { type: 'attach'; sessionId: string }
  | { type: 'detach'; sessionId: string }
  | { type: 'send_input'; sessionId: string; text: string }
  | { type: 'abort'; sessionId: string }
  | { type: 'set_model'; sessionId: string; modelId: string }
  | { type: 'set_mode'; sessionId: string; modeId: string }
  | { type: 'set_config'; sessionId: string; optionId: string; value: string }
  | { type: 'run_command'; sessionId: string; commandId: string }
  | { type: 'list_sessions' }
  | { type: 'spawn_session'; opts: SpawnSessionOptions }
  // Claude PTY proxy: CLI stdin → daemon → claudeLocalLauncher PTY process
  // data: base64-encoded binary (chunk.toString('base64'))
  | { type: 'pty_data'; sessionId: string; data: string }
  | { type: 'pty_resize'; sessionId: string; cols: number; rows: number }
  // CLI requests switching from remote SDK mode back to local PTY mode.
  // Only meaningful for Claude sessions currently in remote mode.
  | { type: 'switch_mode'; sessionId: string }
  // CLI requests attaching to an existing daemon session (no new spawn).
  | { type: 'attach_session'; sessionId: string };

export type IPCServerMessage =
  | { type: 'agent_output'; sessionId: string; msg: NormalizedMessage }
  | { type: 'capabilities'; sessionId: string; capabilities: SessionCapabilities }
  | { type: 'session_state'; sessionId: string; state: SessionLifecycleState }
  | { type: 'session_list'; sessions: SessionSummary[] }
  | { type: 'spawn_result'; sessionId: string; success: boolean; error?: string }
  /** Sent immediately on attach: last N messages from the ring buffer */
  | { type: 'history'; sessionId: string; msgs: NormalizedMessage[] }
  // Claude local mode raw PTY bytes: base64-encoded binary
  // Receiver: Buffer.from(data, 'base64') before writing to stdout
  | { type: 'pty_data'; sessionId: string; data: string }
  | { type: 'pty_resize'; sessionId: string; cols: number; rows: number }
  | { type: 'error'; message: string }
  /**
   * Daemon notifies CLI that a Claude session has switched between local (PTY) and remote (SDK) mode.
   * CLI should reconfigure InputHandler accordingly (raw PTY ↔ idle/spectator).
   */
  | { type: 'mode_switch'; sessionId: string; mode: 'local' | 'remote' };
