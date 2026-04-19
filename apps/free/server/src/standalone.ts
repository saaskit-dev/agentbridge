import 'reflect-metadata';

// Patch crypto.subtle.importKey to normalize base64 → base64url in JWK data.
// privacy-kit uses standard base64 for Ed25519 JWK keys, but Bun (correctly per spec)
// requires base64url. Node.js is lenient about this, Bun is not.
const origImportKey = crypto.subtle.importKey.bind(crypto.subtle);
crypto.subtle.importKey = function (
  format: any,
  keyData: any,
  algorithm: any,
  extractable: any,
  keyUsages: any
) {
  if (format === 'jwk' && keyData && typeof keyData === 'object') {
    const fixed = { ...keyData };
    for (const field of ['d', 'x', 'y', 'n', 'e', 'p', 'q', 'dp', 'dq', 'qi', 'k']) {
      if (typeof fixed[field] === 'string') {
        fixed[field] = fixed[field].replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
    }
    return origImportKey(format, fixed, algorithm, extractable, keyUsages);
  }
  return origImportKey(format, keyData, algorithm, extractable, keyUsages);
} as any;

import * as fs from 'fs';
import { homedir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createPGlite } from './storage/pgliteLoader';
import { sortMigrationDirs } from './utils/sortMigrationDirs';

// ES module compatible __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataDir = process.env.DATA_DIR || './data';
const pgliteDir = process.env.PGLITE_DIR || path.join(dataDir, 'pglite');
const pgliteDatabase = process.env.PGLITE_DATABASE || 'template1';
const lockFile = path.join(dataDir, '.server.lock');

/**
 * Check if running in a container environment (Docker, etc.)
 */
function isContainerEnvironment(): boolean {
  // PID 1 usually means we're the main process in a container
  if (process.pid !== 1) return false;

  // Check for Docker environment indicators
  if (fs.existsSync('/.dockerenv')) return true;

  // Check cgroup for container indicators
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf-8');
    if (cgroup.includes('docker') || cgroup.includes('containerd')) return true;
  } catch {
    // Ignore if file doesn't exist
  }

  return false;
}

/**
 * Acquire lock to prevent concurrent server instances (only in non-container environments)
 */
function acquireLock(): boolean {
  // Skip lock in container environments - container itself provides isolation
  if (isContainerEnvironment()) {
    return true;
  }

  fs.mkdirSync(dataDir, { recursive: true });

  // Check if lock file exists and process is still running
  if (fs.existsSync(lockFile)) {
    try {
      const pid = parseInt(fs.readFileSync(lockFile, 'utf-8').trim(), 10);
      // Check if process is alive
      process.kill(pid, 0);
      console.error(`Server already running (PID: ${pid})`);
      console.error(`If this is incorrect, delete ${lockFile}`);
      return false;
    } catch {
      // Process is dead, remove stale lock
      fs.unlinkSync(lockFile);
    }
  }

  // Create lock file
  fs.writeFileSync(lockFile, `${process.pid}`);
  return true;
}

/**
 * Release lock on shutdown
 */
function releaseLock(): void {
  // Skip in container environments
  if (isContainerEnvironment()) return;

  try {
    const currentPid = parseInt(fs.readFileSync(lockFile, 'utf-8').trim(), 10);
    if (currentPid === process.pid) {
      fs.unlinkSync(lockFile);
    }
  } catch {
    // Ignore errors
  }
}

