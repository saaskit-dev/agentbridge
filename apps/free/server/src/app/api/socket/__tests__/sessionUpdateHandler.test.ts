/**
 * sessionUpdateHandler unit tests
 *
 * Tests all 7 socket event handlers registered by sessionUpdateHandler:
 *   - update-metadata   (OCC metadata update)
 *   - update-state      (OCC agent state update)
 *   - update-capabilities (OCC capabilities update)
 *   - session-alive     (heartbeat / presence)
 *   - send-messages     (batch message creation with dedup)
 *   - fetch-messages    (forward + reverse pagination)
 *   - session-end       (archive session)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  dbSessionFindUnique: vi.fn(),
  dbSessionFindFirst: vi.fn(),
  dbSessionUpdateMany: vi.fn(),
  dbTransaction: vi.fn(),
  dbMessageFindMany: vi.fn(),
  dbMessageCreate: vi.fn(),
  allocateUserSeq: vi.fn(),
  allocateSessionSeqBatch: vi.fn(),
  allocateSessionSeq: vi.fn(),
  buildNewMessageUpdate: vi.fn(() => ({ type: 'new-message' })),
  buildUpdateSessionUpdate: vi.fn(() => ({ type: 'update-session' })),
  buildSessionActivityEphemeral: vi.fn(() => ({ type: 'session-activity' })),
  emitUpdate: vi.fn(),
  emitEphemeral: vi.fn(),
  metricsInc: vi.fn(),
  sessionAliveInc: vi.fn(),
  activityCacheIsValid: vi.fn(),
  activityCacheQueue: vi.fn(),
  activityCacheEvict: vi.fn(),
  broadcasterQueue: vi.fn(),
  broadcasterRemove: vi.fn(),
  broadcasterRecordContent: vi.fn(),
  randomKeyNaked: vi.fn(() => 'random12char'),
}));

vi.mock('@/storage/db', () => ({
  db: {
    session: {
      findUnique: mocks.dbSessionFindUnique,
      findFirst: mocks.dbSessionFindFirst,
      updateMany: mocks.dbSessionUpdateMany,
    },
    sessionMessage: {
      findMany: mocks.dbMessageFindMany,
      create: mocks.dbMessageCreate,
    },
    $transaction: mocks.dbTransaction,
  },
}));

vi.mock('@/storage/seq', () => ({
  allocateUserSeq: mocks.allocateUserSeq,
  allocateSessionSeqBatch: mocks.allocateSessionSeqBatch,
  allocateSessionSeq: mocks.allocateSessionSeq,
}));

vi.mock('@/app/events/eventRouter', () => ({
  eventRouter: {
    emitUpdate: mocks.emitUpdate,
    emitEphemeral: mocks.emitEphemeral,
  },
  buildNewMessageUpdate: mocks.buildNewMessageUpdate,
  buildUpdateSessionUpdate: mocks.buildUpdateSessionUpdate,
  buildSessionActivityEphemeral: mocks.buildSessionActivityEphemeral,
  ClientConnection: {},
}));

vi.mock('@/app/monitoring/metrics2', () => ({
  websocketEventsCounter: { inc: mocks.metricsInc },
  sessionAliveEventsCounter: { inc: mocks.sessionAliveInc },
}));

vi.mock('@/app/presence/sessionCache', () => ({
  activityCache: {
    isSessionValid: mocks.activityCacheIsValid,
    queueSessionUpdate: mocks.activityCacheQueue,
    evictSession: mocks.activityCacheEvict,
  },
}));

vi.mock('@/app/api/socket/activityBroadcaster', () => ({
  activityBroadcaster: {
    queue: mocks.broadcasterQueue,
    remove: mocks.broadcasterRemove,
    recordContent: mocks.broadcasterRecordContent,
  },
}));

vi.mock('@/utils/randomKeyNaked', () => ({
  randomKeyNaked: mocks.randomKeyNaked,
}));

vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    warn() {}
    info() {}
    error() {}
    debug() {}
  },
}));

vi.mock('@saaskit-dev/agentbridge', () => ({
  safeStringify: (x: any) => String(x),
}));

vi.mock('@/utils/lock', () => ({
  AsyncLock: class {
    async inLock<T>(fn: () => Promise<T> | T): Promise<T> {
      return await fn();
    }
  },
}));

import { sessionUpdateHandler } from '../sessionUpdateHandler';
import type { ClientConnection } from '@/app/events/eventRouter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSocket() {
  const handlers: Record<string, (...args: any[]) => any> = {};
  return {
    on: vi.fn((event: string, handler: (...args: any[]) => any) => {
      handlers[event] = handler;
    }),
    emit: vi.fn(),
    trigger: async (event: string, data: any, callback?: (r: any) => void) => {
      const handler = handlers[event];
      if (!handler) throw new Error(`No handler for ${event}`);
      if (callback) {
        return new Promise<any>(resolve => {
          handler(data, (result: any) => {
            resolve(result);
            callback(result);
          });
        });
      }
      return handler(data);
    },
    triggerWithAck: async (event: string, data: any): Promise<any> => {
      return new Promise(resolve => {
        handlers[event](data, resolve);
      });
    },
  };
}

const USER_ID = 'user-1';
const SESSION_ID = 'sess-abc';
const CONNECTION: ClientConnection = {
  connectionType: 'session-scoped',
  sessionId: SESSION_ID,
  socket: {} as any,
  userId: USER_ID,
  isDaemon: true,
};

function setupHandler() {
  const socket = makeSocket();
  sessionUpdateHandler(USER_ID, socket as any, CONNECTION);
  return socket;
}

function makeDate(offset = 0) {
  return new Date(Date.now() + offset);
}

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mocks.allocateUserSeq.mockResolvedValue(100);
  mocks.dbTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
    return fn({
      sessionMessage: {
        findMany: mocks.dbMessageFindMany,
        create: mocks.dbMessageCreate,
      },
    });
  });
});

// ===========================================================================
// send-messages
// ===========================================================================

describe('send-messages', () => {
  it('rejects missing sessionId', async () => {
    const socket = setupHandler();
    const result = await socket.triggerWithAck('send-messages', { messages: [{ id: '1', content: 'hi' }] });
    expect(result).toEqual({ ok: false, error: 'Missing sessionId' });
  });

  it('rejects non-string sessionId', async () => {
    const socket = setupHandler();
    const result = await socket.triggerWithAck('send-messages', { sessionId: 123, messages: [{ id: '1', content: 'hi' }] });
    expect(result).toEqual({ ok: false, error: 'Missing sessionId' });
  });

  it('rejects missing messages array', async () => {
    const socket = setupHandler();
    const result = await socket.triggerWithAck('send-messages', { sessionId: SESSION_ID });
    expect(result).toEqual({ ok: false, error: 'messages must be an array of 1-100 items' });
  });

  it('rejects empty messages array', async () => {
    const socket = setupHandler();
    const result = await socket.triggerWithAck('send-messages', { sessionId: SESSION_ID, messages: [] });
    expect(result).toEqual({ ok: false, error: 'messages must be an array of 1-100 items' });
  });

  it('rejects batch exceeding 100 messages', async () => {
    const socket = setupHandler();
    const messages = Array.from({ length: 101 }, (_, i) => ({ id: `m${i}`, content: 'x' }));
    const result = await socket.triggerWithAck('send-messages', { sessionId: SESSION_ID, messages });
    expect(result).toEqual({ ok: false, error: 'messages must be an array of 1-100 items' });
  });

  it('rejects message without id', async () => {
    const socket = setupHandler();
    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ content: 'hi' }],
    });
    expect(result).toEqual({ ok: false, error: 'Each message must have a string id' });
  });

  it('rejects message with empty string id', async () => {
    const socket = setupHandler();
    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: '', content: 'hi' }],
    });
    expect(result).toEqual({ ok: false, error: 'Each message must have a string id' });
  });

  it('rejects message without content (typeof !== string)', async () => {
    const socket = setupHandler();
    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'msg1', content: 123 }],
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('Message content too large or invalid') });
  });

  it('rejects message content exceeding size limit', async () => {
    const socket = setupHandler();
    // Default limit is 10_000_000
    const bigContent = 'x'.repeat(10_000_001);
    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'msg1', content: bigContent }],
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('Message content too large or invalid') });
  });

  it('rejects when session not found', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindFirst.mockResolvedValue(null);
    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'msg1', content: 'hi' }],
    });
    expect(result).toEqual({ ok: false, error: 'Session not found' });
    expect(mocks.dbSessionFindFirst).toHaveBeenCalledWith({
      where: { id: SESSION_ID, accountId: USER_ID },
      select: { id: true },
    });
  });

  function setupSessionFound() {
    mocks.dbSessionFindFirst.mockResolvedValue({ id: SESSION_ID });
    mocks.dbMessageFindMany.mockResolvedValue([]);
  }

  it('creates single message and returns seq', async () => {
    const socket = setupHandler();
    setupSessionFound();
    const now = new Date();
    mocks.allocateSessionSeqBatch.mockResolvedValue([1]);
    mocks.dbMessageCreate.mockResolvedValue({
      id: 'msg1', seq: 1, traceId: null, createdAt: now, updatedAt: now,
    });

    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'msg1', content: 'hello' }],
    });

    expect(result.ok).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      id: 'msg1',
      seq: 1,
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    });
  });

  it('creates multiple messages with sequential seqs', async () => {
    const socket = setupHandler();
    setupSessionFound();
    const now = new Date();
    mocks.allocateSessionSeqBatch.mockResolvedValue([1, 2, 3]);
    mocks.dbMessageCreate
      .mockResolvedValueOnce({ id: 'a', seq: 1, traceId: null, createdAt: now, updatedAt: now })
      .mockResolvedValueOnce({ id: 'b', seq: 2, traceId: null, createdAt: now, updatedAt: now })
      .mockResolvedValueOnce({ id: 'c', seq: 3, traceId: null, createdAt: now, updatedAt: now });

    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [
        { id: 'a', content: '1' },
        { id: 'b', content: '2' },
        { id: 'c', content: '3' },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.messages).toHaveLength(3);
    expect(result.messages.map((m: any) => m.seq)).toEqual([1, 2, 3]);
  });

  it('includes traceId in response when _trace present', async () => {
    const socket = setupHandler();
    setupSessionFound();
    const now = new Date();
    mocks.allocateSessionSeqBatch.mockResolvedValue([1]);
    mocks.dbMessageCreate.mockResolvedValue({
      id: 'msg1', seq: 1, traceId: 'trace-123', createdAt: now, updatedAt: now,
    });

    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'msg1', content: 'hi', _trace: { tid: 'trace-123' } }],
    });

    expect(result.ok).toBe(true);
    expect(result.messages[0].traceId).toBe('trace-123');
  });

  it('omits traceId when no _trace', async () => {
    const socket = setupHandler();
    setupSessionFound();
    const now = new Date();
    mocks.allocateSessionSeqBatch.mockResolvedValue([1]);
    mocks.dbMessageCreate.mockResolvedValue({
      id: 'msg1', seq: 1, traceId: null, createdAt: now, updatedAt: now,
    });

    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'msg1', content: 'hi' }],
    });

    expect(result.ok).toBe(true);
    expect(result.messages[0]).not.toHaveProperty('traceId');
  });

  it('returns createdAt and updatedAt as epoch ms', async () => {
    const socket = setupHandler();
    setupSessionFound();
    const created = new Date('2026-01-15T10:00:00Z');
    const updated = new Date('2026-01-15T10:00:01Z');
    mocks.allocateSessionSeqBatch.mockResolvedValue([1]);
    mocks.dbMessageCreate.mockResolvedValue({
      id: 'msg1', seq: 1, traceId: null, createdAt: created, updatedAt: updated,
    });

    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'msg1', content: 'hi' }],
    });

    expect(result.messages[0].createdAt).toBe(created.getTime());
    expect(result.messages[0].updatedAt).toBe(updated.getTime());
  });

  it('broadcasts new messages via emitUpdate with skipSenderConnection', async () => {
    const socket = setupHandler();
    setupSessionFound();
    const now = new Date();
    mocks.allocateSessionSeqBatch.mockResolvedValue([1]);
    mocks.dbMessageCreate.mockResolvedValue({
      id: 'msg1', seq: 1, traceId: null, createdAt: now, updatedAt: now,
    });

    await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'msg1', content: 'hello' }],
    });

    expect(mocks.buildNewMessageUpdate).toHaveBeenCalledWith(
      { id: 'msg1', seq: 1, traceId: null, createdAt: now, updatedAt: now, content: { t: 'encrypted', c: 'hello' } },
      SESSION_ID,
      100,
      'random12char',
      undefined,
    );
    expect(mocks.emitUpdate).toHaveBeenCalledWith({
      userId: USER_ID,
      payload: { type: 'new-message' },
      recipientFilter: { type: 'all-interested-in-session', sessionId: SESSION_ID },
      skipSenderConnection: CONNECTION,
    });
  });

  it('deduplicates messages with same id in batch (keeps first)', async () => {
    const socket = setupHandler();
    setupSessionFound();
    const now = new Date();
    mocks.allocateSessionSeqBatch.mockResolvedValue([1]);
    mocks.dbMessageCreate.mockResolvedValue({
      id: 'dup', seq: 1, traceId: null, createdAt: now, updatedAt: now,
    });

    await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [
        { id: 'dup', content: 'first' },
        { id: 'dup', content: 'second' },
      ],
    });

    // Only one message should be created (the first one)
    expect(mocks.allocateSessionSeqBatch).toHaveBeenCalledWith(SESSION_ID, 1, expect.anything());
    expect(mocks.dbMessageCreate).toHaveBeenCalledTimes(1);
    expect(mocks.dbMessageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        content: { t: 'encrypted', c: 'first' },
      }),
    }));
  });

  it('skips creation for already-existing message ids', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: SESSION_ID });
    const now = new Date();
    mocks.dbMessageFindMany.mockResolvedValue([
      { id: 'existing', seq: 5, traceId: null, createdAt: now, updatedAt: now },
    ]);
    mocks.allocateSessionSeqBatch.mockResolvedValue([]);

    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'existing', content: 'already there' }],
    });

    expect(result.ok).toBe(true);
    expect(mocks.dbMessageCreate).not.toHaveBeenCalled();
    expect(mocks.allocateSessionSeqBatch).toHaveBeenCalledWith(SESSION_ID, 0, expect.anything());
  });

  it('returns existing message metadata for duplicate sends', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: SESSION_ID });
    const now = new Date();
    mocks.dbMessageFindMany.mockResolvedValue([
      { id: 'existing', seq: 5, traceId: 'trace-old', createdAt: now, updatedAt: now },
    ]);
    mocks.allocateSessionSeqBatch.mockResolvedValue([]);

    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'existing', content: 'retry' }],
    });

    expect(result.ok).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      id: 'existing',
      seq: 5,
      traceId: 'trace-old',
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    });
  });

  it('does not broadcast already-existing messages', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: SESSION_ID });
    const now = new Date();
    mocks.dbMessageFindMany.mockResolvedValue([
      { id: 'existing', seq: 5, traceId: null, createdAt: now, updatedAt: now },
    ]);
    mocks.allocateSessionSeqBatch.mockResolvedValue([]);

    await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'existing', content: 'retry' }],
    });

    expect(mocks.emitUpdate).not.toHaveBeenCalled();
  });

  it('serializes concurrent sends via lock', async () => {
    // We use the pass-through mock, so calls are sequential.
    // Verify the handler is wrapped in inLock by checking that two
    // sends both succeed (they go through the lock).
    const socket = setupHandler();
    setupSessionFound();
    const now = new Date();
    mocks.allocateSessionSeqBatch.mockResolvedValue([1]);
    mocks.dbMessageCreate.mockResolvedValue({
      id: 'msg1', seq: 1, traceId: null, createdAt: now, updatedAt: now,
    });

    const [r1, r2] = await Promise.all([
      socket.triggerWithAck('send-messages', {
        sessionId: SESSION_ID,
        messages: [{ id: 'msg1', content: 'a' }],
      }),
      socket.triggerWithAck('send-messages', {
        sessionId: SESSION_ID,
        messages: [{ id: 'msg2', content: 'b' }],
      }),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('returns Internal error on transaction failure', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindFirst.mockResolvedValue({ id: SESSION_ID });
    mocks.dbTransaction.mockRejectedValue(new Error('DB down'));

    const result = await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'msg1', content: 'hi' }],
    });

    expect(result).toEqual({ ok: false, error: 'Internal error' });
  });

  it('calls activityBroadcaster.recordContent after success', async () => {
    const socket = setupHandler();
    setupSessionFound();
    const now = new Date();
    mocks.allocateSessionSeqBatch.mockResolvedValue([1]);
    mocks.dbMessageCreate.mockResolvedValue({
      id: 'msg1', seq: 1, traceId: null, createdAt: now, updatedAt: now,
    });

    await socket.triggerWithAck('send-messages', {
      sessionId: SESSION_ID,
      messages: [{ id: 'msg1', content: 'hi' }],
    });

    expect(mocks.broadcasterRecordContent).toHaveBeenCalledWith(SESSION_ID);
  });
});

// ===========================================================================
// fetch-messages
// ===========================================================================

describe('fetch-messages', () => {
  it('rejects missing sessionId', async () => {
    const socket = setupHandler();
    const result = await socket.triggerWithAck('fetch-messages', {});
    expect(result).toEqual({ ok: false, error: 'Missing sessionId' });
  });

  it('rejects when session not found', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindFirst.mockResolvedValue(null);
    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID });
    expect(result).toEqual({ ok: false, error: 'Session not found' });
  });

  function setupFetchSession() {
    mocks.dbSessionFindFirst.mockResolvedValue({ id: SESSION_ID });
  }

  it('forward pagination: fetches after_seq', async () => {
    const socket = setupHandler();
    setupFetchSession();
    const now = new Date();
    mocks.dbMessageFindMany.mockResolvedValue([
      { id: 'm1', seq: 6, content: { t: 'encrypted', c: 'hi' }, traceId: null, createdAt: now, updatedAt: now },
    ]);

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID, after_seq: 5 });

    expect(mocks.dbMessageFindMany).toHaveBeenCalledWith({
      where: { sessionId: SESSION_ID, seq: { gt: 5 } },
      orderBy: { seq: 'asc' },
      take: 1001,
      select: { id: true, seq: true, content: true, traceId: true, createdAt: true, updatedAt: true },
    });
    expect(result.ok).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.hasMore).toBe(false);
  });

  it('forward pagination: default after_seq=0', async () => {
    const socket = setupHandler();
    setupFetchSession();
    mocks.dbMessageFindMany.mockResolvedValue([]);

    await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID });

    expect(mocks.dbMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: SESSION_ID, seq: { gt: 0 } } }),
    );
  });

  it('forward pagination: hasMore=true when exceeds limit', async () => {
    const socket = setupHandler();
    setupFetchSession();
    const now = new Date();
    // Return limit+1 items to trigger hasMore
    const messages = Array.from({ length: 3 }, (_, i) => ({
      id: `m${i}`, seq: i + 1, content: { t: 'encrypted', c: '' }, traceId: null, createdAt: now, updatedAt: now,
    }));
    mocks.dbMessageFindMany.mockResolvedValue(messages);

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID, limit: 2 });

    expect(result.ok).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it('forward pagination: hasMore=false', async () => {
    const socket = setupHandler();
    setupFetchSession();
    const now = new Date();
    mocks.dbMessageFindMany.mockResolvedValue([
      { id: 'm1', seq: 1, content: { t: 'encrypted', c: '' }, traceId: null, createdAt: now, updatedAt: now },
    ]);

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID, limit: 5 });

    expect(result.hasMore).toBe(false);
  });

  it('forward pagination: empty results', async () => {
    const socket = setupHandler();
    setupFetchSession();
    mocks.dbMessageFindMany.mockResolvedValue([]);

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID });

    expect(result.ok).toBe(true);
    expect(result.messages).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it('reverse pagination: fetches before_seq', async () => {
    const socket = setupHandler();
    setupFetchSession();
    const now = new Date();
    mocks.dbMessageFindMany.mockResolvedValue([
      { id: 'm2', seq: 2, content: { t: 'encrypted', c: '' }, traceId: null, createdAt: now, updatedAt: now },
    ]);

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID, before_seq: 3 });

    expect(mocks.dbMessageFindMany).toHaveBeenCalledWith({
      where: { sessionId: SESSION_ID, seq: { lt: 3 } },
      orderBy: { seq: 'desc' },
      take: 1001,
      select: { id: true, seq: true, content: true, traceId: true, createdAt: true, updatedAt: true },
    });
    expect(result.ok).toBe(true);
  });

  it('reverse pagination: reverses to ASC order', async () => {
    const socket = setupHandler();
    setupFetchSession();
    const now = new Date();
    // DB returns DESC order
    mocks.dbMessageFindMany.mockResolvedValue([
      { id: 'm3', seq: 3, content: { c: 'c' }, traceId: null, createdAt: now, updatedAt: now },
      { id: 'm2', seq: 2, content: { c: 'b' }, traceId: null, createdAt: now, updatedAt: now },
      { id: 'm1', seq: 1, content: { c: 'a' }, traceId: null, createdAt: now, updatedAt: now },
    ]);

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID, before_seq: 10 });

    // Should be reversed to ASC
    expect(result.messages.map((m: any) => m.seq)).toEqual([1, 2, 3]);
  });

  it('reverse pagination: hasOlderMessages=true', async () => {
    const socket = setupHandler();
    setupFetchSession();
    const now = new Date();
    // Return limit+1 items
    const messages = Array.from({ length: 3 }, (_, i) => ({
      id: `m${i}`, seq: 3 - i, content: { c: '' }, traceId: null, createdAt: now, updatedAt: now,
    }));
    mocks.dbMessageFindMany.mockResolvedValue(messages);

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID, before_seq: 10, limit: 2 });

    expect(result.hasOlderMessages).toBe(true);
    expect(result.messages).toHaveLength(2);
  });

  it('reverse pagination: hasOlderMessages=false', async () => {
    const socket = setupHandler();
    setupFetchSession();
    const now = new Date();
    mocks.dbMessageFindMany.mockResolvedValue([
      { id: 'm1', seq: 1, content: { c: '' }, traceId: null, createdAt: now, updatedAt: now },
    ]);

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID, before_seq: 5, limit: 10 });

    expect(result.hasOlderMessages).toBe(false);
  });

  it('reverse pagination: hasMore always false', async () => {
    const socket = setupHandler();
    setupFetchSession();
    mocks.dbMessageFindMany.mockResolvedValue([]);

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID, before_seq: 5 });

    expect(result.hasMore).toBe(false);
  });

  it('limit: default 1000', async () => {
    const socket = setupHandler();
    setupFetchSession();
    mocks.dbMessageFindMany.mockResolvedValue([]);

    await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID });

    expect(mocks.dbMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1001 }),
    );
  });

  it.each([
    { input: 0, expected: 1001 },
    { input: -1, expected: 1001 },
    { input: 1001, expected: 1001 },
    { input: 'not-a-number', expected: 1001 },
  ])('limit: clamps invalid value $input to default', async ({ input, expected }) => {
    const socket = setupHandler();
    setupFetchSession();
    mocks.dbMessageFindMany.mockResolvedValue([]);

    await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID, limit: input });

    expect(mocks.dbMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: expected }),
    );
  });

  it('limit: accepts valid custom (50)', async () => {
    const socket = setupHandler();
    setupFetchSession();
    mocks.dbMessageFindMany.mockResolvedValue([]);

    await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID, limit: 50 });

    expect(mocks.dbMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51 }),
    );
  });

  it('before_seq takes priority over after_seq', async () => {
    const socket = setupHandler();
    setupFetchSession();
    mocks.dbMessageFindMany.mockResolvedValue([]);

    await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID, before_seq: 10, after_seq: 5 });

    // Should use before_seq path (DESC query)
    expect(mocks.dbMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: SESSION_ID, seq: { lt: 10 } },
        orderBy: { seq: 'desc' },
      }),
    );
  });

  it('includes content in response', async () => {
    const socket = setupHandler();
    setupFetchSession();
    const now = new Date();
    mocks.dbMessageFindMany.mockResolvedValue([
      { id: 'm1', seq: 1, content: { t: 'encrypted', c: 'hello' }, traceId: null, createdAt: now, updatedAt: now },
    ]);

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID });

    expect(result.messages[0].content).toEqual({ t: 'encrypted', c: 'hello' });
  });

  it('includes traceId only when present', async () => {
    const socket = setupHandler();
    setupFetchSession();
    const now = new Date();
    mocks.dbMessageFindMany.mockResolvedValue([
      { id: 'm1', seq: 1, content: {}, traceId: 'tid-1', createdAt: now, updatedAt: now },
      { id: 'm2', seq: 2, content: {}, traceId: null, createdAt: now, updatedAt: now },
    ]);

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID });

    expect(result.messages[0].traceId).toBe('tid-1');
    expect(result.messages[1]).not.toHaveProperty('traceId');
  });

  it('converts dates to epoch ms', async () => {
    const socket = setupHandler();
    setupFetchSession();
    const created = new Date('2026-02-01T12:00:00Z');
    const updated = new Date('2026-02-01T12:01:00Z');
    mocks.dbMessageFindMany.mockResolvedValue([
      { id: 'm1', seq: 1, content: {}, traceId: null, createdAt: created, updatedAt: updated },
    ]);

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID });

    expect(result.messages[0].createdAt).toBe(created.getTime());
    expect(result.messages[0].updatedAt).toBe(updated.getTime());
  });

  it('returns Internal error on DB failure', async () => {
    const socket = setupHandler();
    setupFetchSession();
    mocks.dbMessageFindMany.mockRejectedValue(new Error('DB error'));

    const result = await socket.triggerWithAck('fetch-messages', { sessionId: SESSION_ID });

    expect(result).toEqual({ ok: false, error: 'Internal error' });
  });
});

// ===========================================================================
// update-metadata
// ===========================================================================

describe('update-metadata', () => {
  const baseSession = {
    id: SESSION_ID,
    accountId: USER_ID,
    metadata: '{"title":"old"}',
    metadataVersion: 1,
  };

  it('rejects invalid input (missing sid, non-string metadata, non-number version)', async () => {
    const socket = setupHandler();

    const r1 = await socket.triggerWithAck('update-metadata', { metadata: 'x', expectedVersion: 1 });
    expect(r1).toEqual({ result: 'error' });

    const r2 = await socket.triggerWithAck('update-metadata', { sid: SESSION_ID, metadata: 123, expectedVersion: 1 });
    expect(r2).toEqual({ result: 'error' });

    const r3 = await socket.triggerWithAck('update-metadata', { sid: SESSION_ID, metadata: 'x', expectedVersion: 'abc' });
    expect(r3).toEqual({ result: 'error' });
  });

  it('rejects when session not found', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(null);

    const result = await socket.triggerWithAck('update-metadata', {
      sid: SESSION_ID, metadata: '{}', expectedVersion: 1,
    });

    expect(result).toEqual({ result: 'error' });
    expect(mocks.dbSessionFindUnique).toHaveBeenCalledWith({
      where: { id: SESSION_ID, accountId: USER_ID },
    });
  });

  it('returns version-mismatch when version differs', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue({ ...baseSession, metadataVersion: 5 });

    const result = await socket.triggerWithAck('update-metadata', {
      sid: SESSION_ID, metadata: '{}', expectedVersion: 3,
    });

    expect(result).toEqual({
      result: 'version-mismatch',
      version: 5,
      metadata: '{"title":"old"}',
    });
  });

  it('updates on version match, returns success', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(baseSession);
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.allocateUserSeq.mockResolvedValue(42);

    const result = await socket.triggerWithAck('update-metadata', {
      sid: SESSION_ID, metadata: '{"title":"new"}', expectedVersion: 1,
    });

    expect(result).toEqual({ result: 'success', version: 2, metadata: '{"title":"new"}' });
    expect(mocks.dbSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: SESSION_ID, accountId: USER_ID, metadataVersion: 1 },
      data: { metadata: '{"title":"new"}', metadataVersion: 2 },
    });
  });

  it('handles concurrent update (count=0, re-fetch returns latest)', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(baseSession);
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 0 });
    mocks.dbSessionFindFirst.mockResolvedValue({ metadataVersion: 3, metadata: '{"title":"concurrent"}' });

    const result = await socket.triggerWithAck('update-metadata', {
      sid: SESSION_ID, metadata: '{}', expectedVersion: 1,
    });

    expect(result).toEqual({
      result: 'version-mismatch',
      version: 3,
      metadata: '{"title":"concurrent"}',
    });
  });

  it('handles concurrent update where session deleted (re-fetch null)', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(baseSession);
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 0 });
    mocks.dbSessionFindFirst.mockResolvedValue(null);

    const result = await socket.triggerWithAck('update-metadata', {
      sid: SESSION_ID, metadata: '{}', expectedVersion: 1,
    });

    expect(result).toEqual({ result: 'error' });
  });

  it('broadcasts update-session', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(baseSession);
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.allocateUserSeq.mockResolvedValue(42);

    await socket.triggerWithAck('update-metadata', {
      sid: SESSION_ID, metadata: '{"title":"new"}', expectedVersion: 1,
    });

    expect(mocks.buildUpdateSessionUpdate).toHaveBeenCalledWith(
      SESSION_ID,
      42,
      'random12char',
      { value: '{"title":"new"}', version: 2 },
      undefined,
      undefined,
    );
    expect(mocks.emitUpdate).toHaveBeenCalledWith({
      userId: USER_ID,
      payload: { type: 'update-session' },
      recipientFilter: { type: 'all-interested-in-session', sessionId: SESSION_ID },
    });
  });

  it('handles missing callback in catch', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockRejectedValue(new Error('boom'));

    // Trigger without callback — should not throw
    await socket.trigger('update-metadata', {
      sid: SESSION_ID, metadata: '{}', expectedVersion: 1,
    });
    // If we get here, no error was thrown — that's the assertion
  });
});

// ===========================================================================
// update-state
// ===========================================================================

describe('update-state', () => {
  const baseSession = {
    id: SESSION_ID,
    accountId: USER_ID,
    agentState: '{"status":"running"}',
    agentStateVersion: 1,
  };

  it('rejects invalid input', async () => {
    const socket = setupHandler();

    const r1 = await socket.triggerWithAck('update-state', { agentState: 'x', expectedVersion: 1 });
    expect(r1).toEqual({ result: 'error' });

    const r2 = await socket.triggerWithAck('update-state', { sid: SESSION_ID, agentState: 123, expectedVersion: 1 });
    expect(r2).toEqual({ result: 'error' });

    const r3 = await socket.triggerWithAck('update-state', { sid: SESSION_ID, agentState: 'x', expectedVersion: 'abc' });
    expect(r3).toEqual({ result: 'error' });
  });

  it('accepts null agentState', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue({ ...baseSession, agentState: null, agentStateVersion: 1 });
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.allocateUserSeq.mockResolvedValue(10);

    const result = await socket.triggerWithAck('update-state', {
      sid: SESSION_ID, agentState: null, expectedVersion: 1,
    });

    expect(result).toEqual({ result: 'success', version: 2, agentState: null });
  });

  it('rejects non-string non-null agentState', async () => {
    const socket = setupHandler();
    const result = await socket.triggerWithAck('update-state', {
      sid: SESSION_ID, agentState: { obj: true }, expectedVersion: 1,
    });
    expect(result).toEqual({ result: 'error' });
  });

  it('returns version-mismatch', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue({ ...baseSession, agentStateVersion: 5 });

    const result = await socket.triggerWithAck('update-state', {
      sid: SESSION_ID, agentState: 'x', expectedVersion: 3,
    });

    expect(result).toEqual({
      result: 'version-mismatch',
      version: 5,
      agentState: '{"status":"running"}',
    });
  });

  it('updates on version match', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(baseSession);
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.allocateUserSeq.mockResolvedValue(10);

    const result = await socket.triggerWithAck('update-state', {
      sid: SESSION_ID, agentState: '{"status":"idle"}', expectedVersion: 1,
    });

    expect(result).toEqual({ result: 'success', version: 2, agentState: '{"status":"idle"}' });
    expect(mocks.dbSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: SESSION_ID, accountId: USER_ID, agentStateVersion: 1 },
      data: { agentState: '{"status":"idle"}', agentStateVersion: 2 },
    });
  });

  it('handles concurrent update (count=0)', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(baseSession);
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 0 });
    mocks.dbSessionFindFirst.mockResolvedValue({ agentStateVersion: 4, agentState: 'latest' });

    const result = await socket.triggerWithAck('update-state', {
      sid: SESSION_ID, agentState: 'new', expectedVersion: 1,
    });

    expect(result).toEqual({
      result: 'version-mismatch',
      version: 4,
      agentState: 'latest',
    });
  });

  it('handles concurrent update session deleted', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(baseSession);
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 0 });
    mocks.dbSessionFindFirst.mockResolvedValue(null);

    const result = await socket.triggerWithAck('update-state', {
      sid: SESSION_ID, agentState: 'new', expectedVersion: 1,
    });

    expect(result).toEqual({ result: 'error' });
  });

  it('broadcasts with agentState field', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(baseSession);
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.allocateUserSeq.mockResolvedValue(10);

    await socket.triggerWithAck('update-state', {
      sid: SESSION_ID, agentState: 'new-state', expectedVersion: 1,
    });

    expect(mocks.buildUpdateSessionUpdate).toHaveBeenCalledWith(
      SESSION_ID,
      10,
      'random12char',
      undefined,
      { value: 'new-state', version: 2 },
      undefined,
    );
    expect(mocks.emitUpdate).toHaveBeenCalledWith({
      userId: USER_ID,
      payload: { type: 'update-session' },
      recipientFilter: { type: 'all-interested-in-session', sessionId: SESSION_ID },
    });
  });

  it('calls callback WITHOUT if(callback) guard on session not found', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(null);

    const result = await socket.triggerWithAck('update-state', {
      sid: SESSION_ID, agentState: 'x', expectedVersion: 1,
    });

    // update-state calls callback({ result: 'error' }) directly (no guard)
    expect(result).toEqual({ result: 'error' });
  });
});

// ===========================================================================
// update-capabilities
// ===========================================================================

describe('update-capabilities', () => {
  const baseSession = {
    id: SESSION_ID,
    accountId: USER_ID,
    capabilities: '{"tools":true}',
    capabilitiesVersion: 1,
  };

  it('rejects invalid input', async () => {
    const socket = setupHandler();

    const r1 = await socket.triggerWithAck('update-capabilities', { capabilities: 'x', expectedVersion: 1 });
    expect(r1).toEqual({ result: 'error' });

    const r2 = await socket.triggerWithAck('update-capabilities', { sid: SESSION_ID, capabilities: 123, expectedVersion: 1 });
    expect(r2).toEqual({ result: 'error' });

    const r3 = await socket.triggerWithAck('update-capabilities', { sid: SESSION_ID, capabilities: 'x', expectedVersion: 'abc' });
    expect(r3).toEqual({ result: 'error' });
  });

  it('accepts null capabilities', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue({ ...baseSession, capabilities: null, capabilitiesVersion: 1 });
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.allocateUserSeq.mockResolvedValue(10);

    const result = await socket.triggerWithAck('update-capabilities', {
      sid: SESSION_ID, capabilities: null, expectedVersion: 1,
    });

    expect(result).toEqual({ result: 'success', version: 2, capabilities: null });
  });

  it('returns version-mismatch', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue({ ...baseSession, capabilitiesVersion: 5 });

    const result = await socket.triggerWithAck('update-capabilities', {
      sid: SESSION_ID, capabilities: 'x', expectedVersion: 3,
    });

    expect(result).toEqual({
      result: 'version-mismatch',
      version: 5,
      capabilities: '{"tools":true}',
    });
  });

  it('updates on version match', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(baseSession);
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.allocateUserSeq.mockResolvedValue(10);

    const result = await socket.triggerWithAck('update-capabilities', {
      sid: SESSION_ID, capabilities: '{"tools":false}', expectedVersion: 1,
    });

    expect(result).toEqual({ result: 'success', version: 2, capabilities: '{"tools":false}' });
    expect(mocks.dbSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: SESSION_ID, accountId: USER_ID, capabilitiesVersion: 1 },
      data: { capabilities: '{"tools":false}', capabilitiesVersion: 2 },
    });
  });

  it('handles concurrent update', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(baseSession);
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 0 });
    mocks.dbSessionFindFirst.mockResolvedValue({ capabilitiesVersion: 4, capabilities: 'latest' });

    const result = await socket.triggerWithAck('update-capabilities', {
      sid: SESSION_ID, capabilities: 'new', expectedVersion: 1,
    });

    expect(result).toEqual({
      result: 'version-mismatch',
      version: 4,
      capabilities: 'latest',
    });
  });

  it('handles concurrent update session deleted', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(baseSession);
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 0 });
    mocks.dbSessionFindFirst.mockResolvedValue(null);

    const result = await socket.triggerWithAck('update-capabilities', {
      sid: SESSION_ID, capabilities: 'new', expectedVersion: 1,
    });

    expect(result).toEqual({ result: 'error' });
  });

  it('broadcasts with capabilities field', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(baseSession);
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.allocateUserSeq.mockResolvedValue(10);

    await socket.triggerWithAck('update-capabilities', {
      sid: SESSION_ID, capabilities: '{"new":true}', expectedVersion: 1,
    });

    expect(mocks.buildUpdateSessionUpdate).toHaveBeenCalledWith(
      SESSION_ID,
      10,
      'random12char',
      undefined,
      undefined,
      undefined,
      { value: '{"new":true}', version: 2 },
    );
    expect(mocks.emitUpdate).toHaveBeenCalledWith({
      userId: USER_ID,
      payload: { type: 'update-session' },
      recipientFilter: { type: 'all-interested-in-session', sessionId: SESSION_ID },
    });
  });

  it('NO if(callback) guard in catch — throws when callback undefined', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockRejectedValue(new Error('boom'));

    // Trigger without callback — the catch block calls callback({ result: 'error' })
    // without checking if callback exists, so it should throw
    await expect(
      socket.trigger('update-capabilities', {
        sid: SESSION_ID, capabilities: 'x', expectedVersion: 1,
      }),
    ).rejects.toThrow();
  });
});

// ===========================================================================
// session-alive
// ===========================================================================

describe('session-alive', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;
  const NOW = 1711500000000;

  beforeEach(() => {
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  it('ignores missing time', async () => {
    const socket = setupHandler();
    await socket.trigger('session-alive', { sid: SESSION_ID });

    expect(mocks.activityCacheIsValid).not.toHaveBeenCalled();
  });

  it('ignores missing sid', async () => {
    const socket = setupHandler();
    await socket.trigger('session-alive', { time: NOW });

    expect(mocks.activityCacheIsValid).not.toHaveBeenCalled();
  });

  it('clamps future time', async () => {
    const socket = setupHandler();
    mocks.activityCacheIsValid.mockResolvedValue('active');

    await socket.trigger('session-alive', { sid: SESSION_ID, time: NOW + 10000 });

    // The broadcaster should receive NOW (clamped), not NOW+10000
    expect(mocks.broadcasterQueue).toHaveBeenCalledWith(USER_ID, SESSION_ID, true, NOW, false);
  });

  it('ignores time older than 3 minutes', async () => {
    const socket = setupHandler();
    const oldTime = NOW - 1000 * 60 * 3 - 1;

    await socket.trigger('session-alive', { sid: SESSION_ID, time: oldTime });

    expect(mocks.activityCacheIsValid).not.toHaveBeenCalled();
  });

  it('emits session-archived when archived', async () => {
    const socket = setupHandler();
    mocks.activityCacheIsValid.mockResolvedValue('archived');

    await socket.trigger('session-alive', { sid: SESSION_ID, time: NOW });

    expect(mocks.broadcasterRemove).toHaveBeenCalledWith(USER_ID, SESSION_ID);
    expect(socket.emit).toHaveBeenCalledWith('session-archived', { sid: SESSION_ID });
  });

  it('emits session-archived when deleted', async () => {
    const socket = setupHandler();
    mocks.activityCacheIsValid.mockResolvedValue('deleted');

    await socket.trigger('session-alive', { sid: SESSION_ID, time: NOW });

    expect(mocks.broadcasterRemove).toHaveBeenCalledWith(USER_ID, SESSION_ID);
    expect(socket.emit).toHaveBeenCalledWith('session-archived', { sid: SESSION_ID });
  });

  it('removes from broadcaster on invalid', async () => {
    const socket = setupHandler();
    mocks.activityCacheIsValid.mockResolvedValue('invalid');

    await socket.trigger('session-alive', { sid: SESSION_ID, time: NOW });

    expect(mocks.broadcasterRemove).toHaveBeenCalledWith(USER_ID, SESSION_ID);
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('re-activates offline session', async () => {
    const socket = setupHandler();
    mocks.activityCacheIsValid.mockResolvedValue('offline');
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });

    await socket.trigger('session-alive', { sid: SESSION_ID, time: NOW - 1000 });

    expect(mocks.dbSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: SESSION_ID, accountId: USER_ID, status: 'offline' },
      data: { status: 'active', lastActiveAt: new Date(NOW - 1000) },
    });
    expect(mocks.activityCacheEvict).toHaveBeenCalledWith(SESSION_ID);
  });

  it('queues activity update for active session', async () => {
    const socket = setupHandler();
    mocks.activityCacheIsValid.mockResolvedValue('active');

    await socket.trigger('session-alive', { sid: SESSION_ID, time: NOW - 500 });

    expect(mocks.activityCacheQueue).toHaveBeenCalledWith(SESSION_ID, NOW - 500);
    expect(mocks.broadcasterQueue).toHaveBeenCalledWith(USER_ID, SESSION_ID, true, NOW - 500, false);
  });

  it('passes thinking flag to broadcaster', async () => {
    const socket = setupHandler();
    mocks.activityCacheIsValid.mockResolvedValue('active');

    await socket.trigger('session-alive', { sid: SESSION_ID, time: NOW, thinking: true });

    expect(mocks.broadcasterQueue).toHaveBeenCalledWith(USER_ID, SESSION_ID, true, NOW, true);
  });

  it('defaults thinking to false', async () => {
    const socket = setupHandler();
    mocks.activityCacheIsValid.mockResolvedValue('active');

    await socket.trigger('session-alive', { sid: SESSION_ID, time: NOW });

    expect(mocks.broadcasterQueue).toHaveBeenCalledWith(USER_ID, SESSION_ID, true, NOW, false);
  });

  it('increments metrics counters', async () => {
    const socket = setupHandler();
    mocks.activityCacheIsValid.mockResolvedValue('active');

    await socket.trigger('session-alive', { sid: SESSION_ID, time: NOW });

    expect(mocks.metricsInc).toHaveBeenCalledWith({ event_type: 'session-alive' });
    expect(mocks.sessionAliveInc).toHaveBeenCalled();
  });
});

// ===========================================================================
// session-end
// ===========================================================================

describe('session-end', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;
  const NOW = 1711500000000;

  beforeEach(() => {
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  it('ignores non-number time', async () => {
    const socket = setupHandler();
    await socket.trigger('session-end', { sid: SESSION_ID, time: 'not-a-number' });

    expect(mocks.dbSessionFindUnique).not.toHaveBeenCalled();
  });

  it('clamps future time', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue({ id: SESSION_ID });
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });

    await socket.trigger('session-end', { sid: SESSION_ID, time: NOW + 5000 });

    // Should use NOW (clamped) not NOW+5000
    expect(mocks.dbSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: SESSION_ID, accountId: USER_ID },
      data: { lastActiveAt: new Date(NOW), status: 'archived' },
    });
  });

  it('ignores time older than 3 minutes', async () => {
    const socket = setupHandler();
    const oldTime = NOW - 1000 * 60 * 3 - 1;

    await socket.trigger('session-end', { sid: SESSION_ID, time: oldTime });

    expect(mocks.dbSessionFindUnique).not.toHaveBeenCalled();
  });

  it('ignores when session not found', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue(null);

    await socket.trigger('session-end', { sid: SESSION_ID, time: NOW });

    expect(mocks.dbSessionUpdateMany).not.toHaveBeenCalled();
  });

  it('archives session in DB', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue({ id: SESSION_ID });
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });

    await socket.trigger('session-end', { sid: SESSION_ID, time: NOW - 1000 });

    expect(mocks.dbSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: SESSION_ID, accountId: USER_ID },
      data: { lastActiveAt: new Date(NOW - 1000), status: 'archived' },
    });
  });

  it('evicts from activityCache', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue({ id: SESSION_ID });
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });

    await socket.trigger('session-end', { sid: SESSION_ID, time: NOW });

    expect(mocks.activityCacheEvict).toHaveBeenCalledWith(SESSION_ID);
  });

  it('removes from broadcaster', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue({ id: SESSION_ID });
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });

    await socket.trigger('session-end', { sid: SESSION_ID, time: NOW });

    expect(mocks.broadcasterRemove).toHaveBeenCalledWith(USER_ID, SESSION_ID);
  });

  it('emits session activity ephemeral (active=false)', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue({ id: SESSION_ID });
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });

    await socket.trigger('session-end', { sid: SESSION_ID, time: NOW - 500 });

    expect(mocks.buildSessionActivityEphemeral).toHaveBeenCalledWith(SESSION_ID, false, NOW - 500, false);
    expect(mocks.emitEphemeral).toHaveBeenCalledWith({
      userId: USER_ID,
      payload: { type: 'session-activity' },
      recipientFilter: { type: 'user-scoped-only' },
    });
  });

  it('broadcasts to user-scoped-only', async () => {
    const socket = setupHandler();
    mocks.dbSessionFindUnique.mockResolvedValue({ id: SESSION_ID });
    mocks.dbSessionUpdateMany.mockResolvedValue({ count: 1 });

    await socket.trigger('session-end', { sid: SESSION_ID, time: NOW });

    expect(mocks.emitEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientFilter: { type: 'user-scoped-only' },
      }),
    );
  });
});
