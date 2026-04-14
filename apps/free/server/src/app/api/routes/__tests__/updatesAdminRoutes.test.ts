import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updatesAdminRoutes } from '../updatesAdminRoutes';

const {
  mockSaveOtaRelease,
  mockListOtaReleases,
  mockReadLatestOtaRelease,
  mockPromoteOtaRelease,
} = vi.hoisted(() => ({
  mockSaveOtaRelease: vi.fn(),
  mockListOtaReleases: vi.fn(),
  mockReadLatestOtaRelease: vi.fn(),
  mockPromoteOtaRelease: vi.fn(),
}));

vi.mock('@/app/updates/releaseStore', () => ({
  saveOtaRelease: mockSaveOtaRelease,
  listOtaReleases: mockListOtaReleases,
  readLatestOtaRelease: mockReadLatestOtaRelease,
  promoteOtaRelease: mockPromoteOtaRelease,
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
  const gets = new Map<string, RouteHandler>();
  const posts = new Map<string, RouteHandler>();
  const app = {
    get: vi.fn((path: string, _optsOrHandler: unknown, maybeHandler?: RouteHandler) => {
      gets.set(path, (maybeHandler || _optsOrHandler) as RouteHandler);
    }),
    post: vi.fn((path: string, _opts: unknown, handler: RouteHandler) => {
      posts.set(path, handler);
    }),
  } as any;
  updatesAdminRoutes(app);
  return { gets, posts };
}

describe('updatesAdminRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EXPO_UPDATES_ADMIN_TOKEN = 'secret-token';
  });

  it('rejects unauthorized requests', async () => {
    const { gets } = registerHandlers();
    const handler = gets.get('/updates/admin/releases');
    const reply = makeReply();

    await handler!({ headers: {} }, reply);

    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({ error: 'unauthorized' });
  });

  it('stores release metadata for authorized requests', async () => {
    const { posts } = registerHandlers();
    const handler = posts.get('/updates/admin/releases');
    const reply = makeReply();
    const body = {
      id: 'group-1',
      channel: 'production',
      message: 'fix ota',
      source: 'self-hosted',
      gitCommit: 'abc123',
      createdAt: '2026-04-14T00:00:00.000Z',
      actor: 'ci',
      raw: { example: true },
      platforms: [
        {
          platform: 'ios',
          runtimeVersion: 'rv1',
          launchAssetUrl: 'https://github.com/owner/repo/releases/download/ota-production-group-1/ios--bundle.hbc',
          manifestPermalink: 'https://example.com/updates?channel=production&platform=ios&runtimeVersion=rv1',
          manifest: {
            id: 'manifest-1',
            createdAt: '2026-04-14T00:00:00.000Z',
            runtimeVersion: 'rv1',
            launchAsset: {
              key: 'bundle.hbc',
              url: 'https://github.com/owner/repo/releases/download/ota-production-group-1/ios--bundle.hbc',
              contentType: 'application/javascript',
              hash: 'abc',
            },
            assets: [],
            metadata: { channel: 'production', platform: 'ios' },
            extra: {},
          },
        },
      ],
    };

    const result = await handler!(
      {
        headers: { authorization: 'Bearer secret-token' },
        body,
      },
      reply
    );

    expect(mockSaveOtaRelease).toHaveBeenCalledWith(body);
    expect(result).toEqual({ ok: true });
  });

  it('returns the latest release for a channel/runtime pair', async () => {
    mockReadLatestOtaRelease.mockResolvedValue({ id: 'group-1' });

    const { gets } = registerHandlers();
    const handler = gets.get('/updates/admin/latest');
    const reply = makeReply();

    const result = await handler!(
      {
        headers: { authorization: 'Bearer secret-token' },
        query: { channel: 'production', platform: 'ios', runtimeVersion: 'rv1' },
      },
      reply
    );

    expect(mockReadLatestOtaRelease).toHaveBeenCalledWith('production', 'ios', 'rv1');
    expect(result).toEqual({ release: { id: 'group-1' } });
  });

  it('promotes a release by id', async () => {
    mockPromoteOtaRelease.mockResolvedValue({ id: 'group-2', channel: 'production', platforms: [{ platform: 'ios' }] });

    const { posts } = registerHandlers();
    const handler = posts.get('/updates/admin/promote');
    const reply = makeReply();

    const result = await handler!(
      {
        headers: { authorization: 'Bearer secret-token' },
        body: { releaseId: 'group-2' },
      },
      reply
    );

    expect(mockPromoteOtaRelease).toHaveBeenCalledWith('group-2');
    expect(result).toEqual({
      ok: true,
      release: { id: 'group-2', channel: 'production', platforms: [{ platform: 'ios' }] },
    });
  });
});