async function migrate() {
  console.log(`Migrating database in ${pgliteDir}...`);
  console.log(`Using PGlite database ${pgliteDatabase}...`);
  fs.mkdirSync(pgliteDir, { recursive: true });

  const pg = createPGlite(pgliteDir);

  // Create migrations tracking table
  await pg.exec(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
            "id" TEXT PRIMARY KEY,
            "migration_name" TEXT NOT NULL UNIQUE,
            "finished_at" TIMESTAMPTZ,
            "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
            "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
            "logs" TEXT
        );
    `);

  // Find migrations directory - try multiple locations
  let migrationsDirResolved = '';
  const candidates = [
    path.join(process.cwd(), 'prisma', 'migrations'),
    path.join(process.cwd(), 'apps/free/server/prisma', 'migrations'),
    path.join(__dirname, '..', 'prisma', 'migrations'),
    path.join(path.dirname(process.execPath), 'prisma', 'migrations'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      migrationsDirResolved = candidate;
      break;
    }
  }
  if (!migrationsDirResolved) {
    console.error('Could not find prisma/migrations directory');
    process.exit(1);
  }

  // Get all migration directories sorted
  const dirs = sortMigrationDirs(
    fs
      .readdirSync(migrationsDirResolved)
      .filter(d => fs.statSync(path.join(migrationsDirResolved, d)).isDirectory())
  );

  // Get already applied migrations
  const applied = await pg.query<{ migration_name: string }>(
    `SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`
  );
  const appliedSet = new Set(applied.rows.map(r => r.migration_name));

  let appliedCount = 0;
  for (const dir of dirs) {
    if (appliedSet.has(dir)) {
      continue;
    }

    const sqlFile = path.join(migrationsDirResolved, dir, 'migration.sql');
    if (!fs.existsSync(sqlFile)) {
      continue;
    }

    console.log(`  Applying ${dir}...`);
    const sql = fs.readFileSync(sqlFile, 'utf-8');

    try {
      await pg.exec(sql);
      await pg.query(
        `INSERT INTO "_prisma_migrations" ("id", "migration_name", "finished_at", "applied_steps_count") VALUES ($1, $2, now(), 1)`,
        [crypto.randomUUID(), dir]
      );
      appliedCount++;
    } catch (e: any) {
      console.error(`  Failed to apply ${dir}: ${e.message}`);
      process.exit(1);
    }
  }

  if (appliedCount === 0) {
    console.log('No new migrations to apply.');
  } else {
    console.log(`Applied ${appliedCount} migration(s).`);
  }

  await pg.close();
}

/**
 * Ensure FREE_MASTER_SECRET is set. If not provided, auto-generate and persist
 * to DATA_DIR/.master-secret so it survives restarts.
 */
function ensureMasterSecret(): void {
  if (process.env.FREE_MASTER_SECRET) return;

  const secretFile = path.join(dataDir, '.master-secret');
  fs.mkdirSync(dataDir, { recursive: true });

  // Try to read a previously generated secret
  if (fs.existsSync(secretFile)) {
    process.env.FREE_MASTER_SECRET = fs.readFileSync(secretFile, 'utf-8').trim();
    console.log(`Using auto-generated master secret from ${secretFile}`);
    return;
  }

  // Generate a new secret and persist it
  const secret = crypto.randomUUID() + crypto.randomUUID();
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  process.env.FREE_MASTER_SECRET = secret;
  console.log(`Generated master secret and saved to ${secretFile}`);
  console.log('To use your own secret, set FREE_MASTER_SECRET environment variable.');
}

/**
 * Validate that APP_URL is set when GitHub OAuth is configured.
 */
function validateConfig(): void {
  const hasGithubOAuth = process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET;
  if (hasGithubOAuth && !process.env.APP_URL) {
    console.error('ERROR: GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET are set but APP_URL is missing.');
    console.error('APP_URL is required for GitHub OAuth callback redirects.');
    console.error('Example: APP_URL=https://your-app-domain.com');
    process.exit(1);
  }
}

async function serve() {
  // Acquire lock to prevent concurrent instances (skipped in containers)
  if (!acquireLock()) {
    process.exit(1);
  }

  // Release lock when process exits (fires on any exit path, synchronous)
  process.on('exit', releaseLock);
  // NOTE: Do NOT handle SIGINT/SIGTERM here — main.ts registers shutdown
  // handlers (closePGlite, etc.) that must run before exit. Calling
  // process.exit() here would skip those handlers and corrupt PGlite data.

  // Auto-generate master secret if not provided
  ensureMasterSecret();

  // Validate configuration
  validateConfig();

  // Set PGLITE_DIR so db.ts picks it up
  if (!process.env.DATABASE_URL) {
    process.env.PGLITE_DIR = process.env.PGLITE_DIR || pgliteDir;
  }

  // Auto-run migrations if needed
  await runMigrationsIfNeeded();

  // Import and run the main server
  await import('./main');
}

/**
 * Check and run migrations automatically if database is empty or outdated
 */
async function runMigrationsIfNeeded(): Promise<void> {
  fs.mkdirSync(pgliteDir, { recursive: true });

  const pg = createPGlite(pgliteDir);

  try {
    // Check if migrations table exists and has records
    let appliedCount = 0;
    try {
      const result = await pg.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`
      );
      appliedCount = parseInt(result.rows[0]?.count || '0', 10);
    } catch {
      // Table doesn't exist, need to migrate
    }

    // Find migrations directory
    let migrationsDir = '';
    const candidates = [
      path.join(process.cwd(), 'prisma', 'migrations'),
      path.join(process.cwd(), 'apps/free/server/prisma', 'migrations'),
      path.join(__dirname, '..', 'prisma', 'migrations'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        migrationsDir = candidate;
        break;
      }
    }

    if (!migrationsDir) {
      console.log('No migrations directory found, skipping auto-migration');
      await pg.close();
      return;
    }

    // Count available migrations
    const dirs = sortMigrationDirs(
      fs
        .readdirSync(migrationsDir)
        .filter(d => fs.statSync(path.join(migrationsDir, d)).isDirectory())
    );

    if (dirs.length === 0) {
      await pg.close();
      return;
    }

    // Auto-migrate if needed
    if (appliedCount < dirs.length) {
      console.log(`Auto-migrating database (${appliedCount}/${dirs.length} migrations applied)...`);

      // Create migrations table if not exists
      await pg.exec(`
                CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
                    "id" TEXT PRIMARY KEY,
                    "migration_name" TEXT NOT NULL UNIQUE,
                    "finished_at" TIMESTAMPTZ,
                    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
                    "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
                    "logs" TEXT
                );
            `);

      // Get already applied migrations
      const applied = await pg.query<{ migration_name: string }>(
        `SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`
      );
      const appliedSet = new Set(applied.rows.map(r => r.migration_name));

      let newMigrations = 0;
      for (const dir of dirs) {
        if (appliedSet.has(dir)) continue;

        const sqlFile = path.join(migrationsDir, dir, 'migration.sql');
        if (!fs.existsSync(sqlFile)) continue;

        console.log(`  Applying ${dir}...`);
        const sql = fs.readFileSync(sqlFile, 'utf-8');

        try {
          await pg.exec(sql);
          await pg.query(
            `INSERT INTO "_prisma_migrations" ("id", "migration_name", "finished_at", "applied_steps_count") VALUES ($1, $2, now(), 1)`,
            [crypto.randomUUID(), dir]
          );
          newMigrations++;
        } catch (e: any) {
          console.error(`  Failed to apply ${dir}: ${e.message}`);
          throw e;
        }
      }

      console.log(`Applied ${newMigrations} new migration(s).`);
    }
  } finally {
    await pg.close();
  }
}

