/**
 * RFC-010: Native (iOS/Android) SQLite message cache via expo-sqlite.
 */
import * as SQLite from 'expo-sqlite';
import type { SQLiteBindValue } from 'expo-sqlite';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { sanitizeSQLiteParams } from './cacheContent';
import type { CachedCapabilitiesRow, CachedMessage, MessageDB } from './messageDBSchema';
import { MIGRATION_SQL_STATEMENTS, SCHEMA_SQL } from './messageDBSchema';

const logger = new Logger('sync/messageDB.native');

let db: SQLite.SQLiteDatabase | null = null;

async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('messageCache.db');
  await db.execAsync(SCHEMA_SQL);
  // Run incremental migrations. ALTER TABLE ADD COLUMN throws "duplicate column name"
  // if already applied — that error is expected and safe to ignore.
  for (const stmt of MIGRATION_SQL_STATEMENTS) {
    try {
      await db.execAsync(stmt);
    } catch {
      // Column likely already exists; not an error
    }
  }
  logger.info('[messageDB] native SQLite initialized');
  return db;
}

function sqliteParams(params: readonly (SQLiteBindValue | undefined)[]): SQLiteBindValue[] {
  return sanitizeSQLiteParams(params);
}

export const messageDB: MessageDB = {
  async init() {
    await getDB();
  },

  async getMessages(sessionId, opts) {
    const d = await getDB();
    if (opts.beforeSeq != null) {
      return d.getAllAsync<CachedMessage>(
        'SELECT * FROM messages WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?',
        sqliteParams([sessionId, opts.beforeSeq, opts.limit])
      );
    }
    return d.getAllAsync<CachedMessage>(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC LIMIT ?',
      sqliteParams([sessionId, opts.limit])
    );
  },

  async getLastSeq(sessionId) {
    const d = await getDB();
    const row = await d.getFirstAsync<{ last_seq: number }>(
      'SELECT last_seq FROM session_sync WHERE session_id = ?',
      sqliteParams([sessionId])
    );
    return row?.last_seq ?? 0;
  },

  async upsertMessages(sessionId, messages) {
    if (messages.length === 0) return;
    const d = await getDB();
    await d.withTransactionAsync(async () => {
      for (const m of messages) {
        await d.runAsync(
          `INSERT OR REPLACE INTO messages (id, session_id, seq, content, trace_id, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          sqliteParams([m.id, sessionId, m.seq, m.content, m.trace_id, m.role, m.created_at, m.updated_at])
        );
      }
    });
  },

  async updateLastSeq(sessionId, seq) {
    const d = await getDB();
    await d.runAsync(
      'INSERT OR REPLACE INTO session_sync (session_id, last_seq, synced_at) VALUES (?, ?, ?)',
      sqliteParams([sessionId, seq, Date.now()])
    );
  },

  async upsertMessagesAndSeq(sessionId, messages, seq) {
    const d = await getDB();
    await d.withTransactionAsync(async () => {
      for (const m of messages) {
        await d.runAsync(
          `INSERT OR REPLACE INTO messages (id, session_id, seq, content, trace_id, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          sqliteParams([m.id, sessionId, m.seq, m.content, m.trace_id, m.role, m.created_at, m.updated_at])
        );
      }
      await d.runAsync(
        'INSERT OR REPLACE INTO session_sync (session_id, last_seq, synced_at) VALUES (?, ?, ?)',
        sqliteParams([sessionId, seq, Date.now()])
      );
    });
  },

  async deleteSession(sessionId) {
    const d = await getDB();
    await d.runAsync('DELETE FROM messages WHERE session_id = ?', sqliteParams([sessionId]));
    await d.runAsync('DELETE FROM session_sync WHERE session_id = ?', sqliteParams([sessionId]));
  },

  async deleteAll() {
    const d = await getDB();
    await d.runAsync('DELETE FROM messages');
    await d.runAsync('DELETE FROM session_sync');
    await d.runAsync('DELETE FROM capabilities_cache');
    await d.runAsync("DELETE FROM kv_store WHERE namespace = 'main'");
  },

  async getCapabilities(machineId, agentType) {
    const d = await getDB();
    const row = await d.getFirstAsync<CachedCapabilitiesRow>(
      'SELECT * FROM capabilities_cache WHERE machine_id = ? AND agent_type = ?',
      sqliteParams([machineId, agentType])
    );
    return row ?? null;
  },

  async upsertCapabilities(row) {
    const d = await getDB();
    await d.runAsync(
      `INSERT OR REPLACE INTO capabilities_cache (machine_id, agent_type, capabilities, updated_at, kv_version)
       VALUES (?, ?, ?, ?, ?)`,
      sqliteParams([row.machine_id, row.agent_type, row.capabilities, row.updated_at, row.kv_version])
    );
  },

  async kvGetAll(namespace) {
    const d = await getDB();
    return d.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM kv_store WHERE namespace = ?',
      sqliteParams([namespace])
    );
  },

  async kvSet(namespace, key, value) {
    const d = await getDB();
    await d.runAsync(
      'INSERT OR REPLACE INTO kv_store (namespace, key, value) VALUES (?, ?, ?)',
      sqliteParams([namespace, key, value])
    );
  },

  async kvDelete(namespace, key) {
    const d = await getDB();
    await d.runAsync('DELETE FROM kv_store WHERE namespace = ? AND key = ?', sqliteParams([namespace, key]));
  },

  async kvDeleteAll(namespace) {
    const d = await getDB();
    await d.runAsync('DELETE FROM kv_store WHERE namespace = ?', sqliteParams([namespace]));
  },
};
