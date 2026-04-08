/**
 * AgentBackend Interface
 *
 * Each agent (Claude, Codex, Gemini, OpenCode) implements this interface.
 * Responsibilities:
 *   - Start the underlying agent process/SDK
 *   - Send user messages
 *   - Emit NormalizedMessage via the output async iterable
 *   - Abort/stop cleanly
 *
 * NOT responsible for: session lifecycle, offline reconnection, IPC, DB storage.
 * Those are handled by AgentSession base class.
 */

import type { ApiSessionClient } from '@/api/apiSession';
import type { PermissionMode } from '@/api/types';
import type { PushableAsyncIterable } from '@/utils/PushableAsyncIterable';
import type { IPCServerMessage } from '@/daemon/ipc/protocol';
import type { AgentType, NormalizedMessage } from './types';
import type { SessionCapabilities } from './capabilities';

/** Structured exit information from a backend process/SDK. */
export interface BackendExitInfo {
  /** Process exit code (PTY backends only). */
  exitCode?: number;
  /** Signal name that killed the process, e.g. 'SIGTERM' (PTY backends only). */
  signal?: string;
  /** Human-readable reason the backend stopped. */
  reason?: string;
  /** The Error that caused the exit, if any. */
  error?: Error;
}

export interface AgentStartOpts {
  cwd: string;
  env: Record<string, string>;
  /** URL returned by startFreeServer(); empty string in offline mode */
  mcpServerUrl: string;
  /** Tool names exposed by the Free MCP server (e.g. ['change_title']) */
  freeMcpToolNames: string[];
  /** ApiSessionClient for the current session (Claude launcher needs this wrapped in Session) */
  session: ApiSessionClient;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
  model?: string;
  mode?: string;
  /**
   * Affects Claude backend startup:
   *   - 'local'  → claudeLocalLauncher (PTY interactive mode)
   *   - 'remote' → claudeRemoteLauncher (SDK remote mode)
   * Other agents ignore this field; local/remote distinction is handled by CLIRenderer.
   */
  startingMode?: 'local' | 'remote';
  /**
   * Injected by AgentSession for ClaudeBackend local/PTY mode.
   * ClaudeBackend uses this to broadcast pty_data messages to attached CLI clients.
   * Not needed (and not provided) for SDK/remote mode or non-Claude agents.
   */
  broadcast?: (sessionId: string, msg: IPCServerMessage) => void;
  /**
   * Called by ACP backends once the agent-level session ID is resolved (new or resumed).
   * AgentSession uses this to persist the ID for crash recovery.
   */
  onSessionIdResolved?: (sessionId: string) => void;
}

/** A local file (image) already written to disk by the Daemon, ready to pass to the agent. */
export interface LocalAttachment {
  /** Absolute path on the Daemon's filesystem */
  localPath: string;
  mimeType: string;
}

export interface AgentBackend {
  readonly agentType: AgentType;

  /**
   * Populated after the backend exits (stream ends or process terminates).
   * Read by AgentSession to include exit diagnostics in crash-restart logs.
   */
  readonly exitInfo?: BackendExitInfo;

  start(opts: AgentStartOpts): Promise<void>;
  sendMessage(text: string, permissionMode?: PermissionMode, attachments?: LocalAttachment[]): Promise<void>;
  abort(): Promise<void>;
  stop(): Promise<void>;

  /**
   * Agent output stream. Consumed by AgentSession.pipeBackendOutput().
   * stop() must call output.end() to signal completion.
   *
   * **Event contract — `{ type: 'ready' }` (REQUIRED):**
   * Every backend MUST push this event at the end of every agent turn — after all
   * content and tool results are delivered — to signal the agent is ready for the
   * next user message. The app's voice hooks and UI depend on this for post-turn
   * actions (e.g. voice assistant listening state).
   *
   * - **Claude SDK backend**: emits `ready` natively via the SDK response lifecycle.
   * - **ACP backends** (`DiscoveredAcpBackendBase`): emit `ready` explicitly in
   *   `sendMessage()` after `waitForResponseComplete()` returns. All ACP subclasses
   *   (Codex, Gemini, OpenCode, Cursor, etc.) inherit this automatically.
   * - **New backends**: MUST emit `{ type: 'ready' }` at turn end. `AgentSession`
   *   provides a safety-net synthesis when it sees `{ type: 'status', state: 'idle' }`
   *   without a preceding `ready`, but this is a fallback — not the primary mechanism.
   */
  readonly output: PushableAsyncIterable<NormalizedMessage>;

  /**
   * Optional full capability snapshots emitted after start() and on runtime changes.
   * Implementations should push the complete current snapshot, not partial patches.
   */
  readonly capabilities?: PushableAsyncIterable<SessionCapabilities>;

  /**
   * Called when the AgentSession swaps to a new ApiSessionClient after offline reconnection.
   * Only backends that internally hold a session reference need to implement this.
   * Codex/Gemini/OpenCode backends that don't use the session reference may omit it.
   */
  onSessionChange?(newSession: ApiSessionClient): void;

  /**
   * Receive raw PTY input from the CLI (daemon-side pipe to agent's stdin).
   * data is base64-encoded binary — decode with Buffer.from(data, 'base64').
   * Only ClaudeBackend in local/PTY mode needs to implement this.
   */
  sendPtyInput?(data: string): void;

  /**
   * Notify the backend that the CLI terminal was resized.
   * Only ClaudeBackend in local/PTY mode needs to implement this.
   */
  resizePty?(cols: number, rows: number): void;

  setModel?(modelId: string): Promise<void>;
  setMode?(modeId: string): Promise<void>;
  setConfig?(optionId: string, value: string): Promise<void>;
  runCommand?(commandId: string): Promise<void>;
  getCurrentModel?(): string | null | undefined;
}
