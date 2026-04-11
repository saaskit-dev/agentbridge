import axios from 'axios';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from './api';
import { connectionState } from '@/utils/serverConnectionErrors';

// Use vi.hoisted to ensure mock functions are available when vi.mock factory runs
const {
  mockGet,
  mockPost,
  mockIsAxiosError,
  mockEncryptToWireString,
  mockDecryptFromWireString,
  mockTweetnaclBoxOpen,
} =
  vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockPost: vi.fn(),
    mockIsAxiosError: vi.fn(() => true),
    mockEncryptToWireString: vi.fn((_key: any, _variant: any, data: any) => JSON.stringify(data)),
    mockDecryptFromWireString: vi.fn((_key: any, _variant: any, wireStr: string) =>
      JSON.parse(wireStr)
    ),
    mockTweetnaclBoxOpen: vi.fn(),
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

vi.mock('tweetnacl', () => ({
  default: {
    box: {
      open: mockTweetnaclBoxOpen,
    },
  },
}));

// Mock encryption utilities
vi.mock('./encryption', () => ({
  decodeBase64: vi.fn((data: string) => data),
  encodeBase64: vi.fn((data: any) => data),
  decrypt: vi.fn((data: any) => data),
  encrypt: vi.fn((data: any) => data),
  encryptToWireString: mockEncryptToWireString,
  decryptFromWireString: mockDecryptFromWireString,
}));

// Mock configuration
vi.mock('./configuration', () => ({
  configuration: {
    serverUrl: 'https://api.example.com',
  },
}));

// Mock libsodium encryption
vi.mock('./libsodiumEncryption', () => ({
  libsodiumEncryptForPublicKey: vi.fn((data: any) => new Uint8Array(32)),
}));

// Global test metadata
const testMetadata = {
  path: '/tmp',
  host: 'localhost',
  homeDir: '/home/user',
  freeHomeDir: '/home/user/.free',
  freeLibDir: '/home/user/.free/lib',
  freeToolsDir: '/home/user/.free/tools',
};

const testMachineMetadata = {
  host: 'localhost',
  platform: 'darwin',
  freeCliVersion: '1.0.0',
  homeDir: '/home/user',
  freeHomeDir: '/home/user/.free',
  freeLibDir: '/home/user/.free/lib',
};

