/**
 * RFC-010: Web browser SQLite message cache via wa-sqlite + IDBBatchAtomicVFS.
 *
 * Uses IndexedDB as the backing store — no OPFS, no SharedArrayBuffer,
 * no COOP/COEP headers required. Multi-tab safe (exclusive locking, writes queue).
 */
import { Logger, safeStringify } from '@saaskit-dev/agentbridge/telemetry';
import type { CachedCapabilitiesRow, CachedMessage, MessageDB } from './messageDBSchema';
import { MIGRATION_SQL_STATEMENTS, SCHEMA_SQL } from './messageDBSchema';

// wa-sqlite-async.wasm is served as a static asset from the /public directory
// (copied there by the postinstall script). Metro web serves /public files at
// the root path, so the file is accessible at /wa-sqlite-async.wasm.
//
// We cannot use a Metro asset import (`import x from '*.wasm'`) here because:
//   - On native: Metro returns a URL string (correct)
//   - On web (Metro bundler): Metro returns a module object/number, not a URL,
//     causing `fetch(wasmAssetUrl)` to throw "Invalid base URL"
//
// Using a static path avoids this divergence entirely.
const wasmAssetUrl = '/wa-sqlite-async.wasm';

const logger = new Logger('sync/messageDB.web');

// Lazily initialized wa-sqlite state
let sqlite3: any = null;
let dbHandle: number | null = null;
// Retry-with-backoff: tracks when the next init attempt is allowed.
// 0 = never failed (or succeeded). >0 = failed, retry after this timestamp.
let initRetryAfter = 0;
let initAttempt = 0;
const INIT_RETRY_BACKOFF_MS = [30_000, 60_000, 120_000]; // max 3 retries then give up

async function getDB(): Promise<{ sqlite3: any; db: number } | null> {
  if (initRetryAfter === -1) return null; // permanently failed after all retries
  if (initRetryAfter > 0 && Date.now() < initRetryAfter) return null; // in cooldown
  if (sqlite3 && dbHandle != null) return { sqlite3, db: dbHandle };

  try {
    // Dynamic import to avoid bundling wa-sqlite on native
    const [factoryModule, vfsModule, apiModule] = await Promise.all([
      import('@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs'),
      import('@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js'),
      import('@journeyapps/wa-sqlite'),
    ]);

    const SQLiteESMFactory = factoryModule.default;
    const { IDBBatchAtomicVFS } = vfsModule;

    // Fetch the wasm binary from the Metro-served asset URL,
    // then pass it directly so wa-sqlite skips its broken locateFile().
    const wasmResponse = await fetch(wasmAssetUrl);
    if (!wasmResponse.ok) {
      throw new Error(`Failed to fetch wasm: ${wasmResponse.status} ${wasmAssetUrl}`);
    }
    const wasmBinary = await wasmResponse.arrayBuffer();

    const wasmModule = await SQLiteESMFactory({ wasmBinary });
    sqlite3 = apiModule.Factory(wasmModule);

    const vfs = await (IDBBatchAtomicVFS as any).create('messageCache', wasmModule);
    sqlite3.vfs_register(vfs, true);

    dbHandle = (await sqlite3.open_v2('messageCache')) as number;
    await exec(SCHEMA_SQL);
    // Run incremental migrations. ALTER TABLE ADD COLUMN throws "duplicate column name"
    // if already applied — that error is expected and safe to ignore.
    for (const stmt of MIGRATION_SQL_STATEMENTS) {
      try {
        await exec(stmt);
      } catch {
        // Column likely already exists; not an error
      }
    }

    initRetryAfter = 0;
    initAttempt = 0;
    logger.info('[messageDB] web wa-sqlite initialized');
    return { sqlite3, db: dbHandle };
  } catch (error) {
    const backoffMs = INIT_RETRY_BACKOFF_MS[initAttempt] ?? -1;
    initAttempt++;
    if (backoffMs === -1) {
      initRetryAfter = -1; // all retries exhausted, give up permanently
      logger.error('[messageDB] web init failed after all retries, no-cache mode', {
        error: safeStringify(error),
        attempts: initAttempt,
      });
    } else {
      initRetryAfter = Date.now() + backoffMs;
      logger.warn('[messageDB] web init failed, will retry', {
        error: safeStringify(error),
        attempt: initAttempt,
        retryInMs: backoffMs,
      });
    }
    return null;
  }
}

async function exec(sql: string): Promise<void> {
  if (!sqlite3 || dbHandle == null) return;
  await sqlite3.exec(dbHandle, sql);
}

async function query<T>(sql: string): Promise<T[]> {
  if (!sqlite3 || dbHandle == null) return [];
  const rows: T[] = [];
  await sqlite3.exec(dbHandle, sql, (row: any[], columns: string[]) => {
    const obj: any = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    rows.push(obj as T);
  });
  return rows;
}

