/** Unique identifier for a tool call */
export type ToolCallId = string;

/**
 * Messages emitted by an agent backend during a session.
 */
export type AgentMessage =
  | { type: 'model-output'; textDelta?: string; fullText?: string }
  | {
      type: 'status';
      status: 'starting' | 'running' | 'idle' | 'stopped' | 'error';
      detail?: string;
    }
  | { type: 'tool-call'; toolName: string; args: Record<string, unknown>; callId: ToolCallId }
  | { type: 'tool-result'; toolName: string; result: unknown; callId: ToolCallId }
  | { type: 'permission-request'; id: string; reason: string; payload: unknown }
  | { type: 'permission-response'; id: string; approved: boolean }
  | { type: 'fs-edit'; description: string; diff?: string; path?: string }
  | { type: 'terminal-output'; data: string }
  | { type: 'event'; name: string; payload: unknown }
  | { type: 'token-count'; [key: string]: unknown }
  | { type: 'exec-approval-request'; call_id: string; [key: string]: unknown }
  | {
      type: 'patch-apply-begin';
      call_id: string;
      auto_approved?: boolean;
      changes: Record<string, unknown>;
    }
  | {
      type: 'patch-apply-end';
      call_id: string;
      stdout?: string;
      stderr?: string;
      success: boolean;
    };
