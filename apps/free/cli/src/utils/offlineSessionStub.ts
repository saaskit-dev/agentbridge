/**
 * Offline Session Stub Factory
 *
 * Creates a no-op session stub for offline mode that can be used across all backends
 * (Claude, Codex, Gemini, etc.). All session methods become no-ops until reconnection.
 *
 * This follows DRY principles by providing a single implementation for all backends,
 * satisfying REQ-8 from serverConnectionErrors.ts.
 *
 * @module offlineSessionStub
 */

import type { ApiSessionClient } from '@/api/apiSession';

/**
 * Creates a no-op session stub for offline mode.
 *
 * The stub implements the ApiSessionClient interface with no-op methods,
 * allowing the application to continue running while offline. When reconnection
 * succeeds, the real session replaces this stub.
 *
 * @param sessionId - Client-generated session ID
 * @returns A no-op ApiSessionClient stub
 *
 * @example
 * ```typescript
 * const offlineStub = createOfflineSessionStub(sessionId);
 * let session: ApiSessionClient = offlineStub;
 *
 * // When reconnected:
 * session = api.sessionSyncClient(response);
 * ```
 */
export function createOfflineSessionStub(sessionId: string): ApiSessionClient {
  return {
    sessionId: `offline-${sessionId}`,
    getLastSeq: () => 0,
    sendCodexMessage: () => {},
    sendAgentMessage: () => {},
    sendSessionProtocolMessage: async () => {},
    keepAlive: () => {},
    sendSessionEvent: () => {},
    sendSessionDeath: () => {},
    sendUsageData: () => {},
    updateLifecycleState: () => {},
    requestControlTransfer: async () => {},
    flush: async () => {},
    close: async () => {},
    updateMetadata: () => {},
    updateAgentState: () => {},
    onUserMessage: () => {},
    onFileTransfer: () => {},
    once: () => {},
    on: () => {},
    off: () => {},
    sendNormalizedMessage: async () => {},
    sendStreamingTextDelta: () => {},
    sendStreamingTextComplete: () => {},
    sendStreamingThinkingDelta: () => {},
    updateCapabilities: () => {},
    rpcHandlerManager: {
      registerHandler: () => {},
    },
  } as unknown as ApiSessionClient;
}
