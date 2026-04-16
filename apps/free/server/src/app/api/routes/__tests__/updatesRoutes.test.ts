import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updatesRoutes } from '../updatesRoutes';

const {
  mockGetUpdatesGatewayConfig,
  mockProxyExpoUpdates,
  mockReadLatestDesktopRelease,
  mockReadLatestOtaRelease,
} = vi.hoisted(() => ({
  mockGetUpdatesGatewayConfig: vi.fn(),
  mockProxyExpoUpdates: vi.fn(),
  mockReadLatestDesktopRelease: vi.fn(),
  mockReadLatestOtaRelease: vi.fn(),
}));

vi.mock('@/app/updates/config', () => ({
  getUpdatesGatewayConfig: mockGetUpdatesGatewayConfig,
}));

vi.mock('@/app/updates/proxy', () => ({
  proxyExpoUpdates: mockProxyExpoUpdates,
}));

vi.mock('@/app/updates/releaseStore', () => ({
  readLatestDesktopRelease: mockReadLatestDesktopRelease,
  readLatestOtaRelease: mockReadLatestOtaRelease,
}));

type RouteHandler = (request: any, reply: any) => Promise<any>;

function makeReply() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    payload: undefined as unknown,
    code(code: number) {
      this.statusCode = code;
      return this;
    },
    header(key: string, value: string) {
      this.headers[key] = value;
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
    get: vi.fn((path: string, handler: RouteHandler) => {
      gets.set(path, handler);
    }),
    post: vi.fn((path: string, handler: RouteHandler) => {
      posts.set(path, handler);
    }),
  } as any;
  updatesRoutes(app);
  return { gets, posts };
}

describe('updatesRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when the gateway is disabled', async () => {
    mockGetUpdatesGatewayConfig.mockReturnValue({
      enabled: false,
      mode: 'expo',
      upstreamUrl: 'https://u.expo.dev/project-id',
      requestTimeoutMs: 1000,
    });

    const { gets } = registerHandlers();
    const handler = gets.get('/updates');
    const reply = makeReply();

    const result = await handler!(
      {
        method: 'GET',
        headers: {},
      },
      reply
    );

    expect(reply.statusCode).toBe(404);
    expect(result).toEqual({ error: 'updates_gateway_disabled' });
    expect(mockProxyExpoUpdates).not.toHaveBeenCalled();
  });

  it('proxies the upstream response and forwards headers', async () => {
    mockGetUpdatesGatewayConfig.mockReturnValue({
      enabled: true,
      mode: 'expo',
      upstreamUrl: 'https://u.expo.dev/project-id',
      requestTimeoutMs: 1000,
    });
    mockProxyExpoUpdates.mockResolvedValue({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'expo-protocol-version': '1',
      },
      body: Buffer.from('manifest-body'),
    });

    const { posts } = registerHandlers();
    const handler = posts.get('/updates');
    const reply = makeReply();

    await handler!(
      {
        method: 'POST',
        headers: {
          accept: 'application/expo+json',
        },
        body: { hello: 'world' },
      },
      reply
    );

    expect(mockProxyExpoUpdates).toHaveBeenCalledWith({
      method: 'POST',
      headers: {
        accept: 'application/expo+json',
      },
      body: Buffer.from('{"hello":"world"}'),
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.headers).toEqual({
      'content-type': 'application/json',
      'expo-protocol-version': '1',
    });
    expect(reply.payload).toEqual(Buffer.from('manifest-body'));
  });

  it('returns a self-hosted manifest when one is available', async () => {
    mockGetUpdatesGatewayConfig.mockReturnValue({
      enabled: true,
      mode: 'self-hosted',
      upstreamUrl: null,
      requestTimeoutMs: 1000,
    });
    mockReadLatestOtaRelease.mockResolvedValue({
      id: 'group-1',
      channel: 'production',
      platforms: [
        {
          platform: 'ios',
          runtimeVersion: 'rv1',
          manifest: {
            id: 'manifest-1',
            createdAt: '2026-04-14T00:00:00.000Z',
            runtimeVersion: 'rv1',
            launchAsset: {
              key: 'bundle.hbc',
              url: 'https://example.com/bundle.hbc',
              contentType: 'application/javascript',
              hash: 'abc',
            },
            assets: [],
            metadata: { channel: 'production', platform: 'ios' },
            extra: {},
          },
        },
      ],
    });

    const { gets } = registerHandlers();
    const handler = gets.get('/updates');
    const reply = makeReply();

    const result = await handler!(
      {
        method: 'GET',
        headers: {
          'expo-platform': 'ios',
          'expo-runtime-version': 'rv1',
          'expo-channel-name': 'production',
        },
        query: {},
      },
      reply
    );

    expect(mockReadLatestOtaRelease).toHaveBeenCalledWith('production', 'ios', 'rv1');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toBe('application/expo+json');
    expect(result).toEqual({
      id: 'manifest-1',
      createdAt: '2026-04-14T00:00:00.000Z',
      runtimeVersion: 'rv1',
      launchAsset: {
        key: 'bundle.hbc',
        url: 'https://example.com/bundle.hbc',
        contentType: 'application/javascript',
        hash: 'abc',
      },
      assets: [],
      metadata: { channel: 'production', platform: 'ios' },
      extra: {},
    });
  });

  it('returns a desktop updater manifest from the server pointer', async () => {
    mockReadLatestDesktopRelease.mockResolvedValue({
      id: 'desktop-v0.0.13',
      channel: 'stable',
      version: '0.0.13',
      tagName: 'desktop-v0.0.13',
      releaseUrl: 'https://github.com/example/release',
      latestJsonUrl: 'https://example.com/latest.json',
      createdAt: '2026-04-16T00:00:00.000Z',
      gitCommit: 'abc123',
      actor: 'ci',
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('{"version":"0.0.13"}'),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { gets } = registerHandlers();
    const handler = gets.get('/updates/desktop/latest.json');
    const reply = makeReply();

    const result = await handler!(
      {
        method: 'GET',
        query: { channel: 'stable' },
      },
      reply
    );

    expect(mockReadLatestDesktopRelease).toHaveBeenCalledWith('stable');
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/latest.json', {
      headers: { accept: 'application/json' },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toBe('application/json');
    expect(result).toBe('{"version":"0.0.13"}');
  });
});
