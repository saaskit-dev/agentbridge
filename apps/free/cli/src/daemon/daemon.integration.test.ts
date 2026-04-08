/**
 * Integration tests for daemon HTTP control system
 *
 * Tests the full flow of daemon startup, session tracking, and shutdown
 *
 * IMPORTANT: These tests MUST be run with the integration test environment:
 * pnpm test:integration-test-env
 *
 * DO NOT run with regular 'pnpm test' - it will use the wrong environment
 * and the daemon will not work properly!
 *
 * The integration test environment uses .env.integration-test which sets:
 * - FREE_HOME_DIR=~/.free-dev-test (DIFFERENT from dev's ~/.free-dev!)
 * - FREE_SERVER_URL=http://localhost:3005 (local dev server)
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import path, { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { configuration } from '@/configuration';
import {
  listDaemonSessions,
  stopDaemonSession,
  spawnDaemonSession,
  stopDaemonHttp,
  stopDaemon,
  isDaemonRunningCurrentlyInstalledFreeVersion,
} from '@/daemon/controlClient';
import { readDaemonState, clearDaemonState } from '@/persistence';
import { getLatestDaemonLog } from '@/utils/daemonLogs';
import { spawnFreeCLI } from '@/utils/spawnFreeCLI';
import {
  ensureLocalServerAndCredentials,
} from '@/test-helpers/integrationEnvironment';
import { startDaemonForIntegrationTest } from '@/test-helpers/daemonTestHarness';

// Utility to wait for condition
async function waitFor(
  condition: () => Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('Timeout waiting for condition');
}

describe('Daemon Integration Tests', { timeout: 20_000 }, () => {
  let daemonPid: number;

  beforeAll(async () => {
    process.env.FREE_DAEMON_HEARTBEAT_INTERVAL = '5000';
    // Server is started by globalSetup (test-setup.ts) — just ensure credentials exist
    await ensureLocalServerAndCredentials();
  });

  beforeEach(async () => {
    daemonPid = await startDaemonForIntegrationTest();

    const daemonState = await readDaemonState();
    if (!daemonState) {
      throw new Error('Daemon state missing after integration startup');
    }

    console.log(`[TEST] Daemon started for test: PID=${daemonPid}`);
    console.log(`[TEST] Daemon log file: ${daemonState?.daemonLogPath}`);
  }, 20_000);

  afterEach(async () => {
    await stopDaemon();
  });

  it('should list sessions (initially empty)', async () => {
    const sessions = await listDaemonSessions();
    expect(sessions).toEqual([]);
  });

  it('should spawn & stop a session via HTTP', async () => {
    const response = await spawnDaemonSession('/tmp', 'spawned-test-456');

    expect(response).toHaveProperty('success', true);
    expect(response).toHaveProperty('sessionId');

    // Verify session is tracked with new SessionSummary fields
    const sessions = await listDaemonSessions();
    const spawnedSession = sessions.find((s: any) => s.sessionId === response.sessionId);

    expect(spawnedSession).toBeDefined();
    expect(spawnedSession.startedBy).toBe('app');
    expect(spawnedSession.sessionId).toBeDefined();

    // Clean up - stop the spawned session
    await stopDaemonSession(spawnedSession.sessionId);
  });

  it('stress test: spawn / stop', { timeout: 60_000 }, async () => {
    const promises = [];
    const sessionCount = 20;
    for (let i = 0; i < sessionCount; i++) {
      promises.push(spawnDaemonSession('/tmp'));
    }

    // Wait for all sessions to be spawned
    const results = await Promise.all(promises);
    const sessionIds = results.map(r => r.sessionId);

    const sessions = await listDaemonSessions();
    expect(sessions).toHaveLength(sessionCount);

    // Stop all sessions
    const stopResults = await Promise.all(
      sessionIds.map(sessionId => stopDaemonSession(sessionId))
    );
    expect(
      stopResults.every(r => r),
      'Not all sessions reported stopped'
    ).toBe(true);

    // Wait for all sessions to actually finish shutting down (stop is fire-and-forget)
    await waitFor(async () => (await listDaemonSessions()).length === 0, 10_000, 200);
  });

  it('should handle daemon stop request gracefully', async () => {
    await stopDaemonHttp();

    // Verify metadata file is cleaned up
    await waitFor(async () => !existsSync(configuration.daemonStateFile), 1000);
  });

  it('should not allow starting a second daemon', async () => {
    // Daemon is already running from beforeEach
    // Try to start another daemon
    const secondChild = spawnFreeCLI(['daemon', 'start-sync'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    secondChild.stdout?.on('data', data => {
      output += data.toString();
    });
    secondChild.stderr?.on('data', data => {
      output += data.toString();
    });

    // Wait for the second daemon to exit
    await new Promise<void>(resolve => {
      secondChild.on('exit', () => resolve());
    });

    const stateAfter = await readDaemonState();
    expect(stateAfter).toBeDefined();
    expect(stateAfter!.pid).toBe(daemonPid);
    expect(output).not.toContain('Error:');
  });

  it('should handle concurrent session operations', async () => {
    // Spawn multiple sessions concurrently
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(spawnDaemonSession('/tmp'));
    }

    const results = await Promise.all(promises);

    // All should succeed
    results.forEach(res => {
      expect(res.success).toBe(true);
      expect(res.sessionId).toBeDefined();
    });

    // Collect session IDs for tracking
    const spawnedSessionIds = results.map(r => r.sessionId);

    // Give sessions time to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // List should show all sessions
    const sessions = await listDaemonSessions();
    const daemonSessions = sessions.filter((s: any) => spawnedSessionIds.includes(s.sessionId));
    expect(daemonSessions.length).toBeGreaterThanOrEqual(3);

    // Stop all spawned sessions
    for (const session of daemonSessions) {
      expect(session.sessionId).toBeDefined();
      await stopDaemonSession(session.sessionId);
    }
  });

  it('should die with logs when SIGKILL is sent', async () => {
    // SIGKILL test - daemon should die immediately
    const logsDir = configuration.logsDir;

    // Get initial log files
    const initialLogs = readdirSync(logsDir).filter(f => f.endsWith('-daemon.log'));

    // Send SIGKILL to daemon (force kill)
    process.kill(daemonPid, 'SIGKILL');

    // Wait for process to die
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if process is dead
    let isDead = false;
    try {
      process.kill(daemonPid, 0);
    } catch {
      isDead = true;
    }
    expect(isDead).toBe(true);

    // Check that log file exists (it was created when daemon started)
    const finalLogs = readdirSync(logsDir).filter(f => f.endsWith('-daemon.log'));
    expect(finalLogs.length).toBeGreaterThanOrEqual(initialLogs.length);

    // The daemon won't have time to write cleanup logs with SIGKILL
    console.log('[TEST] Daemon killed with SIGKILL - no cleanup logs expected');

    // Clean up state file manually since daemon couldn't do it
    await clearDaemonState();
  });

  it('should die with cleanup logs when SIGTERM is sent', async () => {
    // SIGTERM test - daemon should cleanup gracefully
    const logFile = await getLatestDaemonLog();
    if (!logFile) {
      throw new Error('No log file found');
    }

    // Send SIGTERM to daemon (graceful shutdown)
    process.kill(daemonPid, 'SIGTERM');

    // Wait for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 4_000));

    // Check if process is dead
    let isDead = false;
    try {
      process.kill(daemonPid, 0);
    } catch {
      isDead = true;
    }
    expect(isDead).toBe(true);

    // Read the log file to check for cleanup messages
    const logContent = readFileSync(logFile.path, 'utf8');

    // Should contain cleanup messages
    expect(logContent).toContain('SIGTERM');
    expect(logContent).toContain('cleanup');

    console.log('[TEST] Daemon terminated gracefully with SIGTERM - cleanup logs written');

    // Clean up state file if it still exists (should have been cleaned by SIGTERM handler)
    await clearDaemonState();
  });

  /**
   * Version mismatch detection test - control flow:
   *
   * 1. Test starts daemon with original version (e.g., 0.9.0-6) compiled into dist/
   * 2. Test modifies package.json to new version (e.g., 0.0.0-integration-test-*)
   * 3. Test runs `pnpm build` to recompile with new version
   * 4. Daemon's heartbeat (every 30s) reads package.json and compares to its compiled version
   * 5. Daemon detects mismatch: package.json != configuration.currentCliVersion
   * 6. Daemon spawns new daemon via spawnFreeCLI(['daemon', 'start'])
   * 7. New daemon starts, reads daemon.state.json, sees old version != its compiled version
   * 8. New daemon calls stopDaemon() to kill old daemon, then takes over
   */
  it('should detect daemon version/build mismatch after rebuild', { timeout: 60_000 }, async () => {
    const originalVersion = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    ).version;

    try {
      // Get initial daemon state
      const initialState = await readDaemonState();
      expect(initialState).toBeDefined();
      expect(initialState!.startedWithCliVersion).toBe(originalVersion);
      const initialPid = initialState!.pid;

      // Tamper with the build hash on disk to simulate a rebuild.
      // This is instant (no pnpm build needed) and avoids the daemon heartbeat
      // detecting a package.json version change and auto-restarting during the test.
      const hashPath = path.join(process.cwd(), 'dist', '.hash');
      const originalHash = readFileSync(hashPath, 'utf-8');
      writeFileSync(hashPath, 'fake-hash-for-mismatch-test');

      console.log(
        `[TEST] Current daemon running with version ${originalVersion}, PID: ${initialPid}`
      );
      console.log(`[TEST] Tampered dist/.hash to simulate rebuild`);

      // Client-side detection: build hash on disk differs from daemon state → mismatch
      expect(await isDaemonRunningCurrentlyInstalledFreeVersion()).toBe(false);

      // Daemon should still be the SAME process (package.json untouched, heartbeat won't trigger)
      const finalState = await readDaemonState();
      expect(finalState).toBeDefined();
      expect(finalState!.startedWithCliVersion).toBe(originalVersion);
      expect(finalState!.pid).toBe(initialPid);
      console.log('[TEST] Daemon version/build mismatch detected successfully');

      // Restore original hash
      writeFileSync(hashPath, originalHash);
      console.log(`[TEST] Restored dist/.hash`);
    } finally {
      // Safety restore in case the test threw before the inline restore
      const hashPath = path.join(process.cwd(), 'dist', '.hash');
      const currentHash = readFileSync(hashPath, 'utf-8');
      if (currentHash === 'fake-hash-for-mismatch-test') {
        execSync('node scripts/generate-build-hash.cjs', { stdio: 'ignore' });
      }
    }
  });

  // TODO: Add a test to see if a corrupted file will work

  // TODO: Test npm uninstall scenario - daemon should gracefully handle when @saaskit-dev/free is uninstalled
  // Current behavior: daemon tries to spawn new daemon on version mismatch but dist/index.mjs is gone
  // Expected: daemon should detect missing entrypoint and either exit cleanly or at minimum not respawn infinitely

  // ---------------------------------------------------------------------------
  // Session Recovery Tests
  // ---------------------------------------------------------------------------

  it('should recover sessions after SIGKILL (crash recovery)', { timeout: 30_000 }, async () => {
    // 1. Spawn a session
    const response = await spawnDaemonSession('/tmp');
    expect(response.success).toBe(true);
    const { sessionId } = response;

    const sessions = await listDaemonSessions();
    expect(sessions).toHaveLength(1);

    // 2. SIGKILL daemon (simulate crash — no graceful shutdown)
    process.kill(daemonPid, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify daemon is dead
    let isDead = false;
    try {
      process.kill(daemonPid, 0);
    } catch {
      isDead = true;
    }
    expect(isDead).toBe(true);

    // 3. Verify persisted session file exists
    const daemonSessionsDir = join(configuration.freeHomeDir, 'daemon-sessions');
    const persistedFiles = readdirSync(daemonSessionsDir).filter(f => f.endsWith('.json'));
    expect(persistedFiles.length).toBeGreaterThanOrEqual(1);

    // 4. Clean daemon state and restart
    await clearDaemonState();

    const previousDaemonPid = daemonPid;
    daemonPid = await startDaemonForIntegrationTest();
    expect(daemonPid).not.toBe(previousDaemonPid);

    // 5. Verify session was recovered
    await waitFor(
      async () => {
        const recovered = await listDaemonSessions();
        return recovered.length > 0;
      },
      10_000,
      500
    );

    const recovered = await listDaemonSessions();
    expect(recovered.length).toBeGreaterThanOrEqual(1);
    // Session ID should match the original
    expect(recovered.some((s: any) => s.sessionId === sessionId)).toBe(true);

    // 6. Clean up
    await stopDaemonSession(sessionId);
  });

  it('should recover sessions after clean daemon stop', { timeout: 30_000 }, async () => {
    // Daemon stop is NOT session end — sessions should be recoverable.
    // 1. Spawn a session
    const response = await spawnDaemonSession('/tmp');
    expect(response.success).toBe(true);
    const { sessionId } = response;

    // 2. Gracefully stop daemon — persisted files are kept (pendingExit=true)
    await stopDaemonHttp();
    await waitFor(async () => !existsSync(configuration.daemonStateFile), 3000);

    // 3. Verify persisted session files still exist
    const daemonSessionsDir = join(configuration.freeHomeDir, 'daemon-sessions');
    let persistedFiles: string[] = [];
    try {
      persistedFiles = readdirSync(daemonSessionsDir).filter(f => f.endsWith('.json'));
    } catch {
      // Directory may not exist if session died before persisting
    }
    expect(persistedFiles.length).toBeGreaterThanOrEqual(1);

    // 4. Restart daemon
    daemonPid = await startDaemonForIntegrationTest();

    // 5. Session should be recovered
    await waitFor(
      async () => {
        const recovered = await listDaemonSessions();
        return recovered.length > 0;
      },
      10_000,
      500
    );

    const recovered = await listDaemonSessions();
    expect(recovered.some((s: any) => s.sessionId === sessionId)).toBe(true);

    // 6. Clean up
    await stopDaemonSession(sessionId);
  });

  it(
    'should retain persisted session snapshot when recovery fails',
    { timeout: 30_000 },
    async () => {
      // 1. Manually write a persisted session with invalid data (bad sessionId)
      const daemonSessionsDir = join(configuration.freeHomeDir, 'daemon-sessions');
      if (!existsSync(daemonSessionsDir)) {
        const { mkdirSync } = require('fs');
        mkdirSync(daemonSessionsDir, { recursive: true });
      }

      const badData = {
        sessionId: 'bad-session-test',
        agentType: 'nonexistent-agent-type', // unregistered agent → AgentSessionFactory.create throws
        cwd: '/tmp',
        startedBy: 'cli',
        createdAt: Date.now(),
        daemonInstanceId: 'dead-daemon-instance', // different from current daemon
      };
      writeFileSync(join(daemonSessionsDir, 'bad-session-test.json'), JSON.stringify(badData));

      // 2. Stop and restart daemon
      await stopDaemonHttp();
      await waitFor(async () => !existsSync(configuration.daemonStateFile), 3000);

      daemonPid = await startDaemonForIntegrationTest();

      // 3. Recovery attempt should fail (invalid data) but snapshot is retained
      //    for retry — only expired by age (24h TTL), not by failure.
      await new Promise(resolve => setTimeout(resolve, 2000));

      const remainingFiles = readdirSync(daemonSessionsDir).filter(f => f.includes('bad-session'));
      expect(remainingFiles).toHaveLength(1);

      // Clean up the test file
      const { unlinkSync } = require('fs');
      unlinkSync(join(daemonSessionsDir, 'bad-session-test.json'));
    }
  );
});
