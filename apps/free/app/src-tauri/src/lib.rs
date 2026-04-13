use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::{fs, io, path::PathBuf, sync::Mutex};
use tauri::Manager;

const SCHEMA_SQL: &str = r#"
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
"#;

const MIGRATION_SQL_STATEMENTS: [&str; 1] = ["ALTER TABLE messages ADD COLUMN trace_id TEXT"];

type CommandResult<T> = Result<T, String>;

struct AppDatabase {
  connection: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct CachedMessage {
  id: String,
  session_id: String,
  seq: i64,
  content: String,
  trace_id: Option<String>,
  role: String,
  created_at: i64,
  updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct CachedCapabilitiesRow {
  machine_id: String,
  agent_type: String,
  capabilities: String,
  updated_at: i64,
  kv_version: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct KvEntry {
  key: String,
  value: String,
}

#[derive(Debug, Deserialize)]
struct SessionIdPayload {
  session_id: String,
}

#[derive(Debug, Deserialize)]
struct GetMessagesPayload {
  session_id: String,
  limit: i64,
  before_seq: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct UpsertMessagesPayload {
  session_id: String,
  messages: Vec<CachedMessage>,
}

#[derive(Debug, Deserialize)]
struct UpdateLastSeqPayload {
  session_id: String,
  seq: i64,
}

#[derive(Debug, Deserialize)]
struct UpsertMessagesAndSeqPayload {
  session_id: String,
  messages: Vec<CachedMessage>,
  seq: i64,
}

#[derive(Debug, Deserialize)]
struct CapabilitiesKeyPayload {
  machine_id: String,
  agent_type: String,
}

#[derive(Debug, Deserialize)]
struct KvNamespacePayload {
  namespace: String,
}

#[derive(Debug, Deserialize)]
struct KvSetPayload {
  namespace: String,
  key: String,
  value: String,
}

#[derive(Debug, Deserialize)]
struct KvDeletePayload {
  namespace: String,
  key: String,
}

fn map_rusqlite_error(error: rusqlite::Error) -> String {
  error.to_string()
}

fn apply_migrations(connection: &Connection) -> CommandResult<()> {
  connection
    .execute_batch(SCHEMA_SQL)
    .map_err(map_rusqlite_error)?;
  for migration in MIGRATION_SQL_STATEMENTS {
    if let Err(error) = connection.execute_batch(migration) {
      let message = error.to_string();
      if !message.contains("duplicate column name") {
        return Err(message);
      }
    }
  }
  Ok(())
}

fn open_database_path(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
  let app_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
  fs::create_dir_all(&app_dir).map_err(|error| error.to_string())?;
  Ok(app_dir.join("messageCache.db"))
}

fn init_database(app: &tauri::AppHandle) -> CommandResult<AppDatabase> {
  let db_path = open_database_path(app)?;
  let connection = Connection::open(db_path).map_err(map_rusqlite_error)?;
  connection
    .busy_timeout(std::time::Duration::from_secs(5))
    .map_err(map_rusqlite_error)?;
  apply_migrations(&connection)?;
  Ok(AppDatabase {
    connection: Mutex::new(connection),
  })
}

fn write_messages(
  tx: &Transaction<'_>,
  session_id: &str,
  messages: &[CachedMessage],
) -> CommandResult<()> {
  let mut stmt = tx
    .prepare(
      "INSERT OR REPLACE INTO messages
      (id, session_id, seq, content, trace_id, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .map_err(map_rusqlite_error)?;

  for message in messages {
    stmt.execute(params![
      &message.id,
      session_id,
      message.seq,
      &message.content,
      &message.trace_id,
      &message.role,
      message.created_at,
      message.updated_at,
    ])
    .map_err(map_rusqlite_error)?;
  }

  Ok(())
}

fn with_connection<T, F>(db: &AppDatabase, f: F) -> CommandResult<T>
where
  F: FnOnce(&mut Connection) -> CommandResult<T>,
{
  let mut guard = db
    .connection
    .lock()
    .map_err(|_| String::from("sqlite mutex poisoned"))?;
  f(&mut guard)
}

#[tauri::command]
fn desktop_message_db_init(db: tauri::State<'_, AppDatabase>) -> CommandResult<()> {
  with_connection(&db, |_| Ok(()))
}

#[tauri::command]
fn desktop_message_db_get_messages(
  db: tauri::State<'_, AppDatabase>,
  payload: GetMessagesPayload,
) -> CommandResult<Vec<CachedMessage>> {
  with_connection(&db, |connection| {
    let sql = if payload.before_seq.is_some() {
      "SELECT id, session_id, seq, content, trace_id, role, created_at, updated_at
       FROM messages
       WHERE session_id = ? AND seq < ?
       ORDER BY seq DESC
       LIMIT ?"
    } else {
      "SELECT id, session_id, seq, content, trace_id, role, created_at, updated_at
       FROM messages
       WHERE session_id = ?
       ORDER BY seq ASC
       LIMIT ?"
    };

    let mut stmt = connection.prepare(sql).map_err(map_rusqlite_error)?;
    let rows = if let Some(before_seq) = payload.before_seq {
      let mapped = stmt
        .query_map(params![payload.session_id, before_seq, payload.limit], |row| {
          Ok(CachedMessage {
            id: row.get(0)?,
            session_id: row.get(1)?,
            seq: row.get(2)?,
            content: row.get(3)?,
            trace_id: row.get(4)?,
            role: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
          })
        })
        .map_err(map_rusqlite_error)?;
      mapped
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_rusqlite_error)?
    } else {
      let mapped = stmt
        .query_map(params![payload.session_id, payload.limit], |row| {
          Ok(CachedMessage {
            id: row.get(0)?,
            session_id: row.get(1)?,
            seq: row.get(2)?,
            content: row.get(3)?,
            trace_id: row.get(4)?,
            role: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
          })
        })
        .map_err(map_rusqlite_error)?;
      mapped
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_rusqlite_error)?
    };
    Ok(rows)
  })
}

#[tauri::command]
fn desktop_message_db_get_last_seq(
  db: tauri::State<'_, AppDatabase>,
  payload: SessionIdPayload,
) -> CommandResult<i64> {
  with_connection(&db, |connection| {
    let row = connection
      .query_row(
        "SELECT last_seq FROM session_sync WHERE session_id = ?",
        params![payload.session_id],
        |row| row.get::<_, i64>(0),
      )
      .optional()
      .map_err(map_rusqlite_error)?;
    Ok(row.unwrap_or(0))
  })
}

#[tauri::command]
fn desktop_message_db_upsert_messages(
  db: tauri::State<'_, AppDatabase>,
  payload: UpsertMessagesPayload,
) -> CommandResult<()> {
  with_connection(&db, |connection| {
    let tx = connection.unchecked_transaction().map_err(map_rusqlite_error)?;
    write_messages(&tx, &payload.session_id, &payload.messages)?;
    tx.commit().map_err(map_rusqlite_error)
  })
}

#[tauri::command]
fn desktop_message_db_update_last_seq(
  db: tauri::State<'_, AppDatabase>,
  payload: UpdateLastSeqPayload,
) -> CommandResult<()> {
  with_connection(&db, |connection| {
    connection
      .execute(
        "INSERT OR REPLACE INTO session_sync (session_id, last_seq, synced_at) VALUES (?, ?, ?)",
        params![payload.session_id, payload.seq, js_now_ms()],
      )
      .map_err(map_rusqlite_error)?;
    Ok(())
  })
}

#[tauri::command]
fn desktop_message_db_upsert_messages_and_seq(
  db: tauri::State<'_, AppDatabase>,
  payload: UpsertMessagesAndSeqPayload,
) -> CommandResult<()> {
  with_connection(&db, |connection| {
    let tx = connection.unchecked_transaction().map_err(map_rusqlite_error)?;
    write_messages(&tx, &payload.session_id, &payload.messages)?;
    tx.execute(
      "INSERT OR REPLACE INTO session_sync (session_id, last_seq, synced_at) VALUES (?, ?, ?)",
      params![payload.session_id, payload.seq, js_now_ms()],
    )
    .map_err(map_rusqlite_error)?;
    tx.commit().map_err(map_rusqlite_error)
  })
}

#[tauri::command]
fn desktop_message_db_delete_session(
  db: tauri::State<'_, AppDatabase>,
  payload: SessionIdPayload,
) -> CommandResult<()> {
  with_connection(&db, |connection| {
    let tx = connection.unchecked_transaction().map_err(map_rusqlite_error)?;
    tx.execute(
      "DELETE FROM messages WHERE session_id = ?",
      params![payload.session_id],
    )
    .map_err(map_rusqlite_error)?;
    tx.execute(
      "DELETE FROM session_sync WHERE session_id = ?",
      params![payload.session_id],
    )
    .map_err(map_rusqlite_error)?;
    tx.commit().map_err(map_rusqlite_error)
  })
}

#[tauri::command]
fn desktop_message_db_delete_all(db: tauri::State<'_, AppDatabase>) -> CommandResult<()> {
  with_connection(&db, |connection| {
    connection
      .execute_batch(
        "DELETE FROM messages;
         DELETE FROM session_sync;
         DELETE FROM capabilities_cache;
         DELETE FROM kv_store WHERE namespace = 'main';",
      )
      .map_err(map_rusqlite_error)?;
    Ok(())
  })
}

#[tauri::command]
fn desktop_message_db_get_capabilities(
  db: tauri::State<'_, AppDatabase>,
  payload: CapabilitiesKeyPayload,
) -> CommandResult<Option<CachedCapabilitiesRow>> {
  with_connection(&db, |connection| {
    connection
      .query_row(
        "SELECT machine_id, agent_type, capabilities, updated_at, kv_version
         FROM capabilities_cache
         WHERE machine_id = ? AND agent_type = ?",
        params![payload.machine_id, payload.agent_type],
        |row| {
          Ok(CachedCapabilitiesRow {
            machine_id: row.get(0)?,
            agent_type: row.get(1)?,
            capabilities: row.get(2)?,
            updated_at: row.get(3)?,
            kv_version: row.get(4)?,
          })
        },
      )
      .optional()
      .map_err(map_rusqlite_error)
  })
}

#[tauri::command]
fn desktop_message_db_upsert_capabilities(
  db: tauri::State<'_, AppDatabase>,
  payload: CachedCapabilitiesRow,
) -> CommandResult<()> {
  with_connection(&db, |connection| {
    connection
      .execute(
        "INSERT OR REPLACE INTO capabilities_cache
         (machine_id, agent_type, capabilities, updated_at, kv_version)
         VALUES (?, ?, ?, ?, ?)",
        params![
          payload.machine_id,
          payload.agent_type,
          payload.capabilities,
          payload.updated_at,
          payload.kv_version,
        ],
      )
      .map_err(map_rusqlite_error)?;
    Ok(())
  })
}

#[tauri::command]
fn desktop_message_db_kv_get_all(
  db: tauri::State<'_, AppDatabase>,
  payload: KvNamespacePayload,
) -> CommandResult<Vec<KvEntry>> {
  with_connection(&db, |connection| {
    let mut stmt = connection
      .prepare("SELECT key, value FROM kv_store WHERE namespace = ?")
      .map_err(map_rusqlite_error)?;
    let mapped = stmt
      .query_map(params![payload.namespace], |row| {
        Ok(KvEntry {
          key: row.get(0)?,
          value: row.get(1)?,
        })
      })
      .map_err(map_rusqlite_error)?;
    mapped
      .collect::<Result<Vec<_>, _>>()
      .map_err(map_rusqlite_error)
  })
}

#[tauri::command]
fn desktop_message_db_kv_set(
  db: tauri::State<'_, AppDatabase>,
  payload: KvSetPayload,
) -> CommandResult<()> {
  with_connection(&db, |connection| {
    connection
      .execute(
        "INSERT OR REPLACE INTO kv_store (namespace, key, value) VALUES (?, ?, ?)",
        params![payload.namespace, payload.key, payload.value],
      )
      .map_err(map_rusqlite_error)?;
    Ok(())
  })
}

#[tauri::command]
fn desktop_message_db_kv_delete(
  db: tauri::State<'_, AppDatabase>,
  payload: KvDeletePayload,
) -> CommandResult<()> {
  with_connection(&db, |connection| {
    connection
      .execute(
        "DELETE FROM kv_store WHERE namespace = ? AND key = ?",
        params![payload.namespace, payload.key],
      )
      .map_err(map_rusqlite_error)?;
    Ok(())
  })
}

#[tauri::command]
fn desktop_message_db_kv_delete_all(
  db: tauri::State<'_, AppDatabase>,
  payload: KvNamespacePayload,
) -> CommandResult<()> {
  with_connection(&db, |connection| {
    connection
      .execute(
        "DELETE FROM kv_store WHERE namespace = ?",
        params![payload.namespace],
      )
      .map_err(map_rusqlite_error)?;
    Ok(())
  })
}

#[tauri::command]
fn desktop_open_devtools(app: tauri::AppHandle) -> CommandResult<()> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| String::from("main window not found"))?;
  window.open_devtools();
  window.set_focus().map_err(|error| error.to_string())?;
  Ok(())
}

fn js_now_ms() -> i64 {
  let now = std::time::SystemTime::now();
  now.duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis() as i64
}

fn updater_enabled() -> bool {
  option_env!("TAURI_UPDATER_PUBLIC_KEY")
    .map(|value| !value.trim().is_empty())
    .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_process::init());

  if updater_enabled() {
    builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
  }

  builder
    .setup(|app| {
      let database =
        init_database(&app.handle()).map_err(|error| io::Error::other(error.to_string()))?;
      app.manage(database);

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      desktop_message_db_init,
      desktop_message_db_get_messages,
      desktop_message_db_get_last_seq,
      desktop_message_db_upsert_messages,
      desktop_message_db_update_last_seq,
      desktop_message_db_upsert_messages_and_seq,
      desktop_message_db_delete_session,
      desktop_message_db_delete_all,
      desktop_message_db_get_capabilities,
      desktop_message_db_upsert_capabilities,
      desktop_message_db_kv_get_all,
      desktop_message_db_kv_set,
      desktop_message_db_kv_delete,
      desktop_message_db_kv_delete_all,
      desktop_open_devtools
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