describe('Api server error handling', () => {
  let api: ApiClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    connectionState.reset(); // Reset offline state between tests
    mockDecryptFromWireString.mockImplementation((_key: any, _variant: any, wireStr: string) =>
      JSON.parse(wireStr)
    );

    // Create a mock credential
    const mockCredential = {
      token: 'fake-token',
      encryption: {
        type: 'legacy' as const,
        secret: new Uint8Array(32),
      },
    };

    api = await ApiClient.create(mockCredential);
  });

  describe('getOrCreateSession', () => {
    it('should return null when Free server is unreachable (ECONNREFUSED)', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock axios to throw connection refused error
      mockPost.mockRejectedValue({ code: 'ECONNREFUSED' });

      const result = await api.getOrCreateSession({
        id: 'test-id',
        metadata: testMetadata,
        state: null,
      });

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Free server unreachable')
      );

      consoleSpy.mockRestore();
    });

    it('should return null when Free server cannot be found (ENOTFOUND)', async () => {
      connectionState.reset();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock axios to throw DNS resolution error
      mockPost.mockRejectedValue({ code: 'ENOTFOUND' });

      const result = await api.getOrCreateSession({
        id: 'test-id',
        metadata: testMetadata,
        state: null,
      });

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Free server unreachable')
      );

      consoleSpy.mockRestore();
    });

    it('should return null when Free server times out (ETIMEDOUT)', async () => {
      connectionState.reset();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock axios to throw timeout error
      mockPost.mockRejectedValue({ code: 'ETIMEDOUT' });

      const result = await api.getOrCreateSession({
        id: 'test-id',
        metadata: testMetadata,
        state: null,
      });

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Free server unreachable')
      );

      consoleSpy.mockRestore();
    });

    it('should return null when session endpoint returns 404', async () => {
      connectionState.reset();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock axios to return 404
      mockPost.mockRejectedValue({
        response: { status: 404 },
        isAxiosError: true,
      });

      const result = await api.getOrCreateSession({
        id: 'test-id',
        metadata: testMetadata,
        state: null,
      });

      expect(result).toBeNull();
      // New unified format via connectionState.fail()
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Free server unreachable')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Session creation failed: 404')
      );

      consoleSpy.mockRestore();
    });

    it('should return null when server returns 500 Internal Server Error', async () => {
      connectionState.reset();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock axios to return 500 error
      mockPost.mockRejectedValue({
        response: { status: 500 },
        isAxiosError: true,
      });

      const result = await api.getOrCreateSession({
        id: 'test-id',
        metadata: testMetadata,
        state: null,
      });

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Free server unreachable')
      );
      consoleSpy.mockRestore();
    });

    it('should return null when server returns 503 Service Unavailable', async () => {
      connectionState.reset();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock axios to return 503 error
      mockPost.mockRejectedValue({
        response: { status: 503 },
        isAxiosError: true,
      });

      const result = await api.getOrCreateSession({
        id: 'test-id',
        metadata: testMetadata,
        state: null,
      });

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Free server unreachable')
      );
      consoleSpy.mockRestore();
    });

    it('should re-throw non-connection errors', async () => {
      // Mock axios to throw a different type of error (e.g., authentication error)
      const authError = new Error('Invalid API key');
      (authError as any).code = 'UNAUTHORIZED';
      mockPost.mockRejectedValue(authError);

      await expect(
        api.getOrCreateSession({ id: 'test-id', metadata: testMetadata, state: null })
      ).rejects.toThrow('Failed to get or create session: Invalid API key');

      // Should not show the offline mode message
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Free server unreachable')
      );
      consoleSpy.mockRestore();
    });

    it('keeps primary decrypted metadata when fallback dataEncryptionKey is stale', async () => {
      const primaryKey = new Uint8Array([1]);
      const staleRecoveredKey = new Uint8Array([2]);
      const decryptMock = mockDecryptFromWireString.mockImplementation(
        (key: Uint8Array, _variant: any, wireStr: string) => {
          if (wireStr === '{"path":"/repo","host":"localhost"}' && key[0] === primaryKey[0]) {
            return { path: '/repo', host: 'localhost' };
          }
          if (wireStr === '{"state":"idle"}' && key[0] === primaryKey[0]) {
            return { state: 'idle' };
          }
          if (wireStr === '{"tools":["rg"]}' && key[0] === primaryKey[0]) {
            return { tools: ['rg'] };
          }
          return null;
        }
      );

      const dataKeyCredential = {
        token: 'fake-token',
        encryption: {
          type: 'dataKey' as const,
          publicKey: new Uint8Array(32),
          machineKey: new Uint8Array(32),
        },
      };
      const dataKeyApi = await ApiClient.create(dataKeyCredential as any);
      vi.spyOn<any, any>(dataKeyApi as any, 'createSessionEncryptionContext').mockResolvedValue({
        dataEncryptionKey: new Uint8Array([9]),
        encryptionKey: primaryKey,
        encryptionVariant: 'dataKey',
      });
      mockPost.mockResolvedValue({
        status: 200,
        data: {
          session: {
            id: 'sess-1',
            seq: 3,
            metadata: '{"path":"/repo","host":"localhost"}',
            metadataVersion: 1,
            agentState: '{"state":"idle"}',
            agentStateVersion: 2,
            capabilities: '{"tools":["rg"]}',
            capabilitiesVersion: 1,
            dataEncryptionKey: 'stale-dek',
          },
        },
      });
      const decodeBase64Module = await import('./encryption');
      const bundle = new Uint8Array(209);
      bundle[105] = 1;
      vi.spyOn(decodeBase64Module, 'decodeBase64').mockReturnValue(bundle);
      mockTweetnaclBoxOpen.mockReturnValue(staleRecoveredKey);

      const result = await dataKeyApi.getOrCreateSession({
        id: 'sess-1',
        metadata: testMetadata,
        state: null,
      });

      expect(result?.metadata).toEqual({ path: '/repo', host: 'localhost' });
      expect(result?.agentState).toEqual({ state: 'idle' });
      expect(result?.capabilities).toEqual({ tools: ['rg'] });
      expect(decryptMock).toHaveBeenCalled();
    });
  });

  describe('fetchOfflineSessions', () => {
    it('fetches each requested session directly by id', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url.endsWith('/v1/sessions/sess-a')) {
          return Promise.resolve({
            data: {
              session: {
                id: 'sess-a',
                seq: 11,
                status: 'offline',
                metadata: '{"path":"/repo-a","flavor":"codex"}',
                dataEncryptionKey: null,
                createdAt: 123,
              },
            },
          });
        }
        if (url.endsWith('/v1/sessions/sess-b')) {
          return Promise.resolve({
            data: {
              session: {
                id: 'sess-b',
                seq: 12,
                status: 'offline',
                metadata: '{"path":"/repo-b","flavor":"claude"}',
                dataEncryptionKey: null,
                createdAt: 456,
              },
            },
          });
        }
        return Promise.reject(new Error(`unexpected url: ${url}`));
      });

      const result = await api.fetchOfflineSessions(['sess-a', 'sess-b']);

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockGet).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/v1/sessions/sess-a'),
        expect.any(Object)
      );
      expect(mockGet).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/v1/sessions/sess-b'),
        expect.any(Object)
      );
      expect(result.get('sess-a')).toEqual({
        metadata: { path: '/repo-a', flavor: 'codex' },
        seq: 11,
        createdAt: 123,
      });
      expect(result.get('sess-b')).toEqual({
        metadata: { path: '/repo-b', flavor: 'claude' },
        seq: 12,
        createdAt: 456,
      });
    });
  });

  describe('getOrCreateMachine', () => {
    it('should return minimal machine object when server is unreachable (ECONNREFUSED)', async () => {
      connectionState.reset();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock axios to throw connection refused error
      mockPost.mockRejectedValue({ code: 'ECONNREFUSED' });

      const result = await api.getOrCreateMachine({
        machineId: 'test-machine',
        metadata: testMachineMetadata,
        daemonState: {
          status: 'running',
          pid: 1234,
        },
      });

      expect(result).toEqual({
        id: 'test-machine',
        encryptionKey: expect.any(Uint8Array),
        encryptionVariant: 'legacy',
        metadata: testMachineMetadata,
        metadataVersion: 0,
        daemonState: {
          status: 'running',
          pid: 1234,
        },
        daemonStateVersion: 0,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Free server unreachable')
      );

      consoleSpy.mockRestore();
    });

    it('should return minimal machine object when server endpoint returns 404', async () => {
      connectionState.reset();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Mock axios to return 404
      mockPost.mockRejectedValue({
        response: { status: 404 },
        isAxiosError: true,
      });

      const result = await api.getOrCreateMachine({
        machineId: 'test-machine',
        metadata: testMachineMetadata,
      });

      expect(result).toEqual({
        id: 'test-machine',
        encryptionKey: expect.any(Uint8Array),
        encryptionVariant: 'legacy',
        metadata: testMachineMetadata,
        metadataVersion: 0,
        daemonState: null,
        daemonStateVersion: 0,
      });

      // New unified format via connectionState.fail()
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Free server unreachable')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Machine registration failed: 404')
      );

      consoleSpy.mockRestore();
    });
  });
});