/**
 * Reset all data - clears database and removes all user data
 */
async function reset() {
  console.log('⚠️  WARNING: This will delete ALL data!');
  console.log(`   Database: ${pgliteDir}`);
  console.log(`   Data dir: ${dataDir}`);

  // Confirm if running interactively
  if (process.stdin.isTTY) {
    console.log('\nPress Ctrl+C to cancel, or wait 3 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 3001));
  }

  // Close any existing connections by removing lock
  releaseLock();

  // Delete PGlite database
  if (fs.existsSync(pgliteDir)) {
    console.log(`Deleting ${pgliteDir}...`);
    fs.rmSync(pgliteDir, { recursive: true, force: true });
  }

  // Delete lock file
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
  }

  // Delete any other files in data dir (except the dir itself)
  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir);
    for (const file of files) {
      const filePath = path.join(dataDir, file);
      if (fs.statSync(filePath).isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(filePath);
      }
    }
  }

  console.log('✅ All data has been reset!');
  console.log("Run 'free-server serve' to start fresh.");
}

/**
 * RFC §17.11 Option B: Developer trace query tool.
 * Reads server JSONL log files and filters by traceId / sessionId / level / since.
 */
async function logsCommand(argv: string[]): Promise<void> {
  let traceId: string | undefined;
  let sessionId: string | undefined;
  let level: string | undefined;
  let since: Date | undefined;
  let outputFormat: 'pretty' | 'jsonl' = 'pretty';

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--trace':
        traceId = argv[++i];
        break;
      case '--session':
        sessionId = argv[++i];
        break;
      case '--level':
        level = argv[++i];
        break;
      case '--since': {
        const raw = argv[++i];
        const m = raw?.match(/^(\d+)(m|h|d)$/);
        if (m) {
          const [, n, unit] = m;
          const ms = parseInt(n) * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
          since = new Date(Date.now() - ms);
        } else {
          since = new Date(raw);
        }
        break;
      }
      case '--jsonl':
        outputFormat = 'jsonl';
        break;
    }
  }

  if (!traceId && !sessionId && !level && !since) {
    console.error(
      'Provide at least one filter: --trace <id>, --session <id>, --level <lvl>, --since <Nm/h/d>'
    );
    process.exit(1);
  }

  const homeDir = process.env.FREE_HOME_DIR
    ? process.env.FREE_HOME_DIR.replace(/^~/, require('os').homedir())
    : path.join(require('os').homedir(), '.free');
  const logsDir = path.join(homeDir, 'logs');

  let files: string[] = [];
  try {
    files = fs
      .readdirSync(logsDir)
      .filter(f => f.startsWith('server-') && f.endsWith('.jsonl'))
      .map(f => path.join(logsDir, f))
      .sort();
  } catch {
    console.error(`No log files found in ${logsDir}`);
    process.exit(0);
  }

  const LEVEL_ORDER: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  let matchCount = 0;

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (traceId && entry.traceId !== traceId) continue;
      if (sessionId && entry.sessionId !== sessionId) continue;
      if (level && (LEVEL_ORDER[entry.level] ?? -1) < (LEVEL_ORDER[level] ?? 0)) continue;
      if (since && new Date(entry.timestamp) < since) continue;

      matchCount++;
      if (outputFormat === 'jsonl') {
        console.log(line);
      } else {
        const ts = new Date(entry.timestamp).toISOString().substring(11, 23);
        const traceStr = entry.traceId ? ` [${entry.traceId.slice(0, 8)}]` : '';
        const lvl = (entry.level ?? 'info').toUpperCase().padEnd(5);
        console.log(`[${ts}] ${lvl} [${entry.component ?? ''}]${traceStr} ${entry.message}`);
      }
    }
  }

  if (matchCount === 0) {
    console.log('No matching log entries found.');
  } else {
    console.error(`\n(${matchCount} entries matched)`);
  }
}

