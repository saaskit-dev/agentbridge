/**
 * @agentbridge/utils - Singleton Utilities
 * Edge cold start singleton pattern
 */

/**
 * Singleton factory function type
 */
export type SingletonFactory<T> = () => T | Promise<T>;

/**
 * Singleton holder for Edge environments
 *
 * In Edge environments (Cloudflare Workers, Vercel Edge, Deno Deploy),
 * global state can persist between requests during cold starts.
 * This utility provides a consistent way to manage singletons.
 *
 * @example
 * ```typescript
 * const getDb = () => getSingleton('db', () => new Database());
 * const db = await getDb();
 * ```
 */
const singletons = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();

/**
 * Get or create a singleton value
 *
 * @param key - Unique key for the singleton
 * @param factory - Factory function to create the singleton if it doesn't exist
 * @returns The singleton value
 */
export async function getSingleton<T>(key: string, factory: SingletonFactory<T>): Promise<T> {
  // Return existing singleton if available
  if (singletons.has(key)) {
    return singletons.get(key) as T;
  }

  // Wait for pending initialization if in progress
  if (pending.has(key)) {
    return pending.get(key) as Promise<T>;
  }

  // Start initialization
  const promise = Promise.resolve(factory());
  pending.set(key, promise);

  try {
    const value = await promise;
    singletons.set(key, value);
    return value;
  } finally {
    pending.delete(key);
  }
}

/**
 * Get or create a synchronous singleton value
 *
 * @param key - Unique key for the singleton
 * @param factory - Factory function to create the singleton if it doesn't exist
 * @returns The singleton value
 */
export function getSingletonSync<T>(key: string, factory: () => T): T {
  if (singletons.has(key)) {
    return singletons.get(key) as T;
  }

  const value = factory();
  singletons.set(key, value);
  return value;
}

/**
 * Check if a singleton exists
 */
export function hasSingleton(key: string): boolean {
  return singletons.has(key);
}

/**
 * Clear a specific singleton
 */
export function clearSingleton(key: string): boolean {
  return singletons.delete(key);
}

/**
 * Clear all singletons (useful for testing)
 */
export function clearAllSingletons(): void {
  singletons.clear();
  pending.clear();
}

/**
 * Get all singleton keys (for debugging)
 */
export function getSingletonKeys(): string[] {
  return Array.from(singletons.keys());
}
