/**
 * SessionManager
 *
 * Registry for all active AgentSession instances in the daemon.
 * Replaces the ad-hoc pidToTrackedSession Map in daemon/run.ts.
 *
 * Dependency injection pattern:
 *   onEvictHistory is injected at construction time to avoid
 *   SessionManager → daemonIPCServer static import (would create circular dep
 *   SessionManager.ts → daemon/run.ts → SessionManager.ts).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { AgentSession } from './AgentSession';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySession = AgentSession<any>;

const logger = new Logger('daemon/sessions/SessionManager');

export class SessionManager {
  private readonly sessions = new Map<string, AnySession>();

  /**
   * @param onEvictHistory Called when a session is unregistered to release
   *   its IPC history ring buffer. Injected to avoid circular dependency.
   *   Pass `(id) => daemonIPCServer.evictHistory(id)` from daemon/run.ts.
   */
  constructor(private readonly onEvictHistory: (sessionId: string) => void = () => {}) {}

  register(sessionId: string, session: AnySession): void {
    this.sessions.set(sessionId, session);
    logger.info('[SessionManager] session registered', {
      sessionId,
      agentType: session.agentType,
      total: this.sessions.size,
    });
  }

  /** Remove from registry and release IPC history buffer. */
  unregister(sessionId: string): void {
    const agentType = this.sessions.get(sessionId)?.agentType;
    this.sessions.delete(sessionId);
    this.onEvictHistory(sessionId);
    logger.info('[SessionManager] session unregistered', {
      sessionId,
      agentType,
      total: this.sessions.size,
    });
  }

  get(sessionId: string): AnySession | undefined {
    return this.sessions.get(sessionId);
  }

  list(): AnySession[] {
    return [...this.sessions.values()];
  }

  /** Gracefully stop one session and remove it from the registry. */
  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      logger.info('[SessionManager] stopping session', { sessionId, agentType: session.agentType });
      await session.shutdown('remote_stop');
      this.unregister(sessionId);
    } else {
      logger.debug('[SessionManager] stop called for unknown session', { sessionId });
    }
  }

  /** Called by daemon when SIGTERM is received. All sessions finish current turn. */
  handleSigterm(): void {
    const sessionIds = [...this.sessions.keys()];
    logger.info('[SessionManager] broadcasting SIGTERM to all sessions', {
      count: sessionIds.length,
      sessionIds,
    });
    for (const session of this.sessions.values()) session.handleSigterm();
  }

  /** Called by daemon when SIGINT is received. All sessions exit immediately. */
  handleSigint(): void {
    const sessionIds = [...this.sessions.keys()];
    logger.info('[SessionManager] broadcasting SIGINT to all sessions', {
      count: sessionIds.length,
      sessionIds,
    });
    for (const session of this.sessions.values()) session.handleSigint();
  }
}
