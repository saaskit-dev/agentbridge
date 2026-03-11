/**
 * Per-request / per-socket-event trace context propagation via AsyncLocalStorage.
 *
 * How it works:
 *   - HTTP:      Fastify onRequest hook calls runWithTrace(ctx, done) before routing
 *   - Socket.IO: socket.use() middleware calls runWithTrace(ctx, next) before handlers
 *   - Logger:    setGlobalContextProvider(getCurrentTrace) registered at startup
 *
 * Result: every Logger call inside a request/socket handler automatically carries
 * the traceId without any code changes in business logic.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TraceContext } from '@saaskit-dev/agentbridge/telemetry';

const storage = new AsyncLocalStorage<TraceContext>();

/**
 * Run fn within the given trace context.
 * All async continuations (await, process.nextTick, timers) spawned inside fn
 * inherit this context automatically via Node.js async_hooks.
 */
export function runWithTrace<T>(ctx: TraceContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Get the trace context active in the current async execution context.
 * Returns undefined when called outside of a runWithTrace() scope.
 */
export function getCurrentTrace(): TraceContext | undefined {
  return storage.getStore();
}
