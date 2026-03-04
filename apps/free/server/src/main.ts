import { auth } from './app/auth/auth';
import { startTimeout } from './app/presence/timeout';
import { initEncrypt } from './modules/encrypt';
import { initGithub } from './modules/github';
import { db, closePGlite } from './storage/db';
import { loadFiles } from './storage/files';
import { startApi } from '@/app/api/api';
import { startDatabaseMetricsUpdater } from '@/app/monitoring/metrics2';
import { activityCache } from '@/app/presence/sessionCache';
import { log } from '@/utils/log';
import { awaitShutdown, onShutdown, triggerShutdown, isShuttingDown } from '@/utils/shutdown';

async function main() {
  // Storage
  await db.$connect();
  onShutdown('db', async () => {
    await closePGlite(); // Properly close PGLite to prevent corruption
  });
  onShutdown('activity-cache', async () => {
    activityCache.shutdown();
  });

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

  log('Ready');
  await awaitShutdown();
  log('Shutting down...');
}

// Process-level error handling
let processExitScheduled = false;

async function gracefulExit(reason: string, error?: Error): Promise<void> {
  if (processExitScheduled || isShuttingDown()) {
    return;
  }
  processExitScheduled = true;

  log(
    {
      module: 'process-error',
      level: 'error',
      stack: error?.stack,
      name: error?.name,
    },
    `Graceful exit triggered: ${reason}`
  );

  // Trigger shutdown handlers
  triggerShutdown();

  // Force exit after 5 seconds if cleanup hangs
  setTimeout(() => {
    log(
      {
        module: 'process-error',
        level: 'error',
      },
      'Forcing exit after timeout'
    );
    process.exit(1);
  }, 5000);
}

process.on('uncaughtException', error => {
  log(
    {
      module: 'process-error',
      level: 'error',
      stack: error.stack,
      name: error.name,
    },
    `Uncaught Exception: ${error.message}`
  );

  console.error('Uncaught Exception:', error);
  gracefulExit('uncaughtException', error);
});

process.on('unhandledRejection', (reason, promise) => {
  const errorMsg = reason instanceof Error ? reason.message : String(reason);
  const errorStack = reason instanceof Error ? reason.stack : undefined;

  log(
    {
      module: 'process-error',
      level: 'error',
      stack: errorStack,
      reason: String(reason),
    },
    `Unhandled Rejection: ${errorMsg}`
  );

  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  const error = reason instanceof Error ? reason : new Error(String(reason));
  gracefulExit('unhandledRejection', error);
});

process.on('warning', warning => {
  log(
    {
      module: 'process-warning',
      level: 'warn',
      name: warning.name,
      stack: warning.stack,
    },
    `Process Warning: ${warning.message}`
  );
});

// Log when the process is about to exit
process.on('exit', code => {
  if (code !== 0) {
    log(
      {
        module: 'process-exit',
        level: 'error',
        exitCode: code,
      },
      `Process exiting with code: ${code}`
    );
  } else {
    log(
      {
        module: 'process-exit',
        level: 'info',
        exitCode: code,
      },
      'Process exiting normally'
    );
  }
});

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
