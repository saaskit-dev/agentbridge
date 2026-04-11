import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionRoutes } from '../sessionRoutes';

const { mockFindUnique, mockReactivate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockReactivate: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
  db: {
    session: {
      findUnique: mockFindUnique,
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('@/app/session/sessionReactivate', () => ({
  sessionReactivate: mockReactivate,
}));

vi.mock('@/app/session/sessionArchive', () => ({
  sessionArchive: vi.fn(),
}));

vi.mock('@/app/session/sessionDelete', () => ({
  sessionDelete: vi.fn(),
}));

vi.mock('@/app/events/eventRouter', () => ({
  eventRouter: {
    emitUpdate: vi.fn(),
    emitEphemeral: vi.fn(),
  },
  buildNewSessionUpdate: vi.fn(),
}));

vi.mock('@/app/presence/sessionCache', () => ({
  activityCache: {
    evictSession: vi.fn(),
  },
}));

vi.mock('@/storage/seq', () => ({
  allocateUserSeq: vi.fn(),
}));

vi.mock('@/utils/randomKeyNaked', () => ({
  randomKeyNaked: vi.fn(),
}));

type RouteHandler = (request: any, reply: any) => Promise<any>;

function makeReply() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    code(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.payload = payload;
      return payload;
    },
  };
}

function registerHandlers() {
  const posts = new Map<string, RouteHandler>();
  const app = {
    authenticate: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    post: vi.fn((path: string, _opts: unknown, handler: RouteHandler) => {
      posts.set(path, handler);
    }),
    patch: vi.fn(),
  } as any;
  sessionRoutes(app);
  return posts;
}

describe('sessionRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create-session returns 409 when the existing session is archived', async () => {
    const posts = registerHandlers();
    const handler = posts.get('/v1/sessions');
    expect(handler).toBeDefined();

    mockFindUnique.mockResolvedValue({
      id: 'sess-1',
      accountId: 'user-1',
      status: 'archived',
    });

    const reply = makeReply();
    const result = await handler!(
      {
        userId: 'user-1',
        body: {
          id: 'sess-1',
          metadata: 'enc-meta',
          agentState: null,
          dataEncryptionKey: 'dek',
          machineId: 'machine-1',
        },
        headers: {},
      },
      reply
    );

    expect(reply.statusCode).toBe(409);
    expect(result).toEqual({ error: 'session_id_conflict' });
    expect(mockReactivate).not.toHaveBeenCalled();
  });

  it('restore-session returns the restored session payload', async () => {
    const posts = registerHandlers();
    const handler = posts.get('/v1/sessions/:sessionId/restore');
    expect(handler).toBeDefined();

    const restored = {
      id: 'sess-1',
      seq: 42,
      metadata: 'enc-meta',
      metadataVersion: 7,
      agentState: null,
      agentStateVersion: 8,
      capabilities: 'enc-cap',
      capabilitiesVersion: 3,
      dataEncryptionKey: 'dek',
      status: 'active',
      lastActiveAt: new Date('2026-04-10T10:00:00.000Z'),
      createdAt: new Date('2026-04-01T10:00:00.000Z'),
      updatedAt: new Date('2026-04-10T10:00:01.000Z'),
    };
    mockReactivate.mockResolvedValue(restored);

    const reply = makeReply();
    const result = await handler!(
      {
        userId: 'user-1',
        params: { sessionId: 'sess-1' },
        body: {
          metadata: 'enc-meta',
          machineId: 'machine-1',
        },
      },
      reply
    );

    expect(mockReactivate).toHaveBeenCalledWith(
      { uid: 'user-1' },
      { sessionId: 'sess-1', machineId: 'machine-1' }
    );
    expect(result).toEqual({
      session: {
        id: 'sess-1',
        seq: 42,
        metadata: 'enc-meta',
        metadataVersion: 7,
        agentState: null,
        agentStateVersion: 8,
        capabilities: 'enc-cap',
        capabilitiesVersion: 3,
        dataEncryptionKey: 'dek',
        status: 'active',
        activeAt: restored.lastActiveAt.getTime(),
        createdAt: restored.createdAt.getTime(),
        updatedAt: restored.updatedAt.getTime(),
        lastMessage: null,
      },
    });
  });

  it('restore-session returns 404 when the target session does not exist', async () => {
    const posts = registerHandlers();
    const handler = posts.get('/v1/sessions/:sessionId/restore');
    expect(handler).toBeDefined();

    mockReactivate.mockResolvedValue(null);

    const reply = makeReply();
    const result = await handler!(
      {
        userId: 'user-1',
        params: { sessionId: 'missing' },
        body: {
          metadata: 'enc-meta',
          machineId: null,
        },
      },
      reply
    );

    expect(reply.statusCode).toBe(404);
    expect(result).toEqual({ error: 'Session not found' });
  });
});
