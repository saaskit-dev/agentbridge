/**
 * @agentbridge/storage-memory - In-Memory Storage
 *
 * Simple in-memory storage implementation for testing and development
 */

import type { IStorage } from '@agentbridge/interfaces';

/**
 * In-memory storage implementation
 *
 * Uses a Map internally. Data is lost when the process exits.
 * Useful for testing, development, and Edge environments with
 * module-level state persistence.
 */
export class MemoryStorage implements IStorage {
  private data = new Map<string, unknown>();
  private namespace: string;

  constructor(options?: { namespace?: string }) {
    this.namespace = options?.namespace || '';
  }

  private prefixKey(key: string): string {
    return this.namespace ? `${this.namespace}:${key}` : key;
  }

  async get<T>(key: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key);
    const value = this.data.get(prefixedKey);
    return value !== undefined ? (value as T) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    this.data.set(prefixedKey, value as unknown);
  }

  async delete(key: string): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    this.data.delete(prefixedKey);
  }

  async has(key: string): Promise<boolean> {
    const prefixedKey = this.prefixKey(key);
    return this.data.has(prefixedKey);
  }

  async keys(): Promise<string[]> {
    const allKeys = Array.from(this.data.keys());
    if (!this.namespace) {
      return allKeys;
    }
    const prefix = `${this.namespace}:`;
    return allKeys.filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
  }

  async clear(): Promise<void> {
    if (!this.namespace) {
      this.data.clear();
    } else {
      const prefix = `${this.namespace}:`;
      for (const key of Array.from(this.data.keys())) {
        if (key.startsWith(prefix)) {
          this.data.delete(key);
        }
      }
    }
  }

  /**
   * Get the number of items in storage
   */
  get size(): number {
    if (!this.namespace) {
      return this.data.size;
    }
    const prefix = `${this.namespace}:`;
    return Array.from(this.data.keys()).filter(k => k.startsWith(prefix)).length;
  }
}

/**
 * Create an in-memory storage instance
 */
export function createMemoryStorage(options?: { namespace?: string }): MemoryStorage {
  return new MemoryStorage(options);
}

/**
 * Get or create a singleton in-memory storage instance
 */
let defaultInstance: MemoryStorage | null = null;

export function getMemoryStorage(options?: { namespace?: string }): MemoryStorage {
  if (!options?.namespace && !defaultInstance) {
    defaultInstance = new MemoryStorage();
  }
  if (options?.namespace) {
    return new MemoryStorage(options);
  }
  return defaultInstance!;
}