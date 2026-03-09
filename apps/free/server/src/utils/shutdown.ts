import { Logger } from '@agentbridge/core/telemetry';

const log = new Logger('utils/shutdown');

const shutdownHandlers = new Map<string, Array<() => Promise<void>>>();
const shutdownController = new AbortController();

export const shutdownSignal = shutdownController.signal;

let shutdownTriggered = false;
let shutdownResolve: (() => void) | null = null;

export function onShutdown(name: string, callback: () => Promise<void>): () => void {
  if (shutdownSignal.aborted) {
    // If already shutting down, execute immediately
    callback();
    return () => {};
  }

  if (!shutdownHandlers.has(name)) {
    shutdownHandlers.set(name, []);
  }
  const handlers = shutdownHandlers.get(name)!;
  handlers.push(callback);

  // Return unsubscribe function
  return () => {
    const index = handlers.indexOf(callback);
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

  // Copy handlers to avoid race conditions
  const handlersSnapshot = new Map<string, Array<() => Promise<void>>>();
  for (const [name, handlers] of shutdownHandlers) {
    handlersSnapshot.set(name, [...handlers]);
  }

  // Execute all shutdown handlers concurrently
  const allHandlers: Promise<void>[] = [];
  let totalHandlers = 0;

  for (const [name, handlers] of handlersSnapshot) {
    totalHandlers += handlers.length;
    log.info(`Starting ${handlers.length} shutdown handlers for: ${name}`);

    handlers.forEach((handler, index) => {
      const handlerPromise = handler().then(
        () => {},
        error => log.error(`Error in shutdown handler ${name}[${index}]`, error)
      );
      allHandlers.push(handlerPromise);
    });
  }

  if (totalHandlers > 0) {
    log.info(`Waiting for ${totalHandlers} shutdown handlers to complete...`);
    const startTime = Date.now();
    await Promise.all(allHandlers);
    const duration = Date.now() - startTime;
    log.info(`All ${totalHandlers} shutdown handlers completed in ${duration}ms`);
  }
}

export async function keepAlive<T>(name: string, callback: () => Promise<T>): Promise<T> {
  let completed = false;
  let result: T;
  let error: any;

  const promise = new Promise<void>(resolve => {
    const unsubscribe = onShutdown(`keepAlive:${name}`, async () => {
      if (!completed) {
        log.info(`Waiting for keepAlive operation to complete: ${name}`);
        await promise;
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
