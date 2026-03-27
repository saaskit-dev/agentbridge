/**
 * In-memory cached KV store backed by SQLite.
 *
 * On init, loads all rows from the `kv_store` table into a Map.
 * Reads are synchronous (from memory). Writes update memory immediately
 * and queue an async SQLite write (fire-and-forget).
 *
 * Two singleton instances:
 *   - `kvStore` ("main" namespace) — cleared on logout
 *   - `serverConfigStore` ("server-config" namespace) — survives logout
 */
import { messageDB } from './messageDB';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('sync/cachedKVStore');

class CachedKVStore {
  private cache = new Map<string, string>();
  private namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  async init(): Promise<void> {
    const rows = await messageDB.kvGetAll(this.namespace);
    for (const row of rows) {
      this.cache.set(row.key, row.value);
    }
  }

  getString(key: string): string | undefined {
    return this.cache.get(key);
  }

  getBoolean(key: string): boolean | undefined {
    const v = this.cache.get(key);
    if (v === undefined) return undefined;
    return v === 'true' || v === '1';
  }

  getNumber(key: string): number | undefined {
    const v = this.cache.get(key);
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  }

  set(key: string, value: string | number | boolean): void {
    const str = String(value);
    this.cache.set(key, str);
    messageDB.kvSet(this.namespace, key, str).catch(e => {
      logger.error('KV write failed', toError(e), { key });
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
    messageDB.kvDelete(this.namespace, key).catch(e => {
      logger.error('KV delete failed', toError(e), { key });
    });
  }

  getAllKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  /** Clear in-memory cache only. SQLite cleanup is handled by messageDB.deleteAll(). */
  clearAll(): void {
    this.cache.clear();
  }
}

export const kvStore = new CachedKVStore('main');
export const serverConfigStore = new CachedKVStore('server-config');

export async function initKVStores(): Promise<void> {
  await messageDB.init();
  await Promise.all([kvStore.init(), serverConfigStore.init()]);
}
