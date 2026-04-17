import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RPC_WIRE_RESPONSE_CHARS } from '@/utils/transportSafety';

const mocks = vi.hoisted(() => ({
  encryptToWireString: vi.fn(async (_key: Uint8Array, _variant: string, data: any) => {
    if (data?.makeOversizedResponse) {
      return 'x'.repeat(MAX_RPC_WIRE_RESPONSE_CHARS + 1);
    }
    return JSON.stringify(data);
  }),
  decryptFromWireString: vi.fn(async (_key: Uint8Array, _variant: string, data: any) => data),
}));

vi.mock('@/api/encryption', () => ({
  encryptToWireString: mocks.encryptToWireString,
  decryptFromWireString: mocks.decryptFromWireString,
}));

import { RpcHandlerManager } from '../RpcHandlerManager';

describe('RpcHandlerManager', () => {
  beforeEach(() => {
    mocks.encryptToWireString.mockClear();
    mocks.decryptFromWireString.mockClear();
  });

  it('returns a fallback error when the encrypted response exceeds the wire limit', async () => {
    const manager = new RpcHandlerManager({
      scopePrefix: 'session',
      encryptionKey: new Uint8Array(32),
      encryptionVariant: 'dataKey',
    });

    manager.registerHandler('oversized', async () => ({ makeOversizedResponse: true }));

    const result = await manager.handleRequest({
      method: 'session:oversized',
      params: {},
    } as any);

    expect(typeof result).toBe('string');
    expect(result.length).toBeLessThan(MAX_RPC_WIRE_RESPONSE_CHARS);
    expect(JSON.parse(result)).toEqual(
      expect.objectContaining({
        error: expect.stringContaining('RPC response too large to transport safely'),
      })
    );
  });
});
