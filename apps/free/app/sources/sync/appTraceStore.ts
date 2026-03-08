/**
 * Per-session wire trace store for the App (RFC §7.1).
 *
 * Avoids circular dependencies: sync.ts writes here, apiSocket.ts reads here.
 * No imports from sync or apiSocket — pure data store.
 */

type AppWireTrace = { tid: string; sid: string; ses?: string; mid?: string };

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
