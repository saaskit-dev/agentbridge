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
  role: string;
  created_at: number;
  updated_at: number;
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

  /** Delete all cached data for a session. */
  deleteSession(sessionId: string): Promise<void>;

  /** Delete all cached data for every session. */
  deleteAll(): Promise<void>;
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
`;
