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
const STALL_THRESHOLD_MS = 5 * 60 * 1000;

export class ActivityBroadcaster {
  /** userId → sessionId → latest activity */
  private pending = new Map<string, Map<string, ActivityEntry>>();
  /** sessionId → last emitted thinking state (for change detection) */
  private lastThinkingState = new Map<string, boolean>();
  /** sessionId → userId */
  private sessionOwner = new Map<string, string>();
  /** sessionId → timestamp of last meaningful content (send-messages) */
  private lastContentAt = new Map<string, number>();
  /** sessionId → whether stall has already been emitted (avoid repeated alerts) */
  private stallEmitted = new Set<string>();
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
    this.sessionOwner.set(sid, userId);
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
      log.debug('[activityBroadcaster] immediate flush (thinking changed)', {
        userId,
        sessionId: sid,
        thinking,
      });
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
    this.lastContentAt.delete(sid);
    this.stallEmitted.delete(sid);
    this.sessionOwner.delete(sid);
  }

  /** Record that meaningful content was produced for a session (called from send-messages handler) */
  recordContent(sid: string): void {
    this.lastContentAt.set(sid, Date.now());
    this.stallEmitted.delete(sid);
  }

  /** Flush all pending activity into batch-activity ephemerals + check for stalled sessions */
  flush(): void {
    const now = Date.now();

    this.checkStalledSessions(now);

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

  private checkStalledSessions(now: number): void {
    for (const [sid, thinking] of this.lastThinkingState) {
      if (!thinking) continue;
      if (this.stallEmitted.has(sid)) continue;

      const contentAt = this.lastContentAt.get(sid);
      if (contentAt && now - contentAt < STALL_THRESHOLD_MS) continue;

      const entry = this.lastThinkingState.get(sid);
      if (!entry) continue;

      this.stallEmitted.add(sid);
      log.warn('[activityBroadcaster] session stall detected', { sessionId: sid });

      const owner = this.sessionOwner.get(sid);
      if (owner) {
        this.deps.emitEphemeral({
          userId: owner,
          payload: {
            type: 'session-stall',
            sessionId: sid,
            thinking: true,
            stalledSince: contentAt ?? 0,
          },
        });
      }
    }
  }

  shutdown(): void {
    clearInterval(this.intervalId);
    this.flush();
  }
}

export const activityBroadcaster = new ActivityBroadcaster();
