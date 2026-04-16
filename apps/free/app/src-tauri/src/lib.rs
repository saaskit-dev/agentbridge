use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine as _;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::{fs, io, path::PathBuf, process::Command, sync::Mutex, thread, time::Duration};
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCliInstallIssue {
  code: String,
  message: String,
  can_auto_fix: bool,
  suggested_action: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCliStatus {
  installed: bool,
  path: Option<String>,
  version: Option<String>,
  has_credentials: bool,
  daemon_state_exists: bool,
  daemon_running: bool,
  curl_path: Option<String>,
  bash_path: Option<String>,
  git_path: Option<String>,
  node_path: Option<String>,
  node_version: Option<String>,
  brew_path: Option<String>,
  install_issues: Vec<DesktopCliInstallIssue>,
  can_auto_repair: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCliBootstrapPayload {
  token: String,
  secret: String,
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

fn free_home_dir() -> CommandResult<PathBuf> {
  let home = std::env::var("HOME").map_err(|_| String::from("HOME is not set"))?;
  Ok(PathBuf::from(home).join(".free"))
}

fn run_shell(command: &str) -> CommandResult<std::process::Output> {
  Command::new("/bin/sh")
    .arg("-lc")
    .arg(command)
    .output()
    .map_err(|error| error.to_string())
}

fn command_path(name: &str) -> CommandResult<Option<String>> {
  let output = run_shell(&format!("command -v {}", name))?;
  if !output.status.success() {
    return Ok(None);
  }

  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  if stdout.is_empty() {
    Ok(None)
  } else {
    Ok(Some(stdout))
  }
}

fn parse_cli_version(raw: &str) -> Option<String> {
  for line in raw.lines() {
    if let Some(rest) = line.strip_prefix("free version:") {
      return rest.split_whitespace().next().map(|value| value.trim().to_string());
    }
  }

  for token in raw.split_whitespace() {
    let trimmed = token.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-');
    let mut parts = trimmed.split('.');
    let is_semver_like = parts.by_ref().take(3).all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
      && trimmed.matches('.').count() >= 2;
    if is_semver_like {
      return Some(trimmed.to_string());
    }
  }

  None
}

fn read_command_version(command: &str) -> CommandResult<Option<String>> {
  let output = run_shell(&format!("{} --version", command))?;
  if !output.status.success() {
    return Ok(None);
  }

  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  if stdout.is_empty() {
    Ok(None)
  } else {
    Ok(Some(stdout))
  }
}

fn parse_node_major(raw: &str) -> Option<u32> {
  let version = raw
    .lines()
    .next()
    .map(str::trim)
    .unwrap_or_default()
    .trim_start_matches('v');
  version.split('.').next()?.parse::<u32>().ok()
}

fn build_install_issues(
  brew_path: &Option<String>,
  bash_path: &Option<String>,
  curl_path: &Option<String>,
  git_path: &Option<String>,
  node_path: &Option<String>,
  node_version: &Option<String>,
) -> Vec<DesktopCliInstallIssue> {
  let brew_available = brew_path.is_some();
  let mut issues = Vec::new();

  if bash_path.is_none() {
    issues.push(DesktopCliInstallIssue {
      code: String::from("missing_bash"),
      message: String::from("bash is missing. Free CLI installer requires bash."),
      can_auto_fix: false,
      suggested_action: Some(String::from("Install bash manually, then retry.")),
    });
  }

  if curl_path.is_none() {
    issues.push(DesktopCliInstallIssue {
      code: String::from("missing_curl"),
      message: String::from("curl is missing. Free CLI installs through install.sh, so curl is required."),
      can_auto_fix: brew_available,
      suggested_action: Some(if brew_available {
        String::from("Homebrew can install curl automatically.")
      } else {
        String::from("Install curl manually, then retry.")
      }),
    });
  }

  if git_path.is_none() {
    issues.push(DesktopCliInstallIssue {
      code: String::from("missing_git"),
      message: String::from("git is missing. The official installer clones the repository before building."),
      can_auto_fix: brew_available,
      suggested_action: Some(if brew_available {
        String::from("Homebrew can install git automatically.")
      } else {
        String::from("Install git or Xcode Command Line Tools, then retry.")
      }),
    });
  }

  if node_path.is_none() {
    issues.push(DesktopCliInstallIssue {
      code: String::from("missing_node"),
      message: String::from("Node.js is missing. Free CLI requires Node.js 20 or newer."),
      can_auto_fix: brew_available,
      suggested_action: Some(if brew_available {
        String::from("Homebrew can install Node.js automatically.")
      } else {
        String::from("Install Node.js 20 or newer, then retry.")
      }),
    });
  } else if let Some(version) = node_version {
    if parse_node_major(version).map(|major| major < 20).unwrap_or(true) {
      issues.push(DesktopCliInstallIssue {
        code: String::from("node_too_old"),
        message: format!(
          "Node.js {} is installed, but Free CLI requires Node.js 20 or newer.",
          version.lines().next().unwrap_or(version)
        ),
        can_auto_fix: brew_available,
        suggested_action: Some(if brew_available {
          String::from("Homebrew can upgrade Node.js automatically.")
        } else {
          String::from("Upgrade Node.js to 20 or newer, then retry.")
        }),
      });
    }
  }

  issues
}

fn read_cli_status() -> CommandResult<DesktopCliStatus> {
  let free_home = free_home_dir()?;
  let credentials_path = free_home.join("access.key");
  let daemon_state_path = free_home.join("daemon.state.json");
  let free_path = command_path("free")?;
  let brew_path = command_path("brew")?;
  let curl_path = command_path("curl")?;
  let bash_path = command_path("bash")?;
  let git_path = command_path("git")?;
  let node_path = command_path("node")?;
  let node_version = if node_path.is_some() {
    read_command_version("node")?
  } else {
    None
  };
  let install_issues = build_install_issues(
    &brew_path,
    &bash_path,
    &curl_path,
    &git_path,
    &node_path,
    &node_version,
  );

  let version = if free_path.is_some() {
    let output = run_shell("free --version")?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    parse_cli_version(&stdout).or_else(|| parse_cli_version(&stderr))
  } else {
    None
  };

  Ok(DesktopCliStatus {
    installed: free_path.is_some(),
    path: free_path,
    version,
    has_credentials: credentials_path.exists(),
    daemon_state_exists: daemon_state_path.exists(),
    daemon_running: read_daemon_running(&daemon_state_path),
    curl_path,
    bash_path,
    git_path,
    node_path,
    node_version,
    brew_path,
    can_auto_repair: install_issues.iter().all(|issue| issue.can_auto_fix),
    install_issues,
  })
}

fn decode_secret_to_standard_base64(secret: &str) -> CommandResult<String> {
  for decoded in [
    URL_SAFE_NO_PAD.decode(secret),
    URL_SAFE.decode(secret),
    STANDARD.decode(secret),
    STANDARD_NO_PAD.decode(secret),
  ] {
    if let Ok(bytes) = decoded {
      return Ok(STANDARD.encode(bytes));
    }
  }

  Err(String::from("Invalid secret format"))
}

fn is_process_alive(pid: i64) -> bool {
  if pid <= 0 {
    return false;
  }

  let result = unsafe { libc::kill(pid as i32, 0) };
  if result == 0 {
    return true;
  }

  let errno = io::Error::last_os_error().raw_os_error().unwrap_or_default();
  errno == libc::EPERM
}

fn read_daemon_running(daemon_state_path: &PathBuf) -> bool {
  if !daemon_state_path.exists() {
    return false;
  }

  let content = match fs::read_to_string(daemon_state_path) {
    Ok(value) => value,
    Err(_) => return false,
  };
  let parsed: serde_json::Value = match serde_json::from_str(&content) {
    Ok(value) => value,
    Err(_) => return false,
  };
  let pid = parsed.get("pid").and_then(|value| value.as_i64()).unwrap_or_default();
  is_process_alive(pid)
}

fn set_owner_only_permissions(path: &PathBuf, mode: u32) -> CommandResult<()> {
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let permissions = fs::Permissions::from_mode(mode);
    fs::set_permissions(path, permissions).map_err(|error| error.to_string())?;
  }

  Ok(())
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
  option_env!("DESKTOP_UPDATER_ENABLED") == Some("1")
}

#[tauri::command]
fn desktop_is_updater_enabled() -> bool {
  updater_enabled()
}

#[tauri::command]
fn desktop_get_cli_status() -> CommandResult<DesktopCliStatus> {
  read_cli_status()
}

#[tauri::command]
fn desktop_install_cli() -> CommandResult<DesktopCliStatus> {
  let status = read_cli_status()?;
  if !status.install_issues.is_empty() {
    let details = status
      .install_issues
      .iter()
      .map(|issue| issue.message.clone())
      .collect::<Vec<_>>()
      .join(" ");
    return Err(format!("Cannot install Free CLI yet. {}", details));
  }

  let output = run_shell(
    "set -euo pipefail; tmp=\"$(mktemp -t free-install.XXXXXX.sh)\"; trap 'rm -f \"$tmp\"' EXIT; curl -fsSL https://raw.githubusercontent.com/saaskit-dev/agentbridge/main/install.sh -o \"$tmp\"; bash \"$tmp\"",
  )?;
  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    return Err(if detail.is_empty() {
      String::from("Failed to install Free CLI")
    } else {
      detail
    });
  }

  read_cli_status()
}

#[tauri::command]
fn desktop_repair_cli_environment() -> CommandResult<DesktopCliStatus> {
  let status = read_cli_status()?;
  if status.install_issues.is_empty() {
    return Ok(status);
  }

  if status.brew_path.is_none() {
    let details = status
      .install_issues
      .iter()
      .map(|issue| issue.message.clone())
      .collect::<Vec<_>>()
      .join(" ");
    return Err(format!(
      "Automatic repair is unavailable because Homebrew is not installed. {}",
      details
    ));
  }

  let mut packages = Vec::new();
  for issue in &status.install_issues {
    match issue.code.as_str() {
      "missing_curl" => packages.push("curl"),
      "missing_git" => packages.push("git"),
      "missing_node" | "node_too_old" => packages.push("node"),
      _ => {}
    }
  }
  packages.sort();
  packages.dedup();

  if packages.is_empty() {
    let details = status
      .install_issues
      .iter()
      .map(|issue| issue.message.clone())
      .collect::<Vec<_>>()
      .join(" ");
    return Err(format!("Detected issues cannot be auto-fixed safely. {}", details));
  }

  let install_command = format!(
    "HOMEBREW_NO_AUTO_UPDATE=1 brew install {}",
    packages.join(" ")
  );
  let output = run_shell(&install_command)?;
  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    return Err(if detail.is_empty() {
      String::from("Automatic environment repair failed")
    } else {
      detail
    });
  }

  read_cli_status()
}

