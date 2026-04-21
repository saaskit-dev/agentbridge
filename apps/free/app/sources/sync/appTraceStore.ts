/**
 * Per-session wire trace store for the App (RFC §7.1).
 *
 * Avoids circular dependencies: sync.ts writes here, apiSocket.ts reads here.
 * No imports from sync or apiSocket — pure data store.
 */

import { Logger, type TraceContext } from '@saaskit-dev/agentbridge/telemetry';

export type AppWireTrace = { tid: string; ses?: string; mid?: string };

/**
 * Only content-bearing message updates are allowed to advance the App's
 * per-session trace pointer. Session status/metadata updates can be emitted
 * from keepalive-driven paths and must not overwrite the active turn trace.
 */
export function shouldAdoptIncomingSessionTrace(updateType: string): boolean {
  return updateType === 'new-message';
}

const _sessionTraces = new Map<string, AppWireTrace>();

/** Called by sync.ts when sending a message or receiving an update for a session. */
export function setSessionTrace(sessionId: string, trace: AppWireTrace): void {
  _sessionTraces.set(sessionId, trace);
}

/**
 * Returns the most recent trace for the given sessionId, or undefined if none.
 * Used by apiSocket.ts to inject _trace into outgoing Socket.IO events.
 */
export function getSessionTrace(sessionId: string): AppWireTrace | undefined {
  return _sessionTraces.get(sessionId);
}

/** Remove trace when a session is closed. */
export function clearSessionTrace(sessionId: string): void {
  _sessionTraces.delete(sessionId);
}

/**
 * Convert AppWireTrace to TraceContext for Logger.
 * Used by appTelemetry's global context provider.
 */
export function wireTraceToContext(trace: AppWireTrace): TraceContext {
  return {
    traceId: trace.tid,
    sessionId: trace.ses,
    machineId: trace.mid,
  };
}

/** Minimal log interface shared by Logger and ScopedLogger. */
export interface SessionLog {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, err?: Error | unknown, data?: unknown): void;
}

/**
 * Return a scoped logger that auto-injects the session's traceId/sessionId/machineId.
 * Falls back to the base logger if no trace is stored for this session yet.
 */
export function sessionLogger(base: Logger, sessionId: string): SessionLog {
  const trace = _sessionTraces.get(sessionId);
  if (!trace) return base;
  return base.withContext(wireTraceToContext(trace));
}
