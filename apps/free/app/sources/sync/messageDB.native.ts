/**
 * RFC-010: Native (iOS/Android) SQLite message cache via expo-sqlite.
 */
import * as SQLite from 'expo-sqlite';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import type { CachedCapabilitiesRow, CachedMessage, MessageDB } from './messageDBSchema';
import { SCHEMA_SQL } from './messageDBSchema';

const logger = new Logger('sync/messageDB.native');

let db: SQLite.SQLiteDatabase | null = null;

async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('messageCache.db');
  await db.execAsync(SCHEMA_SQL);
  logger.info('[messageDB] native SQLite initialized');
  return db;
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
        [sessionId, opts.beforeSeq, opts.limit]
      );
    }
    return d.getAllAsync<CachedMessage>(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC LIMIT ?',
      [sessionId, opts.limit]
    );
  },

  async getLastSeq(sessionId) {
    const d = await getDB();
    const row = await d.getFirstAsync<{ last_seq: number }>(
      'SELECT last_seq FROM session_sync WHERE session_id = ?',
      [sessionId]
    );
    return row?.last_seq ?? 0;
  },

  async upsertMessages(sessionId, messages) {
    if (messages.length === 0) return;
    const d = await getDB();
    await d.withTransactionAsync(async () => {
      for (const m of messages) {
        await d.runAsync(
          `INSERT OR REPLACE INTO messages (id, session_id, seq, content, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [m.id, sessionId, m.seq, m.content, m.role, m.created_at, m.updated_at]
        );
      }
    });
  },

  async updateLastSeq(sessionId, seq) {
    const d = await getDB();
    await d.runAsync(
      'INSERT OR REPLACE INTO session_sync (session_id, last_seq, synced_at) VALUES (?, ?, ?)',
      [sessionId, seq, Date.now()]
    );
  },

  async upsertMessagesAndSeq(sessionId, messages, seq) {
    const d = await getDB();
    await d.withTransactionAsync(async () => {
      for (const m of messages) {
        await d.runAsync(
          `INSERT OR REPLACE INTO messages (id, session_id, seq, content, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [m.id, sessionId, m.seq, m.content, m.role, m.created_at, m.updated_at]
        );
      }
      await d.runAsync(
        'INSERT OR REPLACE INTO session_sync (session_id, last_seq, synced_at) VALUES (?, ?, ?)',
        [sessionId, seq, Date.now()]
      );
    });
  },

  async deleteSession(sessionId) {
    const d = await getDB();
    await d.runAsync('DELETE FROM messages WHERE session_id = ?', [sessionId]);
    await d.runAsync('DELETE FROM session_sync WHERE session_id = ?', [sessionId]);
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
      [machineId, agentType]
    );
    return row ?? null;
  },

  async upsertCapabilities(row) {
    const d = await getDB();
    await d.runAsync(
      `INSERT OR REPLACE INTO capabilities_cache (machine_id, agent_type, capabilities, updated_at, kv_version)
       VALUES (?, ?, ?, ?, ?)`,
      [row.machine_id, row.agent_type, row.capabilities, row.updated_at, row.kv_version]
    );
  },

  async kvGetAll(namespace) {
    const d = await getDB();
    return d.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM kv_store WHERE namespace = ?',
      [namespace]
    );
  },

  async kvSet(namespace, key, value) {
    const d = await getDB();
    await d.runAsync(
      'INSERT OR REPLACE INTO kv_store (namespace, key, value) VALUES (?, ?, ?)',
      [namespace, key, value]
    );
  },

  async kvDelete(namespace, key) {
    const d = await getDB();
    await d.runAsync('DELETE FROM kv_store WHERE namespace = ? AND key = ?', [namespace, key]);
  },

  async kvDeleteAll(namespace) {
    const d = await getDB();
    await d.runAsync('DELETE FROM kv_store WHERE namespace = ?', [namespace]);
  },
};
