/**
 * Minimal persistence functions for free CLI
 *
 * Handles settings and private key storage in ~/.free/ or local .free/
 */

import { existsSync, writeFileSync, readFileSync, unlinkSync, chmodSync } from 'node:fs';
import { constants } from 'node:fs';
import { readFile, writeFile, mkdir, open, unlink, rename, stat, chmod } from 'node:fs/promises';
import { FileHandle } from 'node:fs/promises';
import * as z from 'zod';
import { encodeBase64 } from '@/api/encryption';
import { configuration } from '@/configuration';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
const logger = new Logger('persistence');

export const SandboxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  workspaceRoot: z.string().optional(),
  sessionIsolation: z.enum(['strict', 'workspace', 'custom']).default('workspace'),
  customWritePaths: z.array(z.string()).default([]),
  denyReadPaths: z.array(z.string()).default(['~/.ssh', '~/.aws', '~/.gnupg']),
  extraWritePaths: z.array(z.string()).default(['/tmp']),
  denyWritePaths: z.array(z.string()).default(['.env']),
  networkMode: z.enum(['blocked', 'allowed', 'custom']).default('allowed'),
  allowedDomains: z.array(z.string()).default([]),
  deniedDomains: z.array(z.string()).default([]),
  allowLocalBinding: z.boolean().default(true),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
export const SUPPORTED_SCHEMA_VERSION = 3;

interface Settings {
  // Schema version for backwards compatibility
  schemaVersion: number;
  onboardingCompleted: boolean;
  // This ID is used as the actual database ID on the server
  // All machine operations use this ID
  machineId?: string;
  machineIdConfirmedByServer?: boolean;
  daemonAutoStartWhenRunningFree?: boolean;
  chromeMode?: boolean; // Default Chrome mode setting for Claude
  sandboxConfig?: SandboxConfig;
  // Analytics/telemetry opt-out (default: true = enabled)
  analyticsEnabled?: boolean;
}

const defaultSettings: Settings = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  onboardingCompleted: false,
  sandboxConfig: undefined,
  analyticsEnabled: true,
};

/**
 * Migrate settings from old schema versions to current
 * Always backwards compatible - preserves all data
 */
function migrateSettings(raw: any, fromVersion: number): any {
  const migrated = { ...raw };

  // Migration from v1/v2 to v3 (added analyticsEnabled, removed profile state)
  if (fromVersion < 3) {
    if (migrated.analyticsEnabled === undefined) {
      migrated.analyticsEnabled = true;
    }
  }

  delete migrated.activeProfileId;
  delete migrated.profiles;
  delete migrated.localEnvironmentVariables;
  migrated.schemaVersion = 3;

  // Future migrations go here:
  // if (fromVersion < 4) { ... }

  return migrated;
}

/**
 * Daemon state persisted locally (different from API DaemonState)
 * This is written to disk by the daemon to track its local process state
 */
export interface DaemonLocallyPersistedState {
  pid: number;
  httpPort: number;
  controlToken: string;
  startTime: string;
  startedWithCliVersion: string;
  buildHash?: string;
  buildTime?: string;
  lastHeartbeat?: string;
  daemonLogPath?: string;
}

/**
 * Ensure ~/.free directory exists with restricted permissions (owner-only)
 */
async function ensureFreeHomeDir(): Promise<void> {
  if (!existsSync(configuration.freeHomeDir)) {
    await mkdir(configuration.freeHomeDir, { recursive: true, mode: 0o700 });
  }
}

export async function readSettings(): Promise<Settings> {
  if (!existsSync(configuration.settingsFile)) {
    return { ...defaultSettings };
  }

  try {
    // Read raw settings
    const content = await readFile(configuration.settingsFile, 'utf8');
    const raw = JSON.parse(content);

    // Check schema version (default to 1 if missing)
    const schemaVersion = raw.schemaVersion ?? 1;

    // Warn if schema version is newer than supported
    if (schemaVersion > SUPPORTED_SCHEMA_VERSION) {
      logger.debug(
        `⚠️ Settings schema v${schemaVersion} > supported v${SUPPORTED_SCHEMA_VERSION}. ` +
          'Update free-cli for full functionality.'
      );
    }

    // Migrate if needed
    const migrated = migrateSettings(raw, schemaVersion);

    if (migrated.sandboxConfig !== undefined) {
      try {
        migrated.sandboxConfig = SandboxConfigSchema.parse(migrated.sandboxConfig);
      } catch (error: any) {
        logger.debug(`⚠️ Invalid sandbox config - skipping. Error: ${error.message}`);
        migrated.sandboxConfig = undefined;
      }
    }

    // Merge with defaults to ensure all required fields exist
    return { ...defaultSettings, ...migrated };
  } catch (error: any) {
    logger.warn(`Failed to read settings: ${error.message}`);
    // Return defaults on any error
    return { ...defaultSettings };
  }
}

