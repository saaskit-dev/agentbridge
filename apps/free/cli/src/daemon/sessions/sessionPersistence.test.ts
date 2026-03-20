import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  persistSession,
  eraseSession,
  readAllPersistedSessions,
  _setTestDir,
} from './sessionPersistence';
import type { PersistedSession } from './sessionPersistence';

let tempDir: string;

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    sessionId: 'sess-1',
    agentType: 'claude',
    cwd: '/tmp/test',
    startedBy: 'cli',
    createdAt: Date.now(),
    daemonInstanceId: 'test-daemon-1',
    ...overrides,
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'session-persist-'));
  _setTestDir(tempDir);
});

afterEach(async () => {
  _setTestDir(null);
  await rm(tempDir, { recursive: true, force: true });
});

describe('sessionPersistence', () => {
  it('persist → read → erase lifecycle', async () => {
    const data = makeSession({ sessionId: 'lifecycle-1' });
    await persistSession(data);

    const all = await readAllPersistedSessions();
    expect(all).toHaveLength(1);
    expect(all[0].sessionId).toBe('lifecycle-1');
    expect(all[0].agentType).toBe('claude');
    expect(all[0].startedBy).toBe('cli');

    await eraseSession('lifecycle-1');
    expect(await readAllPersistedSessions()).toHaveLength(0);
  });

  it('readAll returns empty for nonexistent directory', async () => {
    const all = await readAllPersistedSessions();
    expect(all).toHaveLength(0);
  });

  it('skips corrupted JSON files gracefully', async () => {
    await persistSession(makeSession({ sessionId: 'valid' }));

    const dir = join(tempDir, 'daemon-sessions');
    await writeFile(join(dir, 'corrupted.json'), 'NOT VALID JSON', 'utf-8');

    const all = await readAllPersistedSessions();
    expect(all).toHaveLength(1);
    expect(all[0].sessionId).toBe('valid');
  });

  it('erase is idempotent for missing session', async () => {
    await eraseSession('nonexistent');
  });

  it('persist overwrites existing file', async () => {
    const data = makeSession({ sessionId: 'overwrite', model: 'v1' });
    await persistSession(data);

    const updated = { ...data, model: 'v2' };
    await persistSession(updated);

    const all = await readAllPersistedSessions();
    expect(all).toHaveLength(1);
    expect(all[0].model).toBe('v2');
  });

  it('persists all fields correctly', async () => {
    const data = makeSession({
      sessionId: 'full',
      agentType: 'gemini',
      cwd: '/home/user/project',
      resumeSessionId: 'resume-123',
      permissionMode: 'yolo',
      model: 'gemini-2.0',
      mode: 'chat',
      startingMode: 'remote',
      startedBy: 'app',
      env: { GEMINI_API_KEY: 'test' },
      createdAt: 1000,
      daemonInstanceId: 'other-daemon',
    });
    await persistSession(data);

    const [read] = await readAllPersistedSessions();
    expect(read).toEqual(data);
  });

  it('handles multiple sessions', async () => {
    await persistSession(makeSession({ sessionId: 'a' }));
    await persistSession(makeSession({ sessionId: 'b' }));
    await persistSession(makeSession({ sessionId: 'c' }));

    const all = await readAllPersistedSessions();
    expect(all).toHaveLength(3);
    const ids = all.map(s => s.sessionId).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('ignores non-json files in directory', async () => {
    await persistSession(makeSession({ sessionId: 'real' }));
    const dir = join(tempDir, 'daemon-sessions');
    await writeFile(join(dir, 'README.md'), '# not a session', 'utf-8');

    const all = await readAllPersistedSessions();
    expect(all).toHaveLength(1);
  });
});

