import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock external dependencies so the module can be imported without @/ alias resolution
vi.mock('@/app/events/eventRouter', () => ({
  eventRouter: { emitEphemeral: vi.fn() },
  buildSessionActivityEphemeral: vi.fn(),
}));
vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class { debug() {} error() {} info() {} warn() {} },
}));

import { ActivityBroadcaster, type ActivityBroadcasterDeps } from '../activityBroadcaster';

function createMockDeps(): ActivityBroadcasterDeps & { calls: any[] } {
  const calls: any[] = [];
  return {
    calls,
    emitEphemeral: vi.fn((params: any) => {
      calls.push(params);
    }),
    buildActivityPayload: vi.fn((sid, active, activeAt, thinking) => ({
      type: 'activity' as const,
      id: sid,
      active,
      activeAt,
      thinking,
    })),
  };
}

describe('ActivityBroadcaster', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let broadcaster: ActivityBroadcaster;

  beforeEach(() => {
    vi.useFakeTimers();
    deps = createMockDeps();
    // Use a long flush interval; we'll flush manually or advance timers
    broadcaster = new ActivityBroadcaster(deps, 3000);
  });

  afterEach(() => {
    broadcaster.shutdown();
    vi.useRealTimers();
  });

  it('accumulates activity and batch-flushes on interval', () => {
    broadcaster.queue('user1', 'sess-a', true, 1000, false);
    broadcaster.queue('user1', 'sess-b', true, 2000, false);

    // Nothing emitted yet (no thinking change, no timer fire)
    expect(deps.calls).toHaveLength(0);

    // Advance timer to trigger flush
    vi.advanceTimersByTime(3000);

    expect(deps.calls).toHaveLength(1);
    const call = deps.calls[0];
    expect(call.userId).toBe('user1');
    expect(call.payload.type).toBe('batch-activity');
    expect(call.payload.activities).toHaveLength(2);
    expect(call.payload.activities).toEqual(
      expect.arrayContaining([
        { id: 'sess-a', active: true, activeAt: 1000, thinking: false },
        { id: 'sess-b', active: true, activeAt: 2000, thinking: false },
      ])
    );
    expect(call.recipientFilter).toEqual({ type: 'user-scoped-only' });
  });

  it('deduplicates by sessionId (keeps latest)', () => {
    broadcaster.queue('user1', 'sess-a', true, 1000, false);
    broadcaster.queue('user1', 'sess-a', true, 2000, false);
    broadcaster.queue('user1', 'sess-a', true, 3000, false);

    vi.advanceTimersByTime(3000);

    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0].payload.activities).toHaveLength(1);
    expect(deps.calls[0].payload.activities[0].activeAt).toBe(3000);
  });

  it('emits immediately when thinking state changes', () => {
    // First call establishes baseline (thinking=false)
    broadcaster.queue('user1', 'sess-a', true, 1000, false);
    expect(deps.calls).toHaveLength(0); // first call, no previous state → accumulate

    // Second call with thinking=true → state change → immediate
    broadcaster.queue('user1', 'sess-a', true, 2000, true);
    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0].payload.type).toBe('activity');
    expect(deps.calls[0].payload.thinking).toBe(true);
  });

  it('does not re-emit in batch after immediate thinking flush', () => {
    broadcaster.queue('user1', 'sess-a', true, 1000, false);
    broadcaster.queue('user1', 'sess-a', true, 2000, true); // immediate

    deps.calls.length = 0;
    vi.advanceTimersByTime(3000);

    // Should not emit again for sess-a (it was removed from pending after immediate emit)
    expect(deps.calls).toHaveLength(0);
  });

  it('batches per user', () => {
    broadcaster.queue('user1', 'sess-a', true, 1000, false);
    broadcaster.queue('user2', 'sess-b', true, 2000, false);

    vi.advanceTimersByTime(3000);

    expect(deps.calls).toHaveLength(2);
    expect(deps.calls.map((c: any) => c.userId).sort()).toEqual(['user1', 'user2']);
  });

  it('remove() cleans up pending and lastThinkingState', () => {
    broadcaster.queue('user1', 'sess-a', true, 1000, false);
    broadcaster.remove('user1', 'sess-a');

    vi.advanceTimersByTime(3000);
    expect(deps.calls).toHaveLength(0);

    // After remove, re-queue should not trigger immediate thinking change
    broadcaster.queue('user1', 'sess-a', true, 3000, true);
    expect(deps.calls).toHaveLength(0); // first call after remove, no previous state
  });

  it('shutdown() flushes remaining and stops interval', () => {
    broadcaster.queue('user1', 'sess-a', true, 1000, false);
    broadcaster.shutdown();

    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0].payload.type).toBe('batch-activity');

    // No more flushes after shutdown
    deps.calls.length = 0;
    vi.advanceTimersByTime(10000);
    expect(deps.calls).toHaveLength(0);
  });

  it('first queue for a session does not trigger immediate emit', () => {
    // First time seeing a session — no previous thinking state → accumulate
    broadcaster.queue('user1', 'sess-new', true, 1000, true);
    expect(deps.calls).toHaveLength(0);

    vi.advanceTimersByTime(3000);
    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0].payload.type).toBe('batch-activity');
  });

  it('thinking false→true→false triggers two immediate emits', () => {
    broadcaster.queue('user1', 'sess-a', true, 1000, false); // baseline
    broadcaster.queue('user1', 'sess-a', true, 2000, true);  // change → immediate
    broadcaster.queue('user1', 'sess-a', true, 3000, false); // change → immediate

    expect(deps.calls).toHaveLength(2);
    expect(deps.calls[0].payload.thinking).toBe(true);
    expect(deps.calls[1].payload.thinking).toBe(false);
  });
});
