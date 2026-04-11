import { describe, expect, it, vi } from 'vitest';
import { registerKillSessionHandler } from './registerKillSessionHandler';

describe('registerKillSessionHandler', () => {
  it('propagates kill failures to the caller', async () => {
    const registerHandler = vi.fn();
    const rpcHandlerManager = {
      registerHandler,
    } as any;
    const killThisFree = vi.fn().mockRejectedValue(new Error('boom'));

    registerKillSessionHandler(rpcHandlerManager, killThisFree);

    const handler = registerHandler.mock.calls[0]?.[1];
    expect(typeof handler).toBe('function');

    await expect(handler()).rejects.toThrow('boom');
    expect(killThisFree).toHaveBeenCalledTimes(1);
  });
});
