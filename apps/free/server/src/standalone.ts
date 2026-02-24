import "reflect-metadata";

// Patch crypto.subtle.importKey to normalize base64 → base64url in JWK data.
// privacy-kit uses standard base64 for Ed25519 JWK keys, but Bun (correctly per spec)
// requires base64url. Node.js is lenient about this, Bun is not.
const origImportKey = crypto.subtle.importKey.bind(crypto.subtle);
crypto.subtle.importKey = function (format: any, keyData: any, algorithm: any, extractable: any, keyUsages: any) {
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

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createPGlite } from "./storage/pgliteLoader";

// ES module compatible __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataDir = process.env.DATA_DIR || "./data";
const pgliteDir = process.env.PGLITE_DIR || path.join(dataDir, "pglite");
const lockFile = path.join(dataDir, ".server.lock");

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
    let migrationsDirResolved = "";
    const candidates = [
        path.join(process.cwd(), "prisma", "migrations"),
        path.join(process.cwd(), "apps/free/server/prisma", "migrations"),
        path.join(__dirname, "..", "prisma", "migrations"),
        path.join(path.dirname(process.execPath), "prisma", "migrations"),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            migrationsDirResolved = candidate;
            break;
        }
    }
    if (!migrationsDirResolved) {
        console.error("Could not find prisma/migrations directory");
        process.exit(1);
    }

    // Get all migration directories sorted
    const dirs = fs.readdirSync(migrationsDirResolved)
        .filter(d => fs.statSync(path.join(migrationsDirResolved, d)).isDirectory())
        .sort();

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

        const sqlFile = path.join(migrationsDirResolved, dir, "migration.sql");
        if (!fs.existsSync(sqlFile)) {
            continue;
        }

        console.log(`  Applying ${dir}...`);
        const sql = fs.readFileSync(sqlFile, "utf-8");

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
        console.log("No new migrations to apply.");
    } else {
        console.log(`Applied ${appliedCount} migration(s).`);
    }

    await pg.close();
}

async function serve() {
    // Acquire lock to prevent concurrent instances (skipped in containers)
    if (!acquireLock()) {
        process.exit(1);
    }

    // Setup lock release on exit
    process.on('exit', releaseLock);
    process.on('SIGINT', () => { releaseLock(); process.exit(0); });
    process.on('SIGTERM', () => { releaseLock(); process.exit(0); });

    // Set PGLITE_DIR so db.ts picks it up
    if (!process.env.DATABASE_URL) {
        process.env.PGLITE_DIR = process.env.PGLITE_DIR || pgliteDir;
    }

    // Auto-run migrations if needed
    await runMigrationsIfNeeded();

    // Import and run the main server
    await import("./main");
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
        let migrationsDir = "";
        const candidates = [
            path.join(process.cwd(), "prisma", "migrations"),
            path.join(process.cwd(), "apps/free/server/prisma", "migrations"),
            path.join(__dirname, "..", "prisma", "migrations"),
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                migrationsDir = candidate;
                break;
            }
        }

        if (!migrationsDir) {
            console.log("No migrations directory found, skipping auto-migration");
            await pg.close();
            return;
        }

        // Count available migrations
        const dirs = fs.readdirSync(migrationsDir)
            .filter(d => fs.statSync(path.join(migrationsDir, d)).isDirectory())
            .sort();

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

                const sqlFile = path.join(migrationsDir, dir, "migration.sql");
                if (!fs.existsSync(sqlFile)) continue;

                console.log(`  Applying ${dir}...`);
                const sql = fs.readFileSync(sqlFile, "utf-8");

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
    console.log("⚠️  WARNING: This will delete ALL data!");
    console.log(`   Database: ${pgliteDir}`);
    console.log(`   Data dir: ${dataDir}`);

    // Confirm if running interactively
    if (process.stdin.isTTY) {
        console.log("\nPress Ctrl+C to cancel, or wait 3 seconds to continue...");
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

    console.log("✅ All data has been reset!");
    console.log("Run 'free-server serve' to start fresh.");
}

// CLI
const command = process.argv[2];

switch (command) {
    case "migrate":
        migrate().catch(e => {
            console.error(e);
            process.exit(1);
        });
        break;
    case "serve":
        serve().catch(e => {
            console.error(e);
            process.exit(1);
        });
        break;
    case "reset":
        reset().catch(e => {
            console.error(e);
            process.exit(1);
        });
        break;
    case undefined:
    case "--help":
    case "-h":
        console.log(`free-server - portable distribution

Usage:
  free-server migrate    Apply database migrations
  free-server serve      Start the server
  free-server reset      Delete all data and reset to fresh state

Environment variables:
  DATA_DIR          Base data directory (default: ./data)
  PGLITE_DIR        PGlite database directory (default: DATA_DIR/pglite)
  DATABASE_URL      PostgreSQL URL (if set, uses external Postgres instead of PGlite)
  PORT              Server port (default: 3000)
  FREE_MASTER_SECRET   Required: master secret for auth/encryption
`);
        process.exit(0);
    default:
        console.error(`Unknown command: ${command}`);
        console.error(`Run with --help for usage`);
        process.exit(1);
}