#[tauri::command]
fn desktop_bootstrap_cli_auth(
  payload: DesktopCliBootstrapPayload,
) -> CommandResult<DesktopCliStatus> {
  let status = read_cli_status()?;
  if !status.installed {
    return Err(String::from("Free CLI is not installed"));
  }

  let free_home = free_home_dir()?;
  fs::create_dir_all(&free_home).map_err(|error| error.to_string())?;
  set_owner_only_permissions(&free_home, 0o700)?;

  let access_key_path = free_home.join("access.key");
  let secret_base64 = decode_secret_to_standard_base64(&payload.secret)?;
  let credentials = serde_json::json!({
    "token": payload.token,
    "secret": secret_base64,
  });
  fs::write(
    &access_key_path,
    serde_json::to_vec_pretty(&credentials).map_err(|error| error.to_string())?,
  )
  .map_err(|error| error.to_string())?;
  set_owner_only_permissions(&access_key_path, 0o600)?;

  let daemon_output = run_shell("nohup free daemon start-sync >/dev/null 2>&1 &")?;
  if !daemon_output.status.success() {
    let stderr = String::from_utf8_lossy(&daemon_output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      String::from("Failed to start Free daemon")
    } else {
      stderr
    });
  }

  for _ in 0..30 {
    let refreshed = read_cli_status()?;
    if refreshed.daemon_running {
      return Ok(refreshed);
    }
    thread::sleep(Duration::from_millis(500));
  }

  Err(String::from(
    "CLI credentials were written, but the daemon did not become ready. Create/login to your account if needed, then run `free daemon status` to diagnose.",
  ))
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
      desktop_open_devtools,
      desktop_is_updater_enabled,
      desktop_get_cli_status,
      desktop_repair_cli_environment,
      desktop_install_cli,
      desktop_bootstrap_cli_auth
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