export async function writeSettings(settings: Settings): Promise<void> {
  await ensureFreeHomeDir();

  // Ensure schema version is set before writing
  const settingsWithVersion = {
    ...settings,
    schemaVersion: settings.schemaVersion ?? SUPPORTED_SCHEMA_VERSION,
  };

  await writeFile(configuration.settingsFile, JSON.stringify(settingsWithVersion, null, 2));
}

/**
 * Atomically update settings with multi-process safety via file locking
 * @param updater Function that takes current settings and returns updated settings
 * @returns The updated settings
 */
export async function updateSettings(
  updater: (current: Settings) => Settings | Promise<Settings>
): Promise<Settings> {
  // Timing constants
  const LOCK_RETRY_INTERVAL_MS = 100; // How long to wait between lock attempts
  const MAX_LOCK_ATTEMPTS = 50; // Maximum number of attempts (5 seconds total)
  const STALE_LOCK_TIMEOUT_MS = 10000; // Consider lock stale after 10 seconds

  const lockFile = configuration.settingsFile + '.lock';
  const tmpFile = configuration.settingsFile + '.tmp';
  let fileHandle;
  let attempts = 0;

  // Acquire exclusive lock with retries
  while (attempts < MAX_LOCK_ATTEMPTS) {
    try {
      // O_CREAT | O_EXCL | O_WRONLY = create exclusively, fail if exists
      fileHandle = await open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      break;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Lock file exists, wait and retry
        attempts++;
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));

        // Check for stale lock
        try {
          const stats = await stat(lockFile);
          if (Date.now() - stats.mtimeMs > STALE_LOCK_TIMEOUT_MS) {
            await unlink(lockFile).catch(() => {});
          }
        } catch {}
      } else {
        throw err;
      }
    }
  }

  if (!fileHandle) {
    throw new Error(
      `Failed to acquire settings lock after ${(MAX_LOCK_ATTEMPTS * LOCK_RETRY_INTERVAL_MS) / 1000} seconds`
    );
  }

  try {
    // Read current settings with defaults
    const current = (await readSettings()) || { ...defaultSettings };

    // Apply update
    const updated = await updater(current);

    // Ensure directory exists
    await ensureFreeHomeDir();

    // Write atomically using rename
    await writeFile(tmpFile, JSON.stringify(updated, null, 2));
    await rename(tmpFile, configuration.settingsFile); // Atomic on POSIX

    return updated;
  } finally {
    // Release lock
    await fileHandle.close();
    await unlink(lockFile).catch(() => {}); // Remove lock file
  }
}

//
// Authentication
//

const credentialsSchema = z.object({
  token: z.string(),
  secret: z.string().base64().nullish(), // Legacy
  encryption: z
    .object({
      publicKey: z.string().base64(),
      machineKey: z.string().base64(),
    })
    .nullish(),
});

export type Credentials = {
  token: string;
  encryption:
    | {
        type: 'legacy';
        secret: Uint8Array;
      }
    | {
        type: 'dataKey';
        publicKey: Uint8Array;
        machineKey: Uint8Array;
      };
};

