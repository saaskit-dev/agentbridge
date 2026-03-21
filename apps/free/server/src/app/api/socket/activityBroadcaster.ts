import { buildSessionActivityEphemeral, eventRouter } from '@/app/events/eventRouter';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const log = new Logger('app/api/socket/activityBroadcaster');

interface ActivityEntry {
  active: boolean;
  activeAt: number;
  thinking: boolean;
}

export interface ActivityBroadcasterDeps {
  emitEphemeral: typeof eventRouter.emitEphemeral;
  buildActivityPayload: typeof buildSessionActivityEphemeral;
}

const FLUSH_INTERVAL_MS = 3000;

export class ActivityBroadcaster {
  /** userId → sessionId → latest activity */
  private pending = new Map<string, Map<string, ActivityEntry>>();
  /** sessionId → last emitted thinking state (for change detection) */
  private lastThinkingState = new Map<string, boolean>();
  private intervalId: ReturnType<typeof setInterval>;
  private deps: ActivityBroadcasterDeps;

  constructor(deps?: ActivityBroadcasterDeps, flushIntervalMs = FLUSH_INTERVAL_MS) {
    this.deps = deps ?? {
      emitEphemeral: eventRouter.emitEphemeral.bind(eventRouter),
      buildActivityPayload: buildSessionActivityEphemeral,
    };
    this.intervalId = setInterval(() => this.flush(), flushIntervalMs);
  }

  queue(userId: string, sid: string, active: boolean, activeAt: number, thinking: boolean): void {
    const prevThinking = this.lastThinkingState.get(sid);
    const thinkingChanged = prevThinking !== undefined && prevThinking !== thinking;

    this.lastThinkingState.set(sid, thinking);

    if (thinkingChanged) {
      // Thinking state changed — emit immediately for this session only
      const payload = this.deps.buildActivityPayload(sid, active, activeAt, thinking);
      this.deps.emitEphemeral({
        userId,
        payload,
        recipientFilter: { type: 'user-scoped-only' },
      });
      // Remove from pending to avoid duplicate emission in next batch flush
      this.pending.get(userId)?.delete(sid);
      log.debug('[activityBroadcaster] immediate flush (thinking changed)', { userId, sessionId: sid, thinking });
      return;
    }

    // Accumulate for batch flush
    if (!this.pending.has(userId)) {
      this.pending.set(userId, new Map());
    }
    this.pending.get(userId)!.set(sid, { active, activeAt, thinking });
  }

  /** Remove a session from pending buffer (e.g. on session-end or session archived) */
  remove(userId: string, sid: string): void {
    const userMap = this.pending.get(userId);
    if (userMap) {
      userMap.delete(sid);
      if (userMap.size === 0) {
        this.pending.delete(userId);
      }
    }
    this.lastThinkingState.delete(sid);
  }

  /** Flush all pending activity into batch-activity ephemerals */
  flush(): void {
    for (const [userId, sessions] of this.pending) {
      if (sessions.size === 0) continue;

      const activities = Array.from(sessions.entries()).map(([sid, entry]) => ({
        id: sid,
        active: entry.active,
        activeAt: entry.activeAt,
        thinking: entry.thinking,
      }));

      this.deps.emitEphemeral({
        userId,
        payload: {
          type: 'batch-activity' as const,
          activities,
        },
        recipientFilter: { type: 'user-scoped-only' },
      });
      log.debug('[activityBroadcaster] batch flush', { userId, count: activities.length });
    }
    this.pending.clear();
  }

  shutdown(): void {
    clearInterval(this.intervalId);
    this.flush();
  }
}

export const activityBroadcaster = new ActivityBroadcaster();
