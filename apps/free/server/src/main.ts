import { createRequire } from 'module';
import { homedir } from 'os';
import { join } from 'path';
import { auth } from './app/auth/auth';
import { startTimeout } from './app/presence/timeout';
import { initEncrypt } from './modules/encrypt';
import { initGithub } from './modules/github';
import { db, closePGlite } from './storage/db';
import { loadFiles } from './storage/files';
import { startApi } from '@/app/api/api';
import { startDatabaseMetricsUpdater } from '@/app/monitoring/metrics2';
import { activityCache } from '@/app/presence/sessionCache';
import {
  Logger,
  getCollector,
  isCollectorReady,
  initTelemetry,
  RemoteSink,
  NewRelicBackend,
  setGlobalContextProvider,
  type LogSink,
} from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify, toError } from '@saaskit-dev/agentbridge';
import { getCurrentTrace } from './utils/requestTrace';
import { FileSink, cleanupOldLogs } from '@saaskit-dev/agentbridge/telemetry/node';
import { shutdownRelay } from '@/utils/telemetryRelay';
import { awaitShutdown, onShutdown, triggerShutdown, isShuttingDown } from '@/utils/shutdown';

// ─── Telemetry initialization ────────────────────────────────────────────────

function getServerVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return require('../package.json').version || 'unknown';
  } catch {
    return process.env.npm_package_version || 'unknown';
  }
}

function getLogsDir(): string {
  const freeHomeDir = process.env.FREE_HOME_DIR
    ? process.env.FREE_HOME_DIR.replace(/^~/, homedir())
    : join(homedir(), '.free');
  return join(freeHomeDir, 'logs');
}

const logsDir = getLogsDir();

const sinks: LogSink[] = [
  new FileSink({
    dir: logsDir,
    prefix: 'server',
    bufferFlushMs: 100,
  }),
];

const nrLicenseKey = process.env.NEW_RELIC_LICENSE_KEY;
if (nrLicenseKey) {
  sinks.push(
    new RemoteSink({
      backend: new NewRelicBackend({
        licenseKey: nrLicenseKey,
        region: (process.env.NEW_RELIC_REGION as 'us' | 'eu') || 'us',
      }),
      metadata: {
        deviceId: `server-${process.pid}`,
        appVersion: getServerVersion(),
        layer: 'server',
      },
    })
  );
}

initTelemetry({
  layer: 'server',
  sinks,
  minLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'debug',
  sanitize: process.env.APP_ENV !== 'development',
  // RFC §17.10: throttle high-frequency streaming events (text_delta fires 10-50x/sec)
  // text_complete and thinking_delta are infrequent so they remain at the global level.
  componentLevels: {
    'app/api/socket/streamingHandler': 'warn',
  },
});

setImmediate(() => cleanupOldLogs({ dir: logsDir }));

// Wire per-request/per-socket trace context into all Logger calls
setGlobalContextProvider(getCurrentTrace);

// ─── Logger ──────────────────────────────────────────────────────────────────

const log = new Logger('main');

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Storage
  await db.$connect();
  onShutdown('db', async () => {
    await closePGlite(); // Properly close PGLite to prevent corruption
  });
  onShutdown('activity-cache', async () => {
    activityCache.shutdown();
  });
  onShutdown('telemetry', async () => {
    if (isCollectorReady()) await getCollector().close();
  });
  onShutdown('telemetry-relay', shutdownRelay);

  // Initialize auth module
  await initEncrypt();
  await initGithub();
  await loadFiles();
  await auth.init();

  //
  // Start
  //

  await startApi();
  startDatabaseMetricsUpdater();
  startTimeout();

  //
  // Ready
  //

  log.info('Ready');
  await awaitShutdown();
  log.info('Shutting down...');
}

// Process-level error handling
let processExitScheduled = false;

async function gracefulExit(reason: string): Promise<void> {
  if (processExitScheduled || isShuttingDown()) {
    return;
  }
  processExitScheduled = true;

  log.error(`Graceful exit triggered: ${reason}`);

  // Trigger shutdown handlers
  triggerShutdown();

  // Force exit after 5 seconds if cleanup hangs
  setTimeout(() => {
    log.error('Forcing exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('uncaughtException', error => {
  log.error(`Uncaught Exception: ${error.message}`);
  log.error('Uncaught Exception (full):', error);
  gracefulExit('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  const errorMsg = safeStringify(reason);
  log.error(`Unhandled Rejection: ${errorMsg}`);
  log.error('Unhandled Rejection (full):', toError(reason));
  gracefulExit('unhandledRejection');
});

process.on('warning', warning => {
  log.warn(`Process Warning: ${warning.message}`);
});

// Log when the process is about to exit
process.on('exit', code => {
  if (code !== 0) {
    log.error(`Process exiting with code: ${code}`);
  } else {
    log.info('Process exiting normally', { exitCode: code });
  }
});

main()
  .catch(e => {
    log.error('main() fatal error:', toError(e));
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
