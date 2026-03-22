/**
 * RFC-010: Local SQLite message cache — re-exports shared interface and schema.
 *
 * Platform implementations:
 *   - messageDB.native.ts  → expo-sqlite (iOS/Android)
 *   - messageDB.web.ts     → wa-sqlite + IDBBatchAtomicVFS (Browser)
 *
 * Metro resolves the correct file automatically via .native.ts / .web.ts suffixes.
 *
 * Shared types live in messageDBSchema.ts (no platform variants) so that
 * platform files can import them without creating a self-referencing cycle.
 */

export type { CachedMessage, MessageDB } from './messageDBSchema';
export { SCHEMA_SQL } from './messageDBSchema';

/**
 * No-op fallback — overridden by messageDB.native.ts or messageDB.web.ts at build time.
 * This exists so TypeScript can resolve `import { messageDB } from './messageDB'`.
 */
import type { MessageDB } from './messageDBSchema';

export const messageDB: MessageDB = {
  async init() {},
  async getMessages() {
    return [];
  },
  async getLastSeq() {
    return 0;
  },
  async upsertMessages() {},
  async updateLastSeq() {},
  async deleteSession() {},
};
