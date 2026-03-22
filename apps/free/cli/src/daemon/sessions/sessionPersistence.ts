/**
 * Session Persistence
 *
 * Persists active session metadata to disk so the daemon can recover them
 * after a restart (version upgrade, crash, SIGKILL).
 *
 * Storage: ~/.free/daemon-sessions/<sessionId>.json
 *
 * Write points (handled by AgentSession base class):
 *   1. initialize() completes → full snapshot
 *   2. updateResumeId() called → update resumeSessionId field
 *   3. shutdown() → delete file (normal exit needs no recovery)
 *
 * If the daemon crashes, files remain on disk. The new daemon reads them
 * on startup and re-spawns sessions via AgentSessionFactory.
 */

import { join } from 'node:path';
import { readdir, readFile, writeFile, unlink, mkdir, chmod } from 'node:fs/promises';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { configuration } from '@/configuration';
import type { AgentType, SessionInitiator } from './types';
import type { PermissionMode } from '@/api/types';

const logger = new Logger('daemon/sessions/sessionPersistence');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersistedSession {
  sessionId: string;
  agentType: AgentType;
  cwd: string;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
  model?: string;
  mode?: string;
  startingMode?: 'local' | 'remote';
  startedBy: SessionInitiator;
  env?: Record<string, string>;
  createdAt: number;
  /** Unique ID of the daemon instance that owns this session. Not a PID — immune to PID reuse. */
  daemonInstanceId: string;
  /** Server message seq watermark — avoids re-fetching all messages after recovery. */
  lastSeq?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Override for testing — when set, all I/O uses this directory instead of freeHomeDir. */
let _testDir: string | null = null;

/** @internal For tests only — redirect persistence to a temp directory. */
export function _setTestDir(dir: string | null): void {
  _testDir = dir;
}

function sessionsDir(): string {
  const base = _testDir ?? configuration.freeHomeDir;
  return join(base, 'daemon-sessions');
}

function sessionFilePath(sessionId: string): string {
  return join(sessionsDir(), `${sessionId}.json`);
}

async function ensureDir(): Promise<void> {
  await mkdir(sessionsDir(), { recursive: true });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function persistSession(data: PersistedSession): Promise<void> {
  await ensureDir();
  const filePath = sessionFilePath(data.sessionId);
  await writeFile(filePath, JSON.stringify(data), 'utf-8');
  await chmod(filePath, 0o600);
  logger.debug('[sessionPersistence] persisted', { sessionId: data.sessionId });
}

export async function eraseSession(sessionId: string): Promise<void> {
  try {
    await unlink(sessionFilePath(sessionId));
    logger.debug('[sessionPersistence] erased', { sessionId });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // Already gone — no-op
  }
}

export async function readAllPersistedSessions(): Promise<PersistedSession[]> {
  const dir = sessionsDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const results: PersistedSession[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(dir, name), 'utf-8');
      results.push(JSON.parse(raw) as PersistedSession);
    } catch (err) {
      logger.warn('[sessionPersistence] skipping corrupted file', { name, error: String(err) });
    }
  }
  return results;
}
