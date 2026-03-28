/**
 * RFC-010: Shared types and schema for the local SQLite message cache.
 *
 * This file has NO platform-specific variants (.native.ts / .web.ts).
 * Platform implementations import from here to avoid Metro's
 * platform-suffix resolution creating self-referencing require cycles.
 */

export interface CachedMessage {
  id: string;
  session_id: string;
  seq: number;
  content: string;
  /** DB-level traceId stored alongside content so pagination from SQLite uses the
   *  same traceId as the server fetch path — preventing reducer merge failures
   *  at page boundaries. NULL for messages cached before this column was added. */
  trace_id: string | null;
  role: string;
  created_at: number;
  updated_at: number;
}

export interface CachedCapabilitiesRow {
  machine_id: string;
  agent_type: string;
  capabilities: string;
  updated_at: number;
  kv_version: number | null;
}

export interface MessageDB {
  init(): Promise<void>;

  /** Read cached messages for a session, ordered by seq ASC. */
  getMessages(
    sessionId: string,
    opts: {
      limit: number;
      beforeSeq?: number;
    }
  ): Promise<CachedMessage[]>;

  /** Read the last-known seq watermark for a session. */
  getLastSeq(sessionId: string): Promise<number>;

  /** Batch upsert messages (INSERT OR REPLACE). */
  upsertMessages(sessionId: string, messages: CachedMessage[]): Promise<void>;

  /** Update the sync watermark for a session. */
  updateLastSeq(sessionId: string, seq: number): Promise<void>;

  /**
   * Atomically upsert messages AND update the seq watermark in one transaction.
   * Prevents last_seq from advancing ahead of the messages written to disk
   * (which could cause messages to be skipped on the next cold start).
   * Safe to call with an empty messages array — only updates the seq in that case.
   */
  upsertMessagesAndSeq(sessionId: string, messages: CachedMessage[], seq: number): Promise<void>;

  /** Delete all cached data for a session. */
  deleteSession(sessionId: string): Promise<void>;

  /** Delete all cached data for every session. */
  deleteAll(): Promise<void>;

  /** Read cached capabilities for a machine+agent pair. */
  getCapabilities(machineId: string, agentType: string): Promise<CachedCapabilitiesRow | null>;

  /** Upsert cached capabilities for a machine+agent pair. */
  upsertCapabilities(row: CachedCapabilitiesRow): Promise<void>;

  /** Load all KV pairs for a namespace. */
  kvGetAll(namespace: string): Promise<Array<{ key: string; value: string }>>;

  /** Upsert a single KV pair. */
  kvSet(namespace: string, key: string, value: string): Promise<void>;

  /** Delete a single KV pair. */
  kvDelete(namespace: string, key: string): Promise<void>;

  /** Delete all KV pairs in a namespace. */
  kvDeleteAll(namespace: string): Promise<void>;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  content    TEXT NOT NULL,
  role       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msg_session_seq
  ON messages(session_id, seq);

CREATE TABLE IF NOT EXISTS session_sync (
  session_id TEXT PRIMARY KEY,
  last_seq   INTEGER NOT NULL DEFAULT 0,
  synced_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS capabilities_cache (
  machine_id   TEXT NOT NULL,
  agent_type   TEXT NOT NULL,
  capabilities TEXT NOT NULL,
  updated_at   INTEGER NOT NULL,
  kv_version   INTEGER,
  PRIMARY KEY (machine_id, agent_type)
);

CREATE TABLE IF NOT EXISTS kv_store (
  namespace TEXT NOT NULL DEFAULT 'main',
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);
`;

/**
 * Incremental migrations applied after SCHEMA_SQL on every open.
 * Each statement is idempotent — safe to re-run on an up-to-date DB
 * (ALTER TABLE ADD COLUMN fails silently when the column already exists).
 */
export const MIGRATION_SQL_STATEMENTS: string[] = [
  // v2: add trace_id column for consistent traceId across SQLite and server-fetch paths
  'ALTER TABLE messages ADD COLUMN trace_id TEXT',
];
