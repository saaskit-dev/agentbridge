/**
 * @agentbridge/runtime-edge - Edge Runtime
 *
 * Provides runtime environment information for Edge environments
 * (Cloudflare Workers, Vercel Edge, Deno Deploy)
 */

import type { Runtime, RuntimeType, RuntimeCapabilities } from '@agentbridge/interfaces';
import { getSingletonSync } from '@agentbridge/utils';

/**
 * Edge Runtime implementation
 */
export class RuntimeEdge implements Runtime {
  private capabilities: RuntimeCapabilities;

  constructor() {
    this.capabilities = {
      fs: false,
      network: true,
      websocket: true,
      crypto: true,
      env: true, // Some edge environments have env access
      timers: true,
    };
  }

  getType(): RuntimeType {
    return 'edge';
  }

  isVM(): boolean {
    return false;
  }

  isEdge(): boolean {
    return true;
  }

  getCapabilities(): RuntimeCapabilities {
    return { ...this.capabilities };
  }

  getEnv(key: string): string | undefined {
    // Try process.env first (some Edge environments have it)
    if (typeof process !== 'undefined' && process.env) {
      return process.env[key];
    }
    return undefined;
  }

  now(): number {
    return Date.now();
  }

  setTimeout(callback: () => void, delay: number): unknown {
    return globalThis.setTimeout(callback, delay);
  }

  clearTimeout(handle: unknown): void {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  }

  getRandomValues(buffer: Uint8Array): Uint8Array {
    return globalThis.crypto.getRandomValues(buffer);
  }
}

/**
 * Create an Edge runtime instance (uses singleton)
 */
export function createRuntimeEdge(): RuntimeEdge {
  return getSingletonSync('runtime-edge', () => new RuntimeEdge());
}

// Register with the factory
import { registerRuntimeFactory } from '@agentbridge/interfaces';
registerRuntimeFactory('edge', () => new RuntimeEdge());
