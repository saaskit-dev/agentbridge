/**
 * RFC-010: Web browser SQLite message cache via wa-sqlite + IDBBatchAtomicVFS.
 *
 * Uses IndexedDB as the backing store — no OPFS, no SharedArrayBuffer,
 * no COOP/COEP headers required. Multi-tab safe (exclusive locking, writes queue).
 */
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import type { CachedMessage, MessageDB } from './messageDBSchema';
import { SCHEMA_SQL } from './messageDBSchema';

// Metro treats .wasm as an asset (metro.config.js assetExts), so this import
// resolves to a URL the dev server can actually serve. We then fetch it manually
// and pass the binary via `wasmBinary` — bypassing wa-sqlite's broken
// import.meta.url-based locateFile (which points at the JS bundle, not the wasm).
// @ts-ignore — Metro asset import
import wasmAssetUrl from '@journeyapps/wa-sqlite/dist/wa-sqlite-async.wasm';

const logger = new Logger('sync/messageDB.web');

// Lazily initialized wa-sqlite state
let sqlite3: any = null;
let dbHandle: number | null = null;
let initFailed = false;

async function getDB(): Promise<{ sqlite3: any; db: number } | null> {
  if (initFailed) return null;
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

    logger.info('[messageDB] web wa-sqlite initialized');
    return { sqlite3, db: dbHandle };
  } catch (error) {
    logger.warn('[messageDB] web init failed, falling back to no-cache mode', {
      error: String(error),
    });
    initFailed = true;
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
    const statements = messages.map(
      m =>
        `INSERT OR REPLACE INTO messages (id, session_id, seq, content, role, created_at, updated_at)
       VALUES ('${escapeStr(m.id)}', '${sid}', ${m.seq}, '${escapeStr(m.content)}', '${escapeStr(m.role)}', ${m.created_at}, ${m.updated_at})`
    );
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
    await exec('DELETE FROM messages; DELETE FROM session_sync');
  },
};
