/**
 * replayMissedMessages unit tests
 *
 * Tests RFC-010 §3.3 missed message replay:
 *   - session-scoped: lastSeq validation, ownership, pagination, payload shape
 *   - user-scoped: lastSeqs multi-session iteration, validation, ownership
 *   - machine-scoped: no-op (no DB calls, no emit)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  dbSessionFindFirst: vi.fn(),
  dbMessageFindMany: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
  db: {
    session: { findFirst: mocks.dbSessionFindFirst },
    sessionMessage: { findMany: mocks.dbMessageFindMany },
  },
}));

vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    warn() {}
    info() {}
    error() {}
    debug() {}
  },
}));

import { replayMissedMessages } from '../replayHandler';
import type { ClientConnection } from '@/app/events/eventRouter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSocket(auth: Record<string, any> = {}) {
  return {
    handshake: { auth },
    emit: vi.fn(),
  } as any;
}

function makeMessage(seq: number, opts?: { traceId?: string }) {
  return {
    id: `msg-${seq}`,
    seq,
    content: { t: 'encrypted', c: 'data' },
    traceId: opts?.traceId ?? null,
    createdAt: new Date('2026-03-27T00:00:00Z'),
    updatedAt: new Date('2026-03-27T00:00:00Z'),
  };
}

const EPOCH = new Date('2026-03-27T00:00:00Z').getTime();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session-scoped connection', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeSessionConnection(sessionId = 'sess-1'): ClientConnection {
    return {
      connectionType: 'session-scoped',
      sessionId,
      socket: {} as any,
      userId: 'user-1',
    };
  }

  it('replays messages after lastSeq', async () => {
    const socket = makeSocket({ lastSeq: 5 });
    const conn = makeSessionConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'sess-1' });
    mocks.dbMessageFindMany.mockResolvedValue([makeMessage(6), makeMessage(7)]);

    await replayMissedMessages('user-1', socket, conn);

    expect(mocks.dbSessionFindFirst).toHaveBeenCalledWith({
      where: { id: 'sess-1', accountId: 'user-1' },
      select: { id: true },
    });
    expect(mocks.dbMessageFindMany).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1', seq: { gt: 5 } },
      orderBy: { seq: 'asc' },
      take: 101,
      select: { id: true, seq: true, content: true, traceId: true, createdAt: true, updatedAt: true },
    });
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith('replay', expect.objectContaining({
      sessionId: 'sess-1',
      messages: expect.any(Array),
      hasMore: false,
    }));
  });

  it('skips when lastSeq is undefined', async () => {
    const socket = makeSocket({});
    await replayMissedMessages('user-1', socket, makeSessionConnection());

    expect(mocks.dbSessionFindFirst).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('skips when lastSeq is null', async () => {
    const socket = makeSocket({ lastSeq: null });
    await replayMissedMessages('user-1', socket, makeSessionConnection());

    expect(mocks.dbSessionFindFirst).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('skips when lastSeq is negative', async () => {
    const socket = makeSocket({ lastSeq: -1 });
    await replayMissedMessages('user-1', socket, makeSessionConnection());

    expect(mocks.dbSessionFindFirst).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('skips when lastSeq is not a number (string)', async () => {
    const socket = makeSocket({ lastSeq: '10' });
    await replayMissedMessages('user-1', socket, makeSessionConnection());

    expect(mocks.dbSessionFindFirst).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('verifies session ownership — findFirst returns null means no emit', async () => {
    const socket = makeSocket({ lastSeq: 0 });
    mocks.dbSessionFindFirst.mockResolvedValue(null);

    await replayMissedMessages('user-1', socket, makeSessionConnection());

    expect(mocks.dbSessionFindFirst).toHaveBeenCalled();
    expect(mocks.dbMessageFindMany).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('hasMore=true when >100 messages', async () => {
    const socket = makeSocket({ lastSeq: 0 });
    const conn = makeSessionConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'sess-1' });

    // DB returns 101 messages (REPLAY_LIMIT + 1)
    const msgs = Array.from({ length: 101 }, (_, i) => makeMessage(i + 1));
    mocks.dbMessageFindMany.mockResolvedValue(msgs);

    await replayMissedMessages('user-1', socket, conn);

    const payload = socket.emit.mock.calls[0][1];
    expect(payload.hasMore).toBe(true);
    expect(payload.messages).toHaveLength(100);
    // Last message in page should be seq 100 (not 101)
    expect(payload.messages[99].seq).toBe(100);
  });

  it('hasMore=false when <=100 messages', async () => {
    const socket = makeSocket({ lastSeq: 0 });
    const conn = makeSessionConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'sess-1' });
    mocks.dbMessageFindMany.mockResolvedValue([makeMessage(1), makeMessage(2)]);

    await replayMissedMessages('user-1', socket, conn);

    const payload = socket.emit.mock.calls[0][1];
    expect(payload.hasMore).toBe(false);
    expect(payload.messages).toHaveLength(2);
  });

  it('skips when no new messages (empty array)', async () => {
    const socket = makeSocket({ lastSeq: 99 });
    const conn = makeSessionConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'sess-1' });
    mocks.dbMessageFindMany.mockResolvedValue([]);

    await replayMissedMessages('user-1', socket, conn);

    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('includes content in replay', async () => {
    const socket = makeSocket({ lastSeq: 0 });
    const conn = makeSessionConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'sess-1' });
    mocks.dbMessageFindMany.mockResolvedValue([makeMessage(1)]);

    await replayMissedMessages('user-1', socket, conn);

    const msg = socket.emit.mock.calls[0][1].messages[0];
    expect(msg.content).toEqual({ t: 'encrypted', c: 'data' });
  });

  it('includes traceId only when present', async () => {
    const socket = makeSocket({ lastSeq: 0 });
    const conn = makeSessionConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'sess-1' });
    mocks.dbMessageFindMany.mockResolvedValue([makeMessage(1, { traceId: 'trace-abc' })]);

    await replayMissedMessages('user-1', socket, conn);

    const msg = socket.emit.mock.calls[0][1].messages[0];
    expect(msg.traceId).toBe('trace-abc');
  });

  it('omits traceId when null', async () => {
    const socket = makeSocket({ lastSeq: 0 });
    const conn = makeSessionConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'sess-1' });
    mocks.dbMessageFindMany.mockResolvedValue([makeMessage(1)]);

    await replayMissedMessages('user-1', socket, conn);

    const msg = socket.emit.mock.calls[0][1].messages[0];
    expect(msg).not.toHaveProperty('traceId');
  });

  it('converts dates to epoch milliseconds', async () => {
    const socket = makeSocket({ lastSeq: 0 });
    const conn = makeSessionConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'sess-1' });
    mocks.dbMessageFindMany.mockResolvedValue([makeMessage(1)]);

    await replayMissedMessages('user-1', socket, conn);

    const msg = socket.emit.mock.calls[0][1].messages[0];
    expect(msg.createdAt).toBe(EPOCH);
    expect(msg.updatedAt).toBe(EPOCH);
    expect(typeof msg.createdAt).toBe('number');
    expect(typeof msg.updatedAt).toBe('number');
  });

  it('emits correct event name "replay"', async () => {
    const socket = makeSocket({ lastSeq: 0 });
    const conn = makeSessionConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'sess-1' });
    mocks.dbMessageFindMany.mockResolvedValue([makeMessage(1)]);

    await replayMissedMessages('user-1', socket, conn);

    expect(socket.emit.mock.calls[0][0]).toBe('replay');
  });

  it('emits correct payload structure', async () => {
    const socket = makeSocket({ lastSeq: 3 });
    const conn = makeSessionConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'sess-1' });
    mocks.dbMessageFindMany.mockResolvedValue([
      makeMessage(4, { traceId: 'tid-4' }),
      makeMessage(5),
    ]);

    await replayMissedMessages('user-1', socket, conn);

    const payload = socket.emit.mock.calls[0][1];
    expect(payload).toEqual({
      sessionId: 'sess-1',
      messages: [
        {
          id: 'msg-4',
          seq: 4,
          content: { t: 'encrypted', c: 'data' },
          traceId: 'tid-4',
          createdAt: EPOCH,
          updatedAt: EPOCH,
        },
        {
          id: 'msg-5',
          seq: 5,
          content: { t: 'encrypted', c: 'data' },
          createdAt: EPOCH,
          updatedAt: EPOCH,
        },
      ],
      hasMore: false,
    });
  });
});

describe('user-scoped connection', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeUserConnection(): ClientConnection {
    return {
      connectionType: 'user-scoped',
      socket: {} as any,
      userId: 'user-1',
    };
  }

  it('replays for multiple sessions', async () => {
    const socket = makeSocket({
      lastSeqs: { 'sess-a': 2, 'sess-b': 5 },
    });
    const conn = makeUserConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'x' });
    mocks.dbMessageFindMany
      .mockResolvedValueOnce([makeMessage(3)])
      .mockResolvedValueOnce([makeMessage(6), makeMessage(7)]);

    await replayMissedMessages('user-1', socket, conn);

    expect(mocks.dbSessionFindFirst).toHaveBeenCalledTimes(2);
    expect(mocks.dbMessageFindMany).toHaveBeenCalledTimes(2);
    expect(socket.emit).toHaveBeenCalledTimes(2);

    // First call for sess-a
    expect(socket.emit.mock.calls[0][1].sessionId).toBe('sess-a');
    // Second call for sess-b
    expect(socket.emit.mock.calls[1][1].sessionId).toBe('sess-b');
  });

  it('skips sessions with negative lastSeq', async () => {
    const socket = makeSocket({
      lastSeqs: { 'sess-a': -1, 'sess-b': 3 },
    });
    const conn = makeUserConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'x' });
    mocks.dbMessageFindMany.mockResolvedValue([makeMessage(4)]);

    await replayMissedMessages('user-1', socket, conn);

    // Only sess-b should be processed
    expect(mocks.dbSessionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.dbSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sess-b', accountId: 'user-1' } })
    );
  });

  it('skips sessions with non-number lastSeq (string value)', async () => {
    const socket = makeSocket({
      lastSeqs: { 'sess-a': '10' as any, 'sess-b': 0 },
    });
    const conn = makeUserConnection();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: 'x' });
    mocks.dbMessageFindMany.mockResolvedValue([makeMessage(1)]);

    await replayMissedMessages('user-1', socket, conn);

    // Only sess-b should be processed
    expect(mocks.dbSessionFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.dbSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sess-b', accountId: 'user-1' } })
    );
  });

  it('skips when lastSeqs is undefined', async () => {
    const socket = makeSocket({});
    await replayMissedMessages('user-1', socket, makeUserConnection());

    expect(mocks.dbSessionFindFirst).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('skips when lastSeqs is null', async () => {
    const socket = makeSocket({ lastSeqs: null });
    await replayMissedMessages('user-1', socket, makeUserConnection());

    expect(mocks.dbSessionFindFirst).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('skips when lastSeqs is not an object (number)', async () => {
    const socket = makeSocket({ lastSeqs: 42 });
    await replayMissedMessages('user-1', socket, makeUserConnection());

    expect(mocks.dbSessionFindFirst).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('handles empty lastSeqs object (no replay)', async () => {
    const socket = makeSocket({ lastSeqs: {} });
    await replayMissedMessages('user-1', socket, makeUserConnection());

    expect(mocks.dbSessionFindFirst).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('verifies ownership per session — skips unowned', async () => {
    const socket = makeSocket({
      lastSeqs: { 'sess-owned': 0, 'sess-unowned': 0 },
    });
    const conn = makeUserConnection();
    mocks.dbSessionFindFirst
      .mockResolvedValueOnce({ id: 'sess-owned' })  // owned
      .mockResolvedValueOnce(null);                   // not owned
    mocks.dbMessageFindMany.mockResolvedValue([makeMessage(1)]);

    await replayMissedMessages('user-1', socket, conn);

    // findFirst called for both, but findMany only for owned
    expect(mocks.dbSessionFindFirst).toHaveBeenCalledTimes(2);
    expect(mocks.dbMessageFindMany).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit.mock.calls[0][1].sessionId).toBe('sess-owned');
  });
});

describe('machine-scoped connection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not replay (no DB calls, no emit)', async () => {
    const socket = makeSocket({ lastSeq: 5, lastSeqs: { 'sess-1': 0 } });
    const conn: ClientConnection = {
      connectionType: 'machine-scoped',
      socket: {} as any,
      userId: 'user-1',
      machineId: 'machine-1',
    };

    await replayMissedMessages('user-1', socket, conn);

    expect(mocks.dbSessionFindFirst).not.toHaveBeenCalled();
    expect(mocks.dbMessageFindMany).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });
});