export async function readCredentials(): Promise<Credentials | null> {
  if (!existsSync(configuration.privateKeyFile)) {
    return null;
  }
  try {
    const keyBase64 = await readFile(configuration.privateKeyFile, 'utf8');
    const credentials = credentialsSchema.parse(JSON.parse(keyBase64));
    if (credentials.secret) {
      return {
        token: credentials.token,
        encryption: {
          type: 'legacy',
          secret: new Uint8Array(Buffer.from(credentials.secret, 'base64')),
        },
      };
    } else if (credentials.encryption) {
      return {
        token: credentials.token,
        encryption: {
          type: 'dataKey',
          publicKey: new Uint8Array(Buffer.from(credentials.encryption.publicKey, 'base64')),
          machineKey: new Uint8Array(Buffer.from(credentials.encryption.machineKey, 'base64')),
        },
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function writeCredentialsLegacy(credentials: {
  secret: Uint8Array;
  token: string;
}): Promise<void> {
  await ensureFreeHomeDir();
  await writeFile(
    configuration.privateKeyFile,
    JSON.stringify(
      {
        secret: encodeBase64(credentials.secret),
        token: credentials.token,
      },
      null,
      2
    )
  );
  await chmod(configuration.privateKeyFile, 0o600);
}

export async function writeCredentialsDataKey(credentials: {
  publicKey: Uint8Array;
  machineKey: Uint8Array;
  token: string;
}): Promise<void> {
  await ensureFreeHomeDir();
  await writeFile(
    configuration.privateKeyFile,
    JSON.stringify(
      {
        encryption: {
          publicKey: encodeBase64(credentials.publicKey),
          machineKey: encodeBase64(credentials.machineKey),
        },
        token: credentials.token,
      },
      null,
      2
    )
  );
  await chmod(configuration.privateKeyFile, 0o600);
}

/**
 * Synchronously read the logged-in user's ID by decoding the stored JWT token.
 * Returns undefined if not logged in or token is malformed.
 */
export function getLoggedInUserIdSync(): string | undefined {
  try {
    if (!existsSync(configuration.privateKeyFile)) return undefined;
    const data = JSON.parse(readFileSync(configuration.privateKeyFile, 'utf8'));
    if (typeof data.token !== 'string') return undefined;
    const payload = data.token.split('.')[1];
    if (!payload) return undefined;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    return typeof decoded.sub === 'string' ? decoded.sub : undefined;
  } catch {
    return undefined;
  }
}

export async function clearCredentials(): Promise<void> {
  if (existsSync(configuration.privateKeyFile)) {
    await unlink(configuration.privateKeyFile);
  }
}

export async function clearMachineId(): Promise<void> {
  await updateSettings(settings => ({
    ...settings,
    machineId: undefined,
  }));
}

/**
 * Read daemon state from local file
 */
export async function readDaemonState(): Promise<DaemonLocallyPersistedState | null> {
  try {
    if (!existsSync(configuration.daemonStateFile)) {
      return null;
    }
    const content = await readFile(configuration.daemonStateFile, 'utf-8');
    return JSON.parse(content) as DaemonLocallyPersistedState;
  } catch (error) {
    // State corrupted somehow :(
    logger.error(`[PERSISTENCE] Daemon state file corrupted: ${configuration.daemonStateFile}`, undefined, { error: safeStringify(error) });
    return null;
  }
}

/**
 * Write daemon state to local file (synchronously for atomic operation)
 */
export function writeDaemonState(state: DaemonLocallyPersistedState): void {
  writeFileSync(configuration.daemonStateFile, JSON.stringify(state, null, 2), 'utf-8');
  chmodSync(configuration.daemonStateFile, 0o600);
}

/**
 * Clean up daemon state file and lock file
 */
export async function clearDaemonState(): Promise<void> {
  if (existsSync(configuration.daemonStateFile)) {
    await unlink(configuration.daemonStateFile);
  }
  // Also clean up lock file if it exists (for stale cleanup)
  if (existsSync(configuration.daemonLockFile)) {
    try {
      await unlink(configuration.daemonLockFile);
    } catch {
      // Lock file might be held by running daemon, ignore error
    }
  }
}

/**
 * Acquire an exclusive lock file for the daemon.
 * The lock file proves the daemon is running and prevents multiple instances.
 * Returns the file handle to hold for the daemon's lifetime, or null if locked.
 */
export async function acquireDaemonLock(
  maxAttempts: number = 5,
  delayIncrementMs: number = 200
): Promise<FileHandle | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // O_EXCL ensures we only create if it doesn't exist (atomic lock acquisition)
      const fileHandle = await open(
        configuration.daemonLockFile,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
      );
      // Write PID to lock file for debugging
      await fileHandle.writeFile(String(process.pid));
      return fileHandle;
    } catch (error: any) {
      if (error.code === 'EEXIST') {
        // Lock file exists, check if process is still running
        try {
          const lockPid = readFileSync(configuration.daemonLockFile, 'utf-8').trim();
          if (lockPid && !isNaN(Number(lockPid))) {
            try {
              process.kill(Number(lockPid), 0); // Check if process exists
            } catch {
              // Process doesn't exist, remove stale lock
              unlinkSync(configuration.daemonLockFile);
              continue; // Retry acquisition
            }
          }
        } catch {
          // Can't read lock file, might be corrupted
        }
      }

      if (attempt === maxAttempts) {
        return null;
      }
      const delayMs = attempt * delayIncrementMs;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

/**
 * Release daemon lock by closing handle and deleting lock file
 */
export async function releaseDaemonLock(lockHandle: FileHandle): Promise<void> {
  try {
    await lockHandle.close();
  } catch {}

  try {
    if (existsSync(configuration.daemonLockFile)) {
      unlinkSync(configuration.daemonLockFile);
    }
  } catch {}
}

//
// Analytics Settings
//

/**
 * Check if analytics/telemetry is enabled (default: true)
 */
export async function isAnalyticsEnabled(): Promise<boolean> {
  const settings = await readSettings();
  return settings.analyticsEnabled ?? true;
}

/**
 * Set analytics/telemetry enabled state
 */
export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  await updateSettings(settings => ({
    ...settings,
    analyticsEnabled: enabled,
  }));
}
