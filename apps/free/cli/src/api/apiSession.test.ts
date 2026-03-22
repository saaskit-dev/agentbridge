import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiSessionClient } from './apiSession';
import { createCipher, encryptToWireString, decryptFromWireString } from './encryption';
import type { Update } from './types';

const { mockIo, mockBackoff, mockDelay } = vi.hoisted(() => ({
  mockIo: vi.fn(),
  mockBackoff: vi.fn(async <T>(callback: () => Promise<T>) => {
    let lastError: unknown;
    for (let i = 0; i < 20; i += 1) {
      try {
        return await callback();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }),
  mockDelay: vi.fn(async () => undefined),
}));

vi.mock('socket.io-client', () => ({
  io: mockIo,
}));

vi.mock('@/configuration', () => ({
  configuration: {
    serverUrl: 'https://server.test',
  },
}));

vi.mock('@/api/rpc/RpcHandlerManager', () => ({
  RpcHandlerManager: class {
    onSocketConnect = vi.fn();
    onSocketDisconnect = vi.fn();
    handleRequest = vi.fn(async () => '');
  },
}));

vi.mock('@/modules/common/registerCommonHandlers', () => ({
  registerCommonHandlers: vi.fn(),
}));

vi.mock('@/utils/time', () => ({
  backoff: mockBackoff,
  delay: mockDelay,
}));

type SocketHandler = (...args: any[]) => void;
type SocketHandlers = Record<string, SocketHandler[]>;

function makeSession() {
  return {
    id: 'test-session-id',
    seq: 0,
    metadata: {
      path: '/tmp',
      host: 'localhost',
      homeDir: '/home/user',
      freeHomeDir: '/home/user/.free',
      freeLibDir: '/home/user/.free/lib',
      freeToolsDir: '/home/user/.free/tools',
    },
    metadataVersion: 0,
    agentState: null,
    agentStateVersion: 0,
    encryptionKey: new Uint8Array(32),
    encryptionVariant: 'legacy' as const,
  };
}

async function encryptContent(
  session: ReturnType<typeof makeSession>,
  content: unknown
): Promise<string> {
  return encryptToWireString(session.encryptionKey, session.encryptionVariant, content);
}

function createNewMessageUpdate(seq: number, encryptedContent: string): Update {
  return {
    id: `upd-${seq}`,
    seq,
    createdAt: Date.now(),
    body: {
      t: 'new-message',
      sid: 'test-session-id',
      message: {
        id: `msg-${seq}`,
        seq,
        content: {
          t: 'encrypted',
          c: encryptedContent,
        },
      },
    },
  };
}

async function waitForCheck(check: () => void, timeoutMs = 2000) {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

describe('ApiSessionClient v3 messages API migration', () => {
  let socketHandlers: SocketHandlers;
  let mockSocket: any;
  let session: ReturnType<typeof makeSession>;

  const emitSocketEvent = (event: string, ...args: any[]) => {
    const handlers = socketHandlers[event] || [];
    handlers.forEach(handler => handler(...args));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    socketHandlers = {};
    session = makeSession();

    mockSocket = {
      connected: true,
      connect: vi.fn(),
      on: vi.fn((event: string, handler: SocketHandler) => {
        if (!socketHandlers[event]) {
          socketHandlers[event] = [];
        }
        socketHandlers[event].push(handler);
      }),
      off: vi.fn(),
      emit: vi.fn(),
      timeout: vi.fn(function (this: any) {
        return this;
      }),
      emitWithAck: vi.fn(async () => ({ result: 'error' })),
      volatile: {
        emit: vi.fn(),
      },
      close: vi.fn(),
    };
    // Bind timeout so it returns mockSocket regardless of call context
    mockSocket.timeout = vi.fn(() => mockSocket);

    mockIo.mockReturnValue(mockSocket);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers core socket handlers and connects', () => {
    new ApiSessionClient('fake-token', session);

    expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('update', expect.any(Function));
    expect(mockSocket.connect).toHaveBeenCalledTimes(1);
  });

  it('queues codex message to v3 outbox, sends once, and drains outbox', async () => {
    const client = new ApiSessionClient('fake-token', session);
    mockSocket.emitWithAck.mockResolvedValueOnce({
      ok: true,
      messages: [
        {
          id: 'msg-1',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    client.sendCodexMessage({ type: 'delta', text: 'hello' });

    await waitForCheck(() => {
      expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(1);
    });

    const [event, payload] = mockSocket.emitWithAck.mock.calls[0];
    expect(event).toBe('send-messages');
    expect(payload.sessionId).toBe('test-session-id');
    expect(payload.messages).toHaveLength(1);
    expect(typeof payload.messages[0].id).toBe('string');
    expect((client as any).pendingOutbox).toHaveLength(0);
    expect((client as any).lastSeq).toBe(1);

    const decrypted = await decryptFromWireString(
      session.encryptionKey,
      session.encryptionVariant,
      payload.messages[0].content
    );
    expect(decrypted).toEqual({
      role: 'agent',
      content: {
        type: 'codex',
        data: { type: 'delta', text: 'hello' },
      },
      meta: {
        sentFrom: 'cli',
      },
    });
  });

  it('accumulates multiple pending outbox messages into one follow-up batch', async () => {
    const client = new ApiSessionClient('fake-token', session);

    type AckResponse = {
      ok: true;
      messages: Array<{
        id: string;
        seq: number;
        createdAt: number;
        updatedAt: number;
      }>;
    };
    let resolveFirstAck!: (value: AckResponse) => void;
    mockSocket.emitWithAck
      .mockImplementationOnce(
        () =>
          new Promise<AckResponse>(resolve => {
            resolveFirstAck = resolve;
          })
      )
      .mockResolvedValueOnce({
        ok: true,
        messages: [
          { id: 'msg-2', seq: 2, createdAt: 2, updatedAt: 2 },
          { id: 'msg-3', seq: 3, createdAt: 3, updatedAt: 3 },
        ],
      });

    client.sendCodexMessage({ type: 'first' });
    await waitForCheck(() => {
      expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(1);
    });

    client.sendCodexMessage({ type: 'second' });
    client.sendCodexMessage({ type: 'third' });

    resolveFirstAck({
      ok: true,
      messages: [{ id: 'msg-1', seq: 1, createdAt: 1, updatedAt: 1 }],
    });

    await waitForCheck(() => {
      expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(2);
    });

    const [, secondPayload] = mockSocket.emitWithAck.mock.calls[1];
    expect(secondPayload.messages).toHaveLength(2);
    expect((client as any).pendingOutbox).toHaveLength(0);
    expect((client as any).lastSeq).toBe(3);
  });

  it('retries failed POST and succeeds without dropping queued messages', async () => {
    const client = new ApiSessionClient('fake-token', session);

    mockSocket.emitWithAck.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce({
      ok: true,
      messages: [{ id: 'msg-1', seq: 1, createdAt: 1, updatedAt: 1 }],
    });

    client.sendCodexMessage({ type: 'retry-me' });

    await waitForCheck(() => {
      expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(2);
    });

    expect((client as any).pendingOutbox).toHaveLength(0);
    expect((client as any).lastSeq).toBe(1);
  });

  it('sends session protocol messages through enqueueMessage with session envelope', async () => {
    const client = new ApiSessionClient('fake-token', session);
    mockSocket.emitWithAck.mockResolvedValueOnce({
      ok: true,
      messages: [{ id: 'msg-1', seq: 1, createdAt: 1, updatedAt: 1 }],
    });

    const envelope = {
      id: 'env-1',
      time: 1000,
      role: 'agent' as const,
      turn: 'turn-1',
      ev: { t: 'text' as const, text: 'hello from session protocol' },
    };
    client.sendSessionProtocolMessage(envelope);

    await waitForCheck(() => {
      expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(1);
    });

    const [event, payload] = mockSocket.emitWithAck.mock.calls[0];
    expect(event).toBe('send-messages');
    const decrypted = await decryptFromWireString(
      session.encryptionKey,
      session.encryptionVariant,
      payload.messages[0].content
    );

    expect(decrypted).toEqual({
      role: 'agent',
      content: {
        type: 'session',
        data: envelope,
      },
      meta: {
        sentFrom: 'cli',
      },
    });
  });

  it('sends ACP agent messages through enqueueMessage', async () => {
    const client = new ApiSessionClient('fake-token', session);
    mockSocket.emitWithAck.mockResolvedValueOnce({
      ok: true,
      messages: [{ id: 'msg-1', seq: 1, createdAt: 1, updatedAt: 1 }],
    });

    client.sendAgentMessage('codex', {
      type: 'message',
      message: 'hi',
    });

    await waitForCheck(() => {
      expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(1);
    });

    const [event, payload] = mockSocket.emitWithAck.mock.calls[0];
    expect(event).toBe('send-messages');
    const decrypted = await decryptFromWireString(
      session.encryptionKey,
      session.encryptionVariant,
      payload.messages[0].content
    );

    expect(decrypted).toEqual({
      role: 'agent',
      content: {
        type: 'acp',
        provider: 'codex',
        data: {
          type: 'message',
          message: 'hi',
        },
      },
      meta: {
        sentFrom: 'cli',
      },
    });
  });

  it('sends session events as direct normalized messages', async () => {
    const client = new ApiSessionClient('fake-token', session);
    mockSocket.emitWithAck.mockResolvedValueOnce({
      ok: true,
      messages: [{ id: 'msg-1', seq: 1, createdAt: 1, updatedAt: 1 }],
    });

    client.sendSessionEvent({ type: 'ready' }, 'event-1');

    await waitForCheck(() => {
      expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(1);
    });

    const [event, payload] = mockSocket.emitWithAck.mock.calls[0];
    expect(event).toBe('send-messages');
    const decrypted = await decryptFromWireString(
      session.encryptionKey,
      session.encryptionVariant,
      payload.messages[0].content
    );

    expect(decrypted).toMatchObject({
      id: 'event-1',
      role: 'event',
      isSidechain: false,
      content: {
        type: 'ready',
      },
    });
    expect(typeof decrypted.createdAt).toBe('number');
  });

  it('fetchMessages uses after_seq=0 initially and routes user messages to callback', async () => {
    const client = new ApiSessionClient('fake-token', session);
    const onUserMessage = vi.fn();
    client.onUserMessage(onUserMessage);

    const userMessage = {
      role: 'user',
      content: {
        type: 'text',
        text: 'from fetch',
      },
    };

    mockSocket.emitWithAck.mockResolvedValueOnce({
      ok: true,
      messages: [
        {
          id: 'msg-1',
          seq: 1,
          content: {
            t: 'encrypted',
            c: await encryptContent(session, userMessage),
          },
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      hasMore: false,
    });

    await (client as any).fetchMessages();

    expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(1);
    const [event, payload] = mockSocket.emitWithAck.mock.calls[0];
    expect(event).toBe('fetch-messages');
    expect(payload).toEqual({
      sessionId: 'test-session-id',
      after_seq: 0,
      limit: 100,
    });
    expect(onUserMessage).toHaveBeenCalledWith(userMessage);
    expect((client as any).lastSeq).toBe(1);
  });

  it('fetchMessages uses incremental cursor and paginates while hasMore is true', async () => {
    const client = new ApiSessionClient('fake-token', session);
    const onUserMessage = vi.fn();
    client.onUserMessage(onUserMessage);

    (client as any).lastSeq = 2;

    const message3 = {
      role: 'user',
      content: { type: 'text', text: 'm3' },
    };
    const message4 = {
      role: 'user',
      content: { type: 'text', text: 'm4' },
    };

    mockSocket.emitWithAck
      .mockResolvedValueOnce({
        ok: true,
        messages: [
          {
            id: 'msg-3',
            seq: 3,
            content: { t: 'encrypted', c: await encryptContent(session, message3) },
            createdAt: 3000,
            updatedAt: 3000,
          },
        ],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        messages: [
          {
            id: 'msg-4',
            seq: 4,
            content: { t: 'encrypted', c: await encryptContent(session, message4) },
            createdAt: 4000,
            updatedAt: 4000,
          },
        ],
        hasMore: false,
      });

    await (client as any).fetchMessages();

    expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(2);
    expect(mockSocket.emitWithAck.mock.calls[0][1].after_seq).toBe(2);
    expect(mockSocket.emitWithAck.mock.calls[1][1].after_seq).toBe(3);
    expect(onUserMessage).toHaveBeenCalledTimes(2);
    expect((client as any).lastSeq).toBe(4);
  });

  it('fetchMessages stops pagination when hasMore is true but seq cursor does not advance', async () => {
    const client = new ApiSessionClient('fake-token', session);
    (client as any).lastSeq = 2;

    mockSocket.emitWithAck
      .mockResolvedValueOnce({
        ok: true,
        messages: [],
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error('should not request another page when cursor is stalled'));

    await expect((client as any).fetchMessages()).resolves.toBeUndefined();

    expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(1);
    expect(mockSocket.emitWithAck.mock.calls[0][1].after_seq).toBe(2);
    expect((client as any).lastSeq).toBe(2);
  });

  it('routes non-user fetched messages through EventEmitter message event', async () => {
    const client = new ApiSessionClient('fake-token', session);
    const onUserMessage = vi.fn();
    const onMessage = vi.fn();
    client.onUserMessage(onUserMessage);
    client.on('message', onMessage);

    const userMessage = {
      role: 'user',
      content: { type: 'text', text: 'user text' },
    };
    const agentMessage = {
      role: 'agent',
      content: {
        type: 'output',
        data: { answer: 'agent response' },
      },
    };

    mockSocket.emitWithAck.mockResolvedValueOnce({
      ok: true,
      messages: [
        {
          id: 'msg-1',
          seq: 1,
          content: { t: 'encrypted', c: await encryptContent(session, userMessage) },
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          id: 'msg-2',
          seq: 2,
          content: { t: 'encrypted', c: await encryptContent(session, agentMessage) },
          createdAt: 2000,
          updatedAt: 2000,
        },
      ],
      hasMore: false,
    });

    await (client as any).fetchMessages();

    expect(onUserMessage).toHaveBeenCalledTimes(1);
    expect(onUserMessage).toHaveBeenCalledWith(userMessage);
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(agentMessage);
  });

  it('applies consecutive new-message updates directly (fast path)', async () => {
    const client = new ApiSessionClient('fake-token', session);
    const onUserMessage = vi.fn();
    client.onUserMessage(onUserMessage);

    (client as any).lastSeq = 1;
    const userMessage = {
      role: 'user',
      content: { type: 'text', text: 'fast-path' },
    };

    emitSocketEvent(
      'update',
      createNewMessageUpdate(2, await encryptContent(session, userMessage))
    );

    await waitForCheck(() => {
      expect(onUserMessage).toHaveBeenCalledTimes(1);
    });
    expect(onUserMessage).toHaveBeenCalledWith(userMessage);
    expect((client as any).lastSeq).toBe(2);
    // emitWithAck should not have been called for fetch-messages
    const fetchCalls = mockSocket.emitWithAck.mock.calls.filter(
      (call: any[]) => call[0] === 'fetch-messages'
    );
    expect(fetchCalls).toHaveLength(0);
  });

  it('invalidates receive sync and fetches on seq gap', async () => {
    const client = new ApiSessionClient('fake-token', session);
    (client as any).lastSeq = 1;

    mockSocket.emitWithAck.mockResolvedValueOnce({
      ok: true,
      messages: [],
      hasMore: false,
    });

    emitSocketEvent(
      'update',
      createNewMessageUpdate(
        3,
        await encryptContent(session, {
          role: 'user',
          content: { type: 'text', text: 'gap' },
        })
      )
    );

    await waitForCheck(() => {
      const fetchCalls = mockSocket.emitWithAck.mock.calls.filter(
        (call: any[]) => call[0] === 'fetch-messages'
      );
      expect(fetchCalls).toHaveLength(1);
    });
    const fetchCall = mockSocket.emitWithAck.mock.calls.find(
      (call: any[]) => call[0] === 'fetch-messages'
    );
    expect(fetchCall![1].after_seq).toBe(1);
  });

  it('invalidates receive sync on first message when lastSeq is 0', async () => {
    const client = new ApiSessionClient('fake-token', session);

    mockSocket.emitWithAck.mockResolvedValueOnce({
      ok: true,
      messages: [],
      hasMore: false,
    });

    emitSocketEvent(
      'update',
      createNewMessageUpdate(
        1,
        await encryptContent(session, {
          role: 'user',
          content: { type: 'text', text: 'first' },
        })
      )
    );

    await waitForCheck(() => {
      const fetchCalls = mockSocket.emitWithAck.mock.calls.filter(
        (call: any[]) => call[0] === 'fetch-messages'
      );
      expect(fetchCalls).toHaveLength(1);
    });
    const fetchCall = mockSocket.emitWithAck.mock.calls.find(
      (call: any[]) => call[0] === 'fetch-messages'
    );
    expect(fetchCall![1].after_seq).toBe(0);
  });

  it('invalidates receive sync for duplicate and stale seq values', async () => {
    const client = new ApiSessionClient('fake-token', session);
    (client as any).lastSeq = 5;

    mockSocket.emitWithAck.mockResolvedValue({
      ok: true,
      messages: [],
      hasMore: false,
    });

    emitSocketEvent(
      'update',
      createNewMessageUpdate(
        5,
        await encryptContent(session, {
          role: 'user',
          content: { type: 'text', text: 'duplicate' },
        })
      )
    );
    emitSocketEvent(
      'update',
      createNewMessageUpdate(
        4,
        await encryptContent(session, {
          role: 'user',
          content: { type: 'text', text: 'stale' },
        })
      )
    );

    await waitForCheck(() => {
      const fetchCalls = mockSocket.emitWithAck.mock.calls.filter(
        (call: any[]) => call[0] === 'fetch-messages'
      );
      expect(fetchCalls).toHaveLength(2);
    });
    const fetchCalls = mockSocket.emitWithAck.mock.calls.filter(
      (call: any[]) => call[0] === 'fetch-messages'
    );
    expect(fetchCalls[0][1].after_seq).toBe(5);
    expect(fetchCalls[1][1].after_seq).toBe(5);
  });

  it('updates lastSeq after successful outbox flush and never moves it backward', async () => {
    const client = new ApiSessionClient('fake-token', session);
    (client as any).lastSeq = 10;

    mockSocket.emitWithAck.mockResolvedValueOnce({
      ok: true,
      messages: [{ id: 'msg-9', seq: 9, createdAt: 9, updatedAt: 9 }],
    });

    client.sendCodexMessage({ type: 'older' });
    await waitForCheck(() => {
      expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(1);
    });
    expect((client as any).lastSeq).toBe(10);

    mockSocket.emitWithAck.mockResolvedValueOnce({
      ok: true,
      messages: [{ id: 'msg-11', seq: 11, createdAt: 11, updatedAt: 11 }],
    });

    client.sendCodexMessage({ type: 'newer' });
    await waitForCheck(() => {
      expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(2);
    });
    expect((client as any).lastSeq).toBe(11);
  });

  it('flushOutbox sends in batches when outbox exceeds FLUSH_BATCH_SIZE', async () => {
    const client = new ApiSessionClient('fake-token', session);

    mockSocket.emitWithAck.mockImplementation(async () => ({
      ok: true,
      messages: [],
    }));

    // Directly populate pendingOutbox with 150 pre-encrypted messages
    const totalMessages = 150;
    const outbox = (client as any).pendingOutbox as Array<{ content: string; id: string }>;
    for (let i = 0; i < totalMessages; i++) {
      outbox.push({ content: `encrypted-${i}`, id: `id-${i}` });
    }

    // Trigger flush
    (client as any).sendSync.invalidate();

    await waitForCheck(() => {
      expect((client as any).pendingOutbox).toHaveLength(0);
    });

    // Every batch must be <= 100 and total sent must equal 150
    const sendCalls = mockSocket.emitWithAck.mock.calls.filter(
      (call: any[]) => call[0] === 'send-messages'
    );
    const batchSizes = sendCalls.map((call: any[]) => (call[1].messages as unknown[]).length);
    expect(batchSizes.length).toBeGreaterThanOrEqual(2);
    expect(batchSizes.every((s: number) => s <= 100)).toBe(true);
    expect(batchSizes.reduce((a: number, b: number) => a + b, 0)).toBe(totalMessages);
  });

  it('flushOutbox tolerates missing ack.messages and keeps lastSeq unchanged', async () => {
    const client = new ApiSessionClient('fake-token', session);
    (client as any).lastSeq = 7;

    mockSocket.emitWithAck.mockResolvedValueOnce({
      ok: true,
    });

    client.sendCodexMessage({ type: 'no-messages-field' });
    await waitForCheck(() => {
      expect(mockSocket.emitWithAck).toHaveBeenCalledTimes(1);
    });

    expect((client as any).lastSeq).toBe(7);
    expect((client as any).pendingOutbox).toHaveLength(0);
  });

  it('recovery replay only updates lastSeq without routing messages', async () => {
    const client = new ApiSessionClient('fake-token', session);
    const routed: unknown[] = [];
    client.on('message', (msg: unknown) => routed.push(msg));

    // First connect → recovery mode
    emitSocketEvent('connect');

    const encrypted = await encryptContent(session, { type: 'agent-output', text: 'hello' });
    emitSocketEvent('replay', {
      sessionId: 'test-session-id',
      messages: [
        { id: 'msg-1', seq: 1, content: { t: 'encrypted', c: encrypted } },
        { id: 'msg-2', seq: 5, content: { t: 'encrypted', c: encrypted } },
      ],
      hasMore: false,
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    // Recovery mode: lastSeq updated but no messages routed
    expect((client as any).lastSeq).toBe(5);
    expect(routed).toHaveLength(0);
  });

  it('reconnect replay routes missed user messages to callback', async () => {
    const client = new ApiSessionClient('fake-token', session);
    const receivedMessages: string[] = [];
    client.onUserMessage(msg => receivedMessages.push(msg.content.text));

    // First connect → recovery
    emitSocketEvent('connect');
    const agentMsg = await encryptContent(session, { type: 'agent-output', text: 'old' });
    emitSocketEvent('replay', {
      sessionId: 'test-session-id',
      messages: [{ id: 'msg-1', seq: 1, content: { t: 'encrypted', c: agentMsg } }],
      hasMore: false,
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect((client as any).lastSeq).toBe(1);

    // Simulate disconnect + reconnect
    emitSocketEvent('connect');

    // Reconnect replay with a new user message (seq 2) that was missed during disconnect
    const userMsg = await encryptContent(session, {
      role: 'user',
      content: { type: 'text', text: 'missed-message' },
    });
    emitSocketEvent('replay', {
      sessionId: 'test-session-id',
      messages: [{ id: 'msg-2', seq: 2, content: { t: 'encrypted', c: userMsg } }],
      hasMore: false,
    });

    await waitForCheck(() => {
      expect(receivedMessages).toHaveLength(1);
    });
    expect(receivedMessages[0]).toBe('missed-message');
    expect((client as any).lastSeq).toBe(2);
  });

  it('auth object uses getter so reconnect sends current lastSeq', () => {
    const client = new ApiSessionClient('fake-token', session);
    // Simulate lastSeq advancement
    (client as any).lastSeq = 42;

    // The auth option passed to io() should be an object with a dynamic lastSeq
    const ioCall = mockIo.mock.calls[0];
    const authOption = ioCall[1].auth;
    expect(typeof authOption).toBe('object');

    // Reading lastSeq should return the current value (42), not the initial value (0)
    expect(authOption.lastSeq).toBe(42);
    expect(authOption.sessionId).toBe('test-session-id');

    // Advance again — getter should track the change
    (client as any).lastSeq = 100;
    expect(authOption.lastSeq).toBe(100);
  });

  it('stops send and receive sync loops on close', async () => {
    const client = new ApiSessionClient('fake-token', session);
    await client.close();

    emitSocketEvent(
      'update',
      createNewMessageUpdate(
        1,
        await encryptContent(session, {
          role: 'user',
          content: { type: 'text', text: 'after-close' },
        })
      )
    );
    client.sendCodexMessage({ type: 'after-close-send' });

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(mockSocket.close).toHaveBeenCalledTimes(1);
    // No send-messages or fetch-messages calls should have been made
    const sendOrFetchCalls = mockSocket.emitWithAck.mock.calls.filter(
      (call: any[]) => call[0] === 'send-messages' || call[0] === 'fetch-messages'
    );
    expect(sendOrFetchCalls).toHaveLength(0);
  });
});
