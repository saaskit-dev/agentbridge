/**
 * @agentbridge/interfaces - Runtime Interface
 * Runtime environment detection and capabilities
 */

/**
 * Runtime type enumeration
 */
export type RuntimeType = 'vm' | 'edge';

/**
 * Runtime capabilities
 */
export interface RuntimeCapabilities {
  /** Has access to file system */
  fs: boolean;
  /** Has access to network (fetch) */
  network: boolean;
  /** Has WebSocket support */
  websocket: boolean;
  /** Has native crypto (Web Crypto API) */
  crypto: boolean;
  /** Has process.env access */
  env: boolean;
  /** Has setTimeout/setInterval */
  timers: boolean;
}

/**
 * Runtime - Provides environment detection and capabilities
 *
 * This interface abstracts runtime environment differences.
 * Only two environments are supported:
 * - VM: Node.js, Bun, Deno (with Node compat)
 * - Edge: Cloudflare Workers, Vercel Edge, Deno Deploy
 */
export interface Runtime {
  /**
   * Get runtime type
   */
  getType(): RuntimeType;

  /**
   * Check if running in VM environment
   */
  isVM(): boolean;

  /**
   * Check if running in Edge environment
   */
  isEdge(): boolean;

  /**
   * Get runtime capabilities
   */
  getCapabilities(): RuntimeCapabilities;

  /**
   * Get environment variable
   */
  getEnv(key: string): string | undefined;

  /**
   * Get current timestamp in ms
   */
  now(): number;

  /**
   * Schedule a callback after delay
   */
  setTimeout(callback: () => void, delay: number): unknown;

  /**
   * Cancel a scheduled callback
   */
  clearTimeout(handle: unknown): void;

  /**
   * Get random bytes
   */
  getRandomValues(buffer: Uint8Array): Uint8Array;
}

/**
 * Runtime factory function type
 */
export type RuntimeFactory = () => Runtime;

const runtimeFactories = new Map<string, RuntimeFactory>();

/**
 * Register a runtime factory
 */
export function registerRuntimeFactory(type: string, factory: RuntimeFactory): void {
  runtimeFactories.set(type, factory);
}

/**
 * Create a runtime instance
 */
export function createRuntime(type: RuntimeType = 'vm'): Runtime {
  const factory = runtimeFactories.get(type);
  if (!factory) {
    throw new Error(`Unknown runtime type: ${type}. Available: ${getRegisteredRuntimeTypes().join(', ')}`);
  }
  return factory();
}

/**
 * Get list of registered runtime types
 */
export function getRegisteredRuntimeTypes(): string[] {
  return Array.from(runtimeFactories.keys());
}

/**
 * Detect current runtime type
 */
export function detectRuntimeType(): RuntimeType {
  // Check for Edge environment
  if (typeof globalThis !== 'undefined') {
    // Cloudflare Workers
    if ((globalThis as unknown as Record<string, unknown>).caches !== undefined) {
      return 'edge';
    }
    // Vercel Edge (check for EdgeRuntime global)
    if (typeof (globalThis as unknown as Record<string, unknown>).EdgeRuntime !== 'undefined') {
      return 'edge';
    }
  }

  // Check for Node.js/Bun
  if (typeof process !== 'undefined' && process.versions?.node) {
    return 'vm';
  }

  // Default to edge for browser-like environments
  return 'edge';
}
