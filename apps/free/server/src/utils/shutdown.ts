import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const log = new Logger('utils/shutdown');

/**
 * Shutdown phases — lower numbers run first.
 * Phase 0: Network (close listeners, disconnect clients)
 * Phase 1: Application (background loops, caches, telemetry flush)
 * Phase 2: Storage (database)
 */
export const SHUTDOWN_PHASE = { NETWORK: 0, APP: 1, STORAGE: 2 } as const;

interface HandlerEntry {
  phase: number;
  callback: () => Promise<void>;
}

const shutdownHandlers = new Map<string, HandlerEntry[]>();
const shutdownController = new AbortController();

export const shutdownSignal = shutdownController.signal;

let shutdownTriggered = false;
let shutdownResolve: (() => void) | null = null;

export function onShutdown(
  name: string,
  callback: () => Promise<void>,
  phase: number = SHUTDOWN_PHASE.APP
): () => void {
  if (shutdownSignal.aborted) {
    // If already shutting down, execute immediately
    callback();
    return () => {};
  }

  if (!shutdownHandlers.has(name)) {
    shutdownHandlers.set(name, []);
  }
  const handlers = shutdownHandlers.get(name)!;
  const entry: HandlerEntry = { phase, callback };
  handlers.push(entry);

  // Return unsubscribe function
  return () => {
    const index = handlers.indexOf(entry);
    if (index !== -1) {
      handlers.splice(index, 1);
      if (handlers.length === 0) {
        shutdownHandlers.delete(name);
      }
    }
  };
}

export function isShutdown() {
  return shutdownSignal.aborted;
}

/**
 * Check if shutdown has been triggered
 */
export function isShuttingDown(): boolean {
  return shutdownTriggered;
}

/**
 * Trigger a graceful shutdown programmatically
 * Can be called from exception handlers or other error scenarios
 */
export function triggerShutdown(): void {
  if (shutdownTriggered) {
    return;
  }
  shutdownTriggered = true;
  shutdownController.abort();

  if (shutdownResolve) {
    shutdownResolve();
  }
}

export async function awaitShutdown() {
  const shutdownPromise = new Promise<void>(resolve => {
    shutdownResolve = resolve;

    process.on('SIGINT', async () => {
      log.info('Received SIGINT signal. Exiting...');
      triggerShutdown();
    });
    process.on('SIGTERM', async () => {
      log.info('Received SIGTERM signal. Exiting...');
      triggerShutdown();
    });
  });

  await shutdownPromise;
  shutdownController.abort();

  // Snapshot and group handlers by phase
  const byPhase = new Map<
    number,
    Array<{ name: string; index: number; callback: () => Promise<void> }>
  >();
  for (const [name, entries] of shutdownHandlers) {
    for (let i = 0; i < entries.length; i++) {
      const { phase, callback } = entries[i];
      if (!byPhase.has(phase)) byPhase.set(phase, []);
      byPhase.get(phase)!.push({ name, index: i, callback });
    }
  }

  // Run phases sequentially (lower phase first), handlers within a phase concurrently
  const phases = [...byPhase.keys()].sort((a, b) => a - b);
  const overallStart = Date.now();
  let totalHandlers = 0;

  for (const phase of phases) {
    const handlers = byPhase.get(phase)!;
    totalHandlers += handlers.length;
    const names = handlers.map(h => h.name).join(', ');
    log.info(`Phase ${phase}: running ${handlers.length} handlers [${names}]`);

    const phaseStart = Date.now();
    await Promise.all(
      handlers.map(h => {
        const handlerStart = Date.now();
        return h.callback().then(
          () => log.info(`Phase ${phase} handler done: ${h.name} (${Date.now() - handlerStart}ms)`),
          error =>
            log.error(
              `Phase ${phase} handler error: ${h.name} (${Date.now() - handlerStart}ms)`,
              error
            )
        );
      })
    );
    log.info(`Phase ${phase} completed in ${Date.now() - phaseStart}ms`);
  }

  if (totalHandlers > 0) {
    log.info(`All ${totalHandlers} shutdown handlers completed in ${Date.now() - overallStart}ms`);
  }
}

export async function keepAlive<T>(name: string, callback: () => Promise<T>): Promise<T> {
  let completed = false;
  let result: T;
  let error: any;

  const promise = new Promise<void>(resolve => {
    const unsubscribe = onShutdown(`keepAlive:${name}`, async () => {
      if (!completed) {
        log.info(`[keepAlive] waiting for: ${name}`);
        await promise;
        log.info(`[keepAlive] completed: ${name}`);
      }
    });

    // Run the callback
    callback().then(
      res => {
        result = res;
        completed = true;
        unsubscribe();
        resolve();
      },
      err => {
        error = err;
        completed = true;
        unsubscribe();
        resolve();
      }
    );
  });

  // Wait for completion
  await promise;

  if (error) {
    throw error;
  }

  return result!;
}