// CLI
const command = process.argv[2];

switch (command) {
  case 'migrate':
    migrate().catch(e => {
      console.error(e);
      process.exit(1);
    });
    break;
  case 'serve':
    serve().catch(e => {
      console.error(e);
      process.exit(1);
    });
    break;
  case 'reset':
    reset().catch(e => {
      console.error(e);
      process.exit(1);
    });
    break;
  case 'logs':
    logsCommand(process.argv.slice(3)).catch(e => {
      console.error(e);
      process.exit(1);
    });
    break;
  case undefined:
  case '--help':
  case '-h':
    console.log(`free-server - portable distribution

Usage:
  free-server migrate    Apply database migrations
  free-server serve      Start the server
  free-server reset      Delete all data and reset to fresh state
  free-server logs       Query server log files (RFC §17.11 Option B)
    --trace <id>         Filter by trace ID
    --session <id>       Filter by session ID
    --level <lvl>        Minimum log level (debug|info|warn|error)
    --since <Nm|Nh|Nd>   Time range (e.g. 1h, 30m, 7d)
    --jsonl              Output raw JSONL instead of pretty format

Environment variables:
  DATA_DIR             Base data directory (default: ./data)
  PGLITE_DIR           PGlite database directory (default: DATA_DIR/pglite)
  PGLITE_DATABASE      PGlite database name (default: template1)
  DATABASE_URL         PostgreSQL URL (if set, uses external Postgres instead of PGlite)
  PORT                 Server port (default: 3000)
  FREE_MASTER_SECRET   Master secret for auth/encryption (auto-generated if not set)
  APP_URL              Your app URL (required when GitHub OAuth is configured)
`);
    process.exit(0);
  default:
    console.error(`Unknown command: ${command}`);
    console.error(`Run with --help for usage`);
    process.exit(1);
}
