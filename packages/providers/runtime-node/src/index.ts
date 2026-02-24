/**
 * @agentbridge/runtime-node - Node.js Runtime
 *
 * Provides runtime environment information for Node.js
 */

import type { Runtime, RuntimeType, RuntimeCapabilities } from '@agentbridge/interfaces';

/**
 * Node.js Runtime implementation
 */
export class RuntimeNode implements Runtime {
  private capabilities: RuntimeCapabilities;

  constructor() {
    this.capabilities = {
      fs: true,
      network: true,
      websocket: true,
      crypto: true,
      env: true,
      timers: true,
    };
  }

  getType(): RuntimeType {
    return 'vm';
  }

  isVM(): boolean {
    return true;
  }

  isEdge(): boolean {
    return false;
  }

  getCapabilities(): RuntimeCapabilities {
    return { ...this.capabilities };
  }

  getEnv(key: string): string | undefined {
    return process.env[key];
  }

  now(): number {
    return Date.now();
  }

  setTimeout(callback: () => void, delay: number): NodeJS.Timeout {
    return globalThis.setTimeout(callback, delay);
  }

  clearTimeout(handle: unknown): void {
    globalThis.clearTimeout(handle as NodeJS.Timeout);
  }

  getRandomValues(buffer: Uint8Array): Uint8Array {
    return require('crypto').webcrypto.getRandomValues(buffer);
  }
}

/**
 * Create a Node.js runtime instance
 */
export function createRuntimeNode(): RuntimeNode {
  return new RuntimeNode();
}

// Register with the factory
import { registerRuntimeFactory } from '@agentbridge/interfaces';
registerRuntimeFactory('vm', () => new RuntimeNode());