function escapeStr(s: string): string {
  return s.replace(/'/g, "''");
}

export const messageDB: MessageDB = {
  async init() {
    await getDB();
  },

  async getMessages(sessionId, opts) {
    const state = await getDB();
    if (!state) return [];
    const sid = escapeStr(sessionId);
    if (opts.beforeSeq != null) {
      return query<CachedMessage>(
        `SELECT * FROM messages WHERE session_id = '${sid}' AND seq < ${opts.beforeSeq} ORDER BY seq DESC LIMIT ${opts.limit}`
      );
    }
    return query<CachedMessage>(
      `SELECT * FROM messages WHERE session_id = '${sid}' ORDER BY seq ASC LIMIT ${opts.limit}`
    );
  },

  async getLastSeq(sessionId) {
    const state = await getDB();
    if (!state) return 0;
    const sid = escapeStr(sessionId);
    const rows = await query<{ last_seq: number }>(
      `SELECT last_seq FROM session_sync WHERE session_id = '${sid}'`
    );
    return rows[0]?.last_seq ?? 0;
  },

  async upsertMessages(sessionId, messages) {
    if (messages.length === 0) return;
    const state = await getDB();
    if (!state) return;
    const sid = escapeStr(sessionId);
    const statements = messages.map(m => {
      const traceIdVal = m.trace_id ? `'${escapeStr(m.trace_id)}'` : 'NULL';
      return `INSERT OR REPLACE INTO messages (id, session_id, seq, content, trace_id, role, created_at, updated_at)
       VALUES ('${escapeStr(m.id)}', '${sid}', ${m.seq}, '${escapeStr(m.content)}', ${traceIdVal}, '${escapeStr(m.role)}', ${m.created_at}, ${m.updated_at})`;
    });
    await exec(`BEGIN TRANSACTION; ${statements.join('; ')}; COMMIT;`);
  },

  async updateLastSeq(sessionId, seq) {
    const state = await getDB();
    if (!state) return;
    const sid = escapeStr(sessionId);
    await exec(
      `INSERT OR REPLACE INTO session_sync (session_id, last_seq, synced_at) VALUES ('${sid}', ${seq}, ${Date.now()})`
    );
  },

  async upsertMessagesAndSeq(sessionId, messages, seq) {
    const state = await getDB();
    if (!state) return;
    const sid = escapeStr(sessionId);
    const stmts = messages.map(m => {
      const traceIdVal = m.trace_id ? `'${escapeStr(m.trace_id)}'` : 'NULL';
      return `INSERT OR REPLACE INTO messages (id, session_id, seq, content, trace_id, role, created_at, updated_at)
       VALUES ('${escapeStr(m.id)}', '${sid}', ${m.seq}, '${escapeStr(m.content)}', ${traceIdVal}, '${escapeStr(m.role)}', ${m.created_at}, ${m.updated_at})`;
    });
    stmts.push(
      `INSERT OR REPLACE INTO session_sync (session_id, last_seq, synced_at) VALUES ('${sid}', ${seq}, ${Date.now()})`
    );
    await exec(`BEGIN TRANSACTION; ${stmts.join('; ')}; COMMIT;`);
  },

  async deleteSession(sessionId) {
    const state = await getDB();
    if (!state) return;
    const sid = escapeStr(sessionId);
    await exec(
      `DELETE FROM messages WHERE session_id = '${sid}'; DELETE FROM session_sync WHERE session_id = '${sid}'`
    );
  },

  async deleteAll() {
    const state = await getDB();
    if (!state) return;
    await exec("DELETE FROM messages; DELETE FROM session_sync; DELETE FROM capabilities_cache; DELETE FROM kv_store WHERE namespace = 'main'");
  },

  async getCapabilities(machineId, agentType) {
    const state = await getDB();
    if (!state) return null;
    const rows = await query<CachedCapabilitiesRow>(
      `SELECT * FROM capabilities_cache WHERE machine_id = '${escapeStr(machineId)}' AND agent_type = '${escapeStr(agentType)}'`
    );
    return rows[0] ?? null;
  },

  async upsertCapabilities(row) {
    const state = await getDB();
    if (!state) return;
    await exec(
      `INSERT OR REPLACE INTO capabilities_cache (machine_id, agent_type, capabilities, updated_at, kv_version)
       VALUES ('${escapeStr(row.machine_id)}', '${escapeStr(row.agent_type)}', '${escapeStr(row.capabilities)}', ${row.updated_at}, ${row.kv_version ?? 'NULL'})`
    );
  },

  async kvGetAll(namespace) {
    const state = await getDB();
    if (!state) return [];
    return query<{ key: string; value: string }>(
      `SELECT key, value FROM kv_store WHERE namespace = '${escapeStr(namespace)}'`
    );
  },

  async kvSet(namespace, key, value) {
    const state = await getDB();
    if (!state) return;
    await exec(
      `INSERT OR REPLACE INTO kv_store (namespace, key, value) VALUES ('${escapeStr(namespace)}', '${escapeStr(key)}', '${escapeStr(value)}')`
    );
  },

  async kvDelete(namespace, key) {
    const state = await getDB();
    if (!state) return;
    await exec(
      `DELETE FROM kv_store WHERE namespace = '${escapeStr(namespace)}' AND key = '${escapeStr(key)}'`
    );
  },

  async kvDeleteAll(namespace) {
    const state = await getDB();
    if (!state) return;
    await exec(`DELETE FROM kv_store WHERE namespace = '${escapeStr(namespace)}'`);
  },
};
