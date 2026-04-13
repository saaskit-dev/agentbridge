import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient } from '../api';
import { connectionState } from '@/utils/serverConnectionErrors';

const { mockGet, mockPost, mockIsAxiosError, mockEncryptToWireString, mockDecryptFromWireString } =
  vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockPost: vi.fn(),
    mockIsAxiosError: vi.fn(() => true),
    mockEncryptToWireString: vi.fn((_key: any, _variant: any, data: any) => JSON.stringify(data)),
    mockDecryptFromWireString: vi.fn((_key: any, _variant: any, wireStr: string) =>
      JSON.parse(wireStr)
    ),
  }));

vi.mock('axios', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    isAxiosError: mockIsAxiosError,
  },
  get: mockGet,
  isAxiosError: mockIsAxiosError,
}));

vi.mock('../encryption', () => ({
  decodeBase64: vi.fn((data: string) => data),
  encodeBase64: vi.fn((data: any) => data),
  getRandomBytes: vi.fn(() => new Uint8Array(32)),
  encryptToWireString: mockEncryptToWireString,
  decryptFromWireString: mockDecryptFromWireString,
  libsodiumEncryptForPublicKey: vi.fn((data: Uint8Array) => data),
  libsodiumPublicKeyFromSecretKey: vi.fn(() => new Uint8Array(32)),
}));

const testMetadata = {
  path: '/tmp',
  host: 'localhost',
  homeDir: '/home/user',
  freeHomeDir: '/home/user/.free',
  freeLibDir: '/home/user/.free/lib',
  freeToolsDir: '/home/user/.free/tools',
};

describe('ApiClient strict session recovery', () => {
  let api: ApiClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    connectionState.reset();
    const credential = {
      token: 'fake-token',
      encryption: {
        type: 'legacy' as const,
        secret: new Uint8Array(32),
      },
    };
    api = await ApiClient.create(credential);
  });

  it('does not create a new session when strict ID is missing', async () => {
    mockGet.mockRejectedValue({
      response: { status: 404 },
      isAxiosError: true,
    });

    const result = await api.getOrCreateSession({
      id: 'strict-missing',
      metadata: testMetadata,
      state: null,
      strictSessionId: true,
    });

    expect(result).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not randomize session ID on 409 in strict mode', async () => {
    mockGet.mockResolvedValue({
      data: { session: { status: 'active' } },
    });
    mockPost.mockResolvedValue({
      status: 409,
      data: { error: 'session_id_conflict' },
    });

    const result = await api.getOrCreateSession({
      id: 'strict-409',
      metadata: testMetadata,
      state: null,
      strictSessionId: true,
    });

    expect(result).toBeNull();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('treats 5xx lookup failures as unavailable instead of missing', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGet.mockRejectedValue({
      response: { status: 502 },
      isAxiosError: true,
    });

    const result = await api.getOrCreateSession({
      id: 'strict-lookup-502',
      metadata: testMetadata,
      state: null,
      strictSessionId: true,
    });

    expect(result).toBeNull();
    expect(mockPost).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Session recovery lookup failed: 502')
    );

    consoleSpy.mockRestore();
  });
});
