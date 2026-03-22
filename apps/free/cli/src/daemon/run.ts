import { existsSync, readFileSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import { join } from 'path';
import packageJson from '../../package.json';
import {
  cleanupDaemonState,
  isDaemonRunningCurrentlyInstalledFreeVersion,
  stopDaemon,
} from './controlClient';
import { startDaemonControlServer } from './controlServer';
import { IPCServer } from './ipc/IPCServer';
import type {
  SpawnSessionOptions as IPCSpawnSessionOptions,
  SpawnSessionResult as IPCSpawnSessionResult,
} from './ipc/protocol';
import { SessionManager } from './sessions/SessionManager';
import { AgentSessionFactory } from './sessions/AgentSessionFactory';
import { ClaudeNativeSession } from './sessions/ClaudeNativeSession';
import { GeminiSession } from './sessions/GeminiSession';
import { OpenCodeSession } from './sessions/OpenCodeSession';
import { ClaudeSession } from './sessions/ClaudeSession';
import { CodexSession } from './sessions/CodexSession';
import { CursorSession } from './sessions/CursorSession';
import { ApiClient } from '@/api/api';
import { MachineMetadata, DaemonState } from '@/api/types';
import { configuration } from '@/configuration';
import type {
  SpawnSessionOptions,
  SpawnSessionResult,
} from '@/modules/common/registerCommonHandlers';
import {
  writeDaemonState,
  DaemonLocallyPersistedState,
  readDaemonState,
  acquireDaemonLock,
  releaseDaemonLock,
  readSettings,
  updateSettings,
} from '@/persistence';
import { projectPath } from '@/projectPath';
import { authAndSetupMachineIfNeeded, hasCredentials, isHeadlessEnvironment } from '@/ui/auth';
import { Logger, getCollector, toError } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { randomBytes, randomUUID } from 'node:crypto';
import { startCaffeinate, stopCaffeinate } from '@/utils/caffeinate';
import { expandEnvironmentVariables } from '@/utils/expandEnvVars';
import { spawnFreeCLI } from '@/utils/spawnFreeCLI';
import { buildAgentAuthEnv } from './buildAgentAuthEnv';
import { shutdownTelemetry, getProcessTraceContext } from '@/telemetry';
import { isAnalyticsEnabledSync } from '@/api/analyticsHeaderSync';
import { getChildProcStats } from '@/utils/childProcessUtils';
import {
  readAllPersistedSessions,
  eraseSession as erasePersistedSession,
} from './sessions/sessionPersistence';

// Register all agent session types at module load time
AgentSessionFactory.register('claude-native', ClaudeNativeSession);
AgentSessionFactory.register('claude', ClaudeSession);
AgentSessionFactory.register('codex', CodexSession);
AgentSessionFactory.register('gemini', GeminiSession);
AgentSessionFactory.register('opencode', OpenCodeSession);
AgentSessionFactory.register('cursor', CursorSession);

import { readBuildMeta } from '@/utils/buildMeta';

/** Read build hash from dist/.hash file (legacy compat) */
function readBuildHash(): string | undefined {
  return readBuildMeta().hash;
}

const logger = new Logger('daemon/run');

/** Env keys that belong to the daemon/server and must never leak to agent subprocesses. */
const DAEMON_SECRET_KEYS = [
  'FREE_MASTER_SECRET',
  'DATABASE_URL',
  'PGLITE_DIR',
  'NEW_RELIC_LICENSE_KEY',
] as const;
// Prepare initial metadata
export const initialMachineMetadata: MachineMetadata = {
  host: os.hostname(),
  platform: os.platform(),
  freeCliVersion: packageJson.version,
  homeDir: os.homedir(),
  freeHomeDir: configuration.freeHomeDir,
  freeLibDir: projectPath(),
};

export async function startDaemon(): Promise<void> {
  // Unique ID for this daemon instance — used for session recovery ownership.
  // Not a PID (which can be reused by the OS after process death).
  const daemonInstanceId = randomUUID();

  // We don't have cleanup function at the time of server construction
  // Control flow is:
  // 1. Create promise that will resolve when shutdown is requested
  // 2. Setup signal handlers to resolve this promise with the source of the shutdown
  // 3. Once our setup is complete - if all goes well - we await this promise
  // 4. When it resolves we can cleanup and exit
  //
  // In case the setup malfunctions - our signal handlers will not properly
  // shut down. We will force exit the process with code 1.
  let requestShutdown: (
    source: 'free-app' | 'free-cli' | 'os-signal' | 'exception',
    errorMessage?: string
  ) => void;
  let clearShutdownFallback: (() => void) | undefined;
  const resolvesWhenShutdownRequested = new Promise<{
    source: 'free-app' | 'free-cli' | 'os-signal' | 'exception';
    errorMessage?: string;
  }>(resolve => {
    requestShutdown = (source, errorMessage) => {
      logger.debug(
        `[DAEMON RUN] Requesting shutdown (source: ${source}, errorMessage: ${errorMessage})`
      );

      // Fallback - in case startup malfunctions - we will force exit the process with code 1
      // 15s gives time for graceful shutdown including API calls + telemetry flush
      const fallbackTimer = setTimeout(async () => {
        logger.debug('[DAEMON RUN] Startup malfunctioned, forcing exit with code 1');

        // Give time for logs to be flushed
        await new Promise(resolve => setTimeout(resolve, 100));

        process.exit(1);
      }, 15_000);
      clearShutdownFallback = () => clearTimeout(fallbackTimer);

      // Start graceful shutdown
      resolve({ source, errorMessage });
    };
  });

  // Setup signal handlers
  process.on('SIGINT', () => {
    logger.debug('[DAEMON RUN] Received SIGINT');
    requestShutdown('os-signal');
  });

  process.on('SIGTERM', () => {
    logger.debug('[DAEMON RUN] Received SIGTERM');
    requestShutdown('os-signal');
  });

  process.on('uncaughtException', error => {
    logger.debug('[DAEMON RUN] FATAL: Uncaught exception', error);
    logger.debug(`[DAEMON RUN] Stack trace: ${error.stack}`);
    // Set timeout to force exit after cleanup attempt
    setTimeout(() => {
      logger.debug('[DAEMON RUN] Force exit after uncaught exception');
      process.exit(1);
    }, 5000);
    requestShutdown('exception', error.message);
  });
  process.on('unhandledRejection', (reason, promise) => {
    logger.debug('[DAEMON RUN] FATAL: Unhandled promise rejection', reason);
    logger.debug(`[DAEMON RUN] Rejected promise:`, promise);
    const error = toError(reason);
    logger.debug(`[DAEMON RUN] Stack trace: ${error.stack}`);
    // Set timeout to force exit after cleanup attempt
    setTimeout(() => {
      logger.debug('[DAEMON RUN] Force exit after unhandled rejection');
      process.exit(1);
    }, 5000);
    requestShutdown('exception', error.message);
  });
  process.on('exit', code => {
    logger.debug(`[DAEMON RUN] Process exiting with code: ${code}`);
  });

  process.on('beforeExit', code => {
    logger.debug(`[DAEMON RUN] Process about to exit with code: ${code}`);
  });

  logger.debug('[DAEMON RUN] Starting daemon process...');
  logger.debug('[DAEMON RUN] Environment');

  // Check if already running
  // Check if running daemon version matches current CLI version
  const runningDaemonVersionMatches = await isDaemonRunningCurrentlyInstalledFreeVersion();
  if (!runningDaemonVersionMatches) {
    logger.debug(
      '[DAEMON RUN] Daemon version mismatch detected, restarting daemon with current CLI version'
    );
    await stopDaemon();
  } else {
    logger.debug('[DAEMON RUN] Daemon version matches, keeping existing daemon');
    // Exit 1 so LaunchAgent KeepAlive retries later — when the existing daemon
    // eventually stops, the service manager will start a supervised instance.
    // ThrottleInterval (5s) prevents excessive restarts.
    process.exit(configuration.isDaemonProcess ? 1 : 0);
  }

  // Acquire exclusive lock (proves daemon is running)
  const daemonLockHandle = await acquireDaemonLock(5, 200);
  if (!daemonLockHandle) {
    logger.debug('[DAEMON RUN] Daemon lock file already held, another daemon is running');
    process.exit(configuration.isDaemonProcess ? 1 : 0);
  }

  // At this point we should be safe to startup the daemon:
  // 1. Not have a stale daemon state
  // 2. Should not have another daemon process running

  try {
    // Start caffeinate
    const caffeinateStarted = startCaffeinate();
    if (caffeinateStarted) {
      logger.debug('[DAEMON RUN] Sleep prevention enabled');
    }

    // Check if we need to authenticate before trying (headless environment cannot show auth UI)
    // Instead of exiting, we wait for credentials to appear (user runs `free auth login`)
    while (!(await hasCredentials())) {
      if (isHeadlessEnvironment()) {
        logger.info(
          '[DAEMON RUN] No credentials found. Waiting for authentication... (run "free auth login" in a terminal)'
        );
        // Wait 30 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 30_000));
      } else {
        // Interactive environment - can show auth UI
        break;
      }
    }

    // Ensure auth and machine registration BEFORE anything else
    const { credentials, machineId } = await authAndSetupMachineIfNeeded();
    logger.info('[DAEMON] Auth completed', {
      machineId,
      traceId: getProcessTraceContext()?.traceId,
    });

    // Session registry and IPC server (assigned after setup below)
    let sessionManager: SessionManager | undefined;
    let ipcServer: IPCServer | undefined;

    // Spawn a new session via IPC (CLI and direct internal calls).
    const ipcSpawnSession = async (
      opts: IPCSpawnSessionOptions
    ): Promise<IPCSpawnSessionResult> => {
      const agentType = opts.agent ?? 'claude';
      if (!AgentSessionFactory.isRegistered(agentType)) {
        return { type: 'error', error: `Unsupported agent type: '${agentType}'` };
      }

      // The mobile/server token is Claude-specific OAuth and must not override
      // Codex auth, which comes from local login or API-key environment vars.
      const authEnv = buildAgentAuthEnv(agentType, opts.token);
      const extraEnv = expandEnvironmentVariables(authEnv, process.env);

      // Strip daemon-internal secrets from the env passed to agent subprocesses.
      // Agent processes may be prompt-injected; they must not see daemon secrets.
      // User env (HTTP_PROXY, NODE_EXTRA_CA_CERTS, etc.) passes through unchanged.
      for (const key of DAEMON_SECRET_KEYS) {
        delete extraEnv[key];
      }

      // Fail-fast: ensure auth vars are fully expanded
      const potentialAuthVars = [
        'ANTHROPIC_AUTH_TOKEN',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'OPENAI_API_KEY',
        'CODEX_HOME',
        'AZURE_OPENAI_API_KEY',
        'TOGETHER_API_KEY',
      ];
      const unexpandedAuthVars = potentialAuthVars.filter(v => {
        const val = extraEnv[v];
        return val && typeof val === 'string' && val.includes('${');
      });
      if (unexpandedAuthVars.length > 0) {
        const details = unexpandedAuthVars.map(v => {
          const val = extraEnv[v];
          const m = val?.match(/\$\{([A-Z_][A-Z0-9_]*)(:-[^}]*)?\}/);
          return `${v} references \${${m ? m[1] : 'unknown'}} which is not defined`;
        });
        return {
          type: 'error',
          error: `Authentication will fail - environment variables not found in daemon: ${details.join('; ')}. Ensure these variables are set in the daemon's environment before starting sessions.`,
        };
      }

      try {
        const session = AgentSessionFactory.create(agentType, {
          credential: credentials,
          machineId,
          startedBy: opts.startedBy ?? 'cli',
          cwd: opts.directory,
          resumeSessionId: opts.resumeAgentSessionId,
          env: extraEnv,
          permissionMode: opts.permissionMode,
          model: opts.model,
          mode: opts.mode,
          startingMode: opts.startingMode,
          broadcast: (sid, msg) => ipcServer!.broadcast(sid, msg),
          daemonInstanceId,
        });

        await session.initialize();
        const sessionId = session.sessionId;
        sessionManager!.register(sessionId, session);

        // Fire and forget: run() manages the full session lifecycle
        session
          .run()
          .catch(err =>
            logger.error('[DAEMON RUN] Session run error', toError(err), {
              sessionId,
              agentType,
              machineId,
            })
          )
          .finally(() => sessionManager?.unregister(sessionId));

        logger.info('[DAEMON] Session spawned', {
          sessionId,
          agentType,
          machineId,
          cwd: opts.directory,
          startedBy: opts.startedBy ?? 'cli',
          model: opts.model,
          mode: opts.mode,
          traceId: getProcessTraceContext()?.traceId,
        });
        return { type: 'success', sessionId };
      } catch (error) {
        const msg = safeStringify(error);
        logger.error('[DAEMON] Session spawn failed', toError(error), {
          machineId,
          cwd: opts.directory,
          agentType,
          traceId: getProcessTraceContext()?.traceId,
        });
        return { type: 'error', error: msg };
      }
    };

    // Mobile RPC adapter: handles directory creation and env conversion, then delegates to ipcSpawnSession.
    const mobileSpawnSession = async (
      options: SpawnSessionOptions
    ): Promise<SpawnSessionResult> => {
      logger.debug('[DAEMON RUN] Mobile session spawn', {
        directory: options.directory,
        agent: options.agent,
        model: options.model,
        mode: options.mode,
        resumeAgentSessionId: options.resumeAgentSessionId,
      });

      // Ensure working directory exists
      try {
        await fs.access(options.directory);
      } catch {
        if (!options.approvedNewDirectoryCreation) {
          return { type: 'requestToApproveDirectoryCreation', directory: options.directory };
        }
        try {
          await fs.mkdir(options.directory, { recursive: true });
          logger.debug(`[DAEMON RUN] Created directory: ${options.directory}`);
        } catch (mkdirError: any) {
          let errorMessage = `Unable to create directory at '${options.directory}'. `;
          if (mkdirError.code === 'EACCES') {
            errorMessage += `Permission denied. You don't have write access to create a folder at this location. Try using a different path or check your permissions.`;
          } else if (mkdirError.code === 'ENOTDIR') {
            errorMessage += `A file already exists at this path or in the parent path. Cannot create a directory here. Please choose a different location.`;
          } else if (mkdirError.code === 'ENOSPC') {
            errorMessage += `No space left on device. Your disk is full. Please free up some space and try again.`;
          } else if (mkdirError.code === 'EROFS') {
            errorMessage += `The file system is read-only. Cannot create directories here. Please choose a writable location.`;
          } else {
            errorMessage += `System error: ${mkdirError.message || mkdirError}. Please verify the path is valid and you have the necessary permissions.`;
          }
          return { type: 'error', errorMessage };
        }
      }

      const result = await ipcSpawnSession({
        agent: options.agent,
        directory: options.directory,
        model: options.model,
        mode: options.mode,
        resumeAgentSessionId: options.resumeAgentSessionId,
        startedBy: options.startedBy ?? 'app',
        token: options.token,
        startingMode: 'remote',
      });

      if (result.type === 'success') {
        return { type: 'success', sessionId: result.sessionId };
      }
      return { type: 'error', errorMessage: result.error };
    };

    // Stop a session by ID (used by control server HTTP endpoint — fire-and-forget).
    const stopSession = (sessionId: string): boolean => {
      if (!sessionManager) return false;
      const session = sessionManager.get(sessionId);
      if (!session) {
        logger.debug(`[DAEMON RUN] Session ${sessionId} not found`);
        return false;
      }
      sessionManager
        .stop(sessionId)
        .catch(err => logger.error('[DAEMON RUN] Stop session error', toError(err)));
      return true;
    };

    // Create session manager and IPC server, wire up eviction callback
    sessionManager = new SessionManager(sessionId => ipcServer?.evictHistory(sessionId));

    // Tracks whether a version/hash-change restart is in progress.
    // Shared between heartbeat and orphan callback to suppress spawning headless CLI
    // when the daemon is about to exit.
    let restartInitiated = false;

    // Orphan session detection: when all CLI clients disconnect from a session,
    // wait 3s then spawn a headless CLI to re-attach (keeps agent alive & observable).
    // Per-session spawn counter prevents infinite respawn loops (headless CLI connects
    // then immediately disconnects → orphan callback fires again → repeat).
    const orphanSpawnCounts = new Map<string, number>();
    const MAX_ORPHAN_SPAWNS = 3;
    const onSessionOrphaned = (sessionId: string) => {
      setTimeout(() => {
        if (restartInitiated) {
          logger.debug('[DAEMON] orphan recheck: daemon restart in progress, skipping', {
            sessionId,
          });
          return;
        }
        const session = sessionManager?.get(sessionId);
        if (!session || session.shuttingDown) {
          logger.debug('[DAEMON] orphan recheck: session gone or shutting down', { sessionId });
          return;
        }
        if (ipcServer!.getAttachmentCount(sessionId) > 0) {
          logger.debug('[DAEMON] orphan recheck: session has clients again', { sessionId });
          return;
        }
        const spawnCount = orphanSpawnCounts.get(sessionId) ?? 0;
        if (spawnCount >= MAX_ORPHAN_SPAWNS) {
          logger.warn('[DAEMON] orphan spawn limit reached, giving up', { sessionId, spawnCount });
          return;
        }
        orphanSpawnCounts.set(sessionId, spawnCount + 1);
        logger.info('[DAEMON] orphan session detected, spawning headless CLI to re-attach', {
          sessionId,
          attempt: spawnCount + 1,
        });
        try {
          const child = spawnFreeCLI(['--attach-session', sessionId], {
            detached: true,
            stdio: 'ignore',
            env: process.env,
          });
          child.unref();
        } catch (err) {
          logger.error('[DAEMON] failed to spawn headless CLI for orphan session', toError(err), {
            sessionId,
          });
        }
      }, 3_000);
    };

    ipcServer = new IPCServer(sessionManager, ipcSpawnSession, onSessionOrphaned);
    await ipcServer.start(configuration.daemonSocketPath);
    logger.debug('[DAEMON RUN] IPC server started', { socketPath: configuration.daemonSocketPath });

    // Generate a per-run control token for HTTP API authentication
    const controlToken = randomBytes(32).toString('base64url');

    // Start control server
    const { port: controlPort, stop: stopControlServer } = await startDaemonControlServer({
      getSessions: () => (sessionManager?.list() ?? []).map(s => s.toSummary()),
      stopSession,
      spawnSession: mobileSpawnSession,
      requestShutdown: () => requestShutdown('free-cli'),
      controlToken,
    });

    // Write initial daemon state (no lock needed for state file)
    const buildMeta = readBuildMeta();
    const fileState: DaemonLocallyPersistedState = {
      pid: process.pid,
      httpPort: controlPort,
      controlToken,
      startTime: new Date().toLocaleString(),
      startedWithCliVersion: packageJson.version,
      buildHash: buildMeta.hash,
      buildTime: buildMeta.time,
      daemonLogPath: getCollector().getLogFilePath() ?? '',
    };
    writeDaemonState(fileState);
    logger.debug('[DAEMON RUN] Daemon state written');

    // Prepare initial daemon state
    const initialDaemonState: DaemonState = {
      status: 'offline',
      pid: process.pid,
      httpPort: controlPort,
      startedAt: Date.now(),
    };

    // Create API client
    const api = await ApiClient.create(credentials);

    // Get or create machine
    const machine = await api.getOrCreateMachine({
      machineId,
      metadata: initialMachineMetadata,
      daemonState: initialDaemonState,
    });
    logger.debug(`[DAEMON RUN] Machine registered: ${machine.id}`);

    // Create realtime machine session
    const apiMachine = api.machineSyncClient(machine);

    // Set RPC handlers
    apiMachine.setRPCHandlers({
      spawnSession: mobileSpawnSession,
      stopSession,
      listSupportedAgents: () => AgentSessionFactory.listRegistered(),
      requestShutdown: () => requestShutdown('free-app'),
    });

    // Connect to server
    apiMachine.connect();
    logger.info('[DAEMON] Machine connecting to server', {
      machineId,
      serverUrl: configuration.serverUrl,
      traceId: getProcessTraceContext()?.traceId,
    });

    // ---------------------------------------------------------------------------
    // Session recovery — restore sessions persisted by a previous daemon instance
    // ---------------------------------------------------------------------------
    {
      const persisted = await readAllPersistedSessions();
      // Recover sessions from any previous daemon instance.
      // daemonInstanceId is a UUID — no PID reuse ambiguity.
      const hasRecoverable = persisted.some(d => d.daemonInstanceId !== daemonInstanceId);
      logger.info('[DAEMON] Session recovery scan', {
        persistedTotal: persisted.length,
        hasRecoverable,
        daemonInstanceId,
        sessionIds: persisted.map(d => d.sessionId),
      });
      if (hasRecoverable) ipcServer!.beginRecovery();
      let recoveredCount = 0;
      for (const data of persisted) {
        if (data.daemonInstanceId === daemonInstanceId) continue; // ours, skip

        try {
          logger.info('[DAEMON] Recovering session', {
            sessionId: data.sessionId,
            agentType: data.agentType,
            cwd: data.cwd,
            resumeSessionId: data.resumeSessionId,
            startingMode: data.startingMode,
            createdAt: new Date(data.createdAt).toISOString(),
            previousDaemonInstanceId: data.daemonInstanceId,
          });
          const session = AgentSessionFactory.create(data.agentType, {
            credential: credentials,
            machineId,
            startedBy: 'daemon',
            cwd: data.cwd,
            resumeSessionId: data.resumeSessionId,
            sessionId: data.sessionId,
            permissionMode: data.permissionMode,
            model: data.model,
            mode: data.mode,
            startingMode: data.startingMode,
            env: data.env,
            broadcast: (sid: string, msg: any) => ipcServer!.broadcast(sid, msg),
            daemonInstanceId,
            lastSeq: data.lastSeq,
          });

          await session.initialize();

          // If server assigned a new sessionId (e.g. old session was cleaned up), map the old one
          // and erase the stale persisted file (initialize() already wrote a new one with the new ID).
          if (session.sessionId !== data.sessionId) {
            ipcServer!.addSessionIdMapping(data.sessionId, session.sessionId);
            await erasePersistedSession(data.sessionId);
            logger.info('[DAEMON] Session ID changed after recovery', {
              oldId: data.sessionId,
              newId: session.sessionId,
            });
          }

          sessionManager!.register(session.sessionId, session);
          session
            .run()
            .catch(err =>
              logger.error('[DAEMON] Recovered session run error', toError(err), {
                sessionId: session.sessionId,
              })
            )
            .finally(() => sessionManager?.unregister(session.sessionId));

          recoveredCount++;
        } catch (err) {
          logger.error('[DAEMON] Session recovery failed', toError(err), {
            sessionId: data.sessionId,
            agentType: data.agentType,
          });
          await erasePersistedSession(data.sessionId);
        }
      }
      if (hasRecoverable) ipcServer!.endRecovery();
      if (recoveredCount > 0) {
        logger.info('[DAEMON] Session recovery complete', {
          recovered: recoveredCount,
          total: persisted.length,
        });
      }
    }

    // Fallback sync: poll account settings every 5 minutes as backup for header sync
    // Primary sync is via X-Analytics-Enabled header on all API responses
    // This is just a safety net in case header sync fails for any reason
    const FALLBACK_SYNC_INTERVAL_MS = 5 * 60_000; // 5 minutes
    let fallbackSyncRunning = false;
    const fallbackSyncAccountSettings = async () => {
      if (fallbackSyncRunning) return;
      fallbackSyncRunning = true;

      try {
        const accountSettings = await api.getAccountSettings();
        if (accountSettings?.settings) {
          try {
            const serverSettings = JSON.parse(accountSettings.settings);
            if (typeof serverSettings.analyticsEnabled === 'boolean') {
              const localSettings = await readSettings();
              if (localSettings.analyticsEnabled !== serverSettings.analyticsEnabled) {
                logger.debug('[DAEMON] Fallback sync: updating analyticsEnabled', {
                  local: localSettings.analyticsEnabled,
                  server: serverSettings.analyticsEnabled,
                });
                await updateSettings(s => ({
                  ...s,
                  analyticsEnabled: serverSettings.analyticsEnabled,
                }));
              }
            }
          } catch {
            logger.debug('[DAEMON] Failed to parse account settings in fallback sync');
          }
        }
      } catch (error) {
        logger.debug('[DAEMON] Fallback sync failed:', error);
      } finally {
        fallbackSyncRunning = false;
      }
    };

    // Initial sync on startup
    await fallbackSyncAccountSettings();

    // Setup periodic fallback sync
    const fallbackSyncInterval = setInterval(
      fallbackSyncAccountSettings,
      FALLBACK_SYNC_INTERVAL_MS
    );

    // Every 60 seconds:
    // 1. Check if daemon needs update
    // 2. If outdated, gracefully stop all sessions then restart
    // 3. Write heartbeat
    const heartbeatIntervalMs = parseInt(process.env.FREE_DAEMON_HEARTBEAT_INTERVAL || '60000');
    let heartbeatRunning = false;
    let heartbeatStartTime = 0;
    const HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes timeout
    const restartOnStaleVersionAndHeartbeat = setInterval(async () => {
      if (heartbeatRunning) {
        // Check if heartbeat has been running too long (stuck)
        if (heartbeatStartTime > 0 && Date.now() - heartbeatStartTime > HEARTBEAT_TIMEOUT_MS) {
          logger.debug('[DAEMON RUN] Heartbeat stuck for too long, forcing reset');
          heartbeatRunning = false;
          heartbeatStartTime = 0;
        }
        return;
      }
      heartbeatRunning = true;
      heartbeatStartTime = Date.now();

      logger.debug(`[DAEMON RUN] Health check started at ${new Date().toLocaleString()}`);

      // Check if daemon needs update
      // If version on disk is different from the one in package.json - we need to restart
      const projectVersion = JSON.parse(
        readFileSync(join(projectPath(), 'package.json'), 'utf-8')
      ).version;
      if (projectVersion !== configuration.currentCliVersion) {
        // Guard against concurrent heartbeats both triggering restart
        if (restartInitiated) return;
        restartInitiated = true;

        logger.debug(
          '[DAEMON RUN] Daemon is outdated, triggering self-restart with latest version'
        );
        logger.debug(
          `[DAEMON RUN] Version change: ${configuration.currentCliVersion} -> ${projectVersion}`
        );

        clearInterval(restartOnStaleVersionAndHeartbeat);

        // Wait for all agents to finish their current turn before restarting.
        // Version updates are not urgent — avoid losing in-flight responses.
        if (sessionManager) {
          const activeSessions = sessionManager.list();
          const busySessions = activeSessions.filter(s => s.isWorking);
          if (busySessions.length > 0) {
            logger.info(
              '[DAEMON RUN] Waiting for busy sessions to finish current turn before restart',
              {
                busyCount: busySessions.length,
                busySessionIds: busySessions.map(s => s.sessionId),
              }
            );
            const WAIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max wait
            const POLL_INTERVAL_MS = 1000;
            const deadline = Date.now() + WAIT_TIMEOUT_MS;
            while (Date.now() < deadline) {
              const stillBusy = activeSessions.filter(s => s.isWorking);
              if (stillBusy.length === 0) break;
              await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            }
            const timedOut = activeSessions.filter(s => s.isWorking);
            if (timedOut.length > 0) {
              logger.warn(
                '[DAEMON RUN] Timed out waiting for sessions to finish, proceeding with restart',
                {
                  timedOutCount: timedOut.length,
                  timedOutSessionIds: timedOut.map(s => s.sessionId),
                }
              );
            } else {
              logger.info(
                '[DAEMON RUN] All sessions finished current turn, proceeding with restart'
              );
            }
          }

          // Flush all outbox messages to the server before stopping backends.
          if (activeSessions.length > 0) {
            logger.info('[DAEMON RUN] Flushing outbox for all sessions before restart');
            await Promise.allSettled(activeSessions.map(s => s.flushOutbox()));
          }

          // Stop agent backends but keep persisted state for recovery by the new daemon.
          // We do NOT call session.shutdown() here (which would delete persisted files).
          if (activeSessions.length > 0) {
            const sessionIds = activeSessions.map(s => s.sessionId);
            logger.info('[DAEMON RUN] Suspending sessions for recovery after restart', {
              count: activeSessions.length,
              sessionIds,
            });
            const results = await Promise.allSettled(activeSessions.map(s => s.stopBackend()));
            const failed = results.filter(r => r.status === 'rejected').length;
            logger.info('[DAEMON RUN] Backend suspend complete', {
              total: activeSessions.length,
              succeeded: activeSessions.length - failed,
              failed,
            });
          }
        }

        // Spawn new daemon through the CLI
        try {
          spawnFreeCLI(['daemon', 'start'], {
            detached: true,
            stdio: 'ignore',
            env: process.env,
          });
        } catch (error) {
          logger.debug(
            '[DAEMON RUN] Failed to spawn new daemon, this is quite likely to happen during integration tests as we are cleaning out dist/ directory',
            error
          );
        }

        logger.info('[DAEMON RUN] Daemon restart initiated, exiting');
        await shutdownTelemetry();
        process.exit(0);
      }

      // Before wrecklessly overriting the daemon state file, we should check if we are the ones who own it
      // Race condition is possible, but thats okay for the time being :D
      const daemonState = await readDaemonState();
      if (daemonState && daemonState.pid !== process.pid) {
        logger.debug(
          '[DAEMON RUN] Somehow a different daemon was started without killing us. We should kill ourselves.'
        );
        requestShutdown(
          'exception',
          'A different daemon was started without killing us. We should kill ourselves.'
        );
      }

      // Memory metrics — daemon + all child processes, guarded by analytics opt-in.
      if (isAnalyticsEnabledSync()) {
        const mem = process.memoryUsage();
        const sessions = sessionManager?.list() ?? [];

        logger.debug('[DAEMON RUN] mem_metrics:daemon', {
          pid: process.pid,
          rssKB: Math.round(mem.rss / 1024),
          heapUsedKB: Math.round(mem.heapUsed / 1024),
          heapTotalKB: Math.round(mem.heapTotal / 1024),
          externalKB: Math.round(mem.external / 1024),
          arrayBuffersKB: Math.round(mem.arrayBuffers / 1024),
          activeSessions: sessions.length,
        });

        // Collect child process memory async (non-blocking, fire-and-forget).
        const pidToSessionId = new Map<number, string>();
        for (const s of sessions) {
          if (s.childPid) pidToSessionId.set(s.childPid, s.sessionId);
        }
        getChildProcStats(process.pid, pidToSessionId)
          .then(children => {
            if (children.length > 0) {
              logger.debug('[DAEMON RUN] mem_metrics:children', { children });
            }
          })
          .catch(() => {
            /* non-critical, ignore */
          });
      }

      // Heartbeat
      try {
        const updatedState: DaemonLocallyPersistedState = {
          pid: process.pid,
          httpPort: controlPort,
          controlToken,
          startTime: fileState.startTime,
          startedWithCliVersion: packageJson.version,
          lastHeartbeat: new Date().toLocaleString(),
          buildHash: readBuildHash(),
          daemonLogPath: fileState.daemonLogPath,
        };
        writeDaemonState(updatedState);
        logger.debug(`[DAEMON RUN] Health check completed at ${updatedState.lastHeartbeat}`);
      } catch (error) {
        logger.debug('[DAEMON RUN] Failed to write heartbeat', error);
      }

      heartbeatRunning = false;
      heartbeatStartTime = 0;
    }, heartbeatIntervalMs); // Every 60 seconds in production

    // Setup signal handlers
    const cleanupAndShutdown = async (
      source: 'free-app' | 'free-cli' | 'os-signal' | 'exception',
      errorMessage?: string
    ) => {
      logger.debug(
        `[DAEMON RUN] Starting proper cleanup (source: ${source}, errorMessage: ${errorMessage})...`
      );

      // Cancel the force-exit fallback timer now that graceful shutdown is running
      clearShutdownFallback?.();

      // Clear health check interval
      if (restartOnStaleVersionAndHeartbeat) {
        clearInterval(restartOnStaleVersionAndHeartbeat);
        logger.debug('[DAEMON RUN] Health check interval cleared');
      }

      // Clear fallback sync interval
      if (fallbackSyncInterval) {
        clearInterval(fallbackSyncInterval);
        logger.debug('[DAEMON RUN] Fallback sync interval cleared');
      }

      // Signal all sessions to shut down gracefully.
      // handleSigterm sets pendingExit=true → shutdown() will keep persisted files
      // so the next daemon can recover them.
      if (sessionManager) {
        sessionManager.handleSigterm();
        logger.info(
          '[DAEMON RUN] Session manager sigterm sent, persisted files kept for recovery',
          {
            count: sessionManager.list().length,
            sessionIds: sessionManager.list().map(s => s.sessionId),
          }
        );
      }

      // Update daemon state before shutting down
      await apiMachine.updateDaemonState((state: DaemonState | null) => ({
        ...state,
        status: 'shutting-down',
        shutdownRequestedAt: Date.now(),
        shutdownSource: source,
      }));

      // Give time for metadata update to send
      await new Promise(resolve => setTimeout(resolve, 100));

      apiMachine.shutdown();
      ipcServer?.stop();
      await stopControlServer();
      await cleanupDaemonState();
      await stopCaffeinate();
      await releaseDaemonLock(daemonLockHandle);

      logger.info('[DAEMON RUN] Cleanup completed, exiting process');
      await shutdownTelemetry();
      process.exit(0);
    };

    logger.info('[DAEMON RUN] Daemon started successfully, waiting for shutdown request');

    // Wait for shutdown request
    const shutdownRequest = await resolvesWhenShutdownRequested;
    await cleanupAndShutdown(shutdownRequest.source, shutdownRequest.errorMessage);
  } catch (error) {
    const errorMessage = safeStringify(error);
    logger.error('[DAEMON] Fatal error', toError(error));

    // Release lock if we hold it
    if (daemonLockHandle) {
      await releaseDaemonLock(daemonLockHandle);
    }

    // Clean up daemon state file if it exists
    await cleanupDaemonState();

    // Show user-friendly message for auth errors
    if (errorMessage.includes('No credentials found')) {
      console.log('\n' + errorMessage);
      console.log('\nThe daemon service will retry automatically after you authenticate.\n');
    }

    process.exit(1);
  }
}
