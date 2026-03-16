/**
 * CLI/Daemon telemetry initialization
 *
 * Initializes the unified telemetry system with:
 * - FileSink: always on, local JSONL files (the guaranteed fallback)
 * - RemoteSink + ServerRelayBackend: sends batched logs to our server,
 *   which relays them to New Relic. Auth token is resolved lazily —
 *   entries buffer until the user authenticates.
 * - Analytics can be disabled by user via `free analytics off` command
 * - Analytics sync via X-Analytics-Enabled header from server responses
 */

import { existsSync, readFileSync } from 'node:fs';
import { configuration } from '@/configuration';
import {
  initTelemetry,
  getCollector,
  isCollectorReady,
  RemoteSink,
  ServerRelayBackend,
  continueTrace,
  createTrace,
  setGlobalContextProvider,
  type TraceContext,
} from '@saaskit-dev/agentbridge/telemetry';
import { getLoggedInUserIdSync } from '@/persistence';
import { FileSink, cleanupOldLogs } from '@saaskit-dev/agentbridge/telemetry/node';
import { isAnalyticsEnabledSync } from '@/api/analyticsHeaderSync';
// Install axios interceptor to sync analyticsEnabled from server responses
import '@/api/analyticsHeaderSync';

let initialized = false;
/** Inherited from parent daemon process (stays constant for the lifetime of the cli process). */
let processTraceCtx: TraceContext | undefined;
/** Updated per user message turn — takes priority over processTraceCtx. */
let currentTurnTrace: TraceContext | undefined;

/**
 * Returns the most-specific trace context available:
 * - currentTurnTrace (per user message) if set
 * - processTraceCtx (per spawned session process) as fallback
 */
export function getProcessTraceContext(): TraceContext | undefined {
  return currentTurnTrace ?? processTraceCtx;
}

/**
 * Called by apiSession when a new user message arrives carrying a _trace field.
 * All subsequent log calls in this process will use this trace context.
 */
export function setCurrentTurnTrace(ctx: TraceContext | undefined): void {
  currentTurnTrace = ctx;
}

export function initCliTelemetry(): void {
  if (initialized) return;
  initialized = true;

  const layer = configuration.isDaemonProcess ? 'daemon' : 'cli';

  const sinks = [];

  // File sink — sync mode (bufferFlushMs=0) for CLI/daemon
  // This is the guaranteed local fallback — always writes regardless of network
  sinks.push(
    new FileSink({
      dir: configuration.logsDir,
      prefix: layer,
      bufferFlushMs: 0,
    })
  );

  // Remote sink via server relay
  // Auth token is lazy: before login, buildRequest returns null and entries buffer.
  // After login, buffered entries flush on the next cycle (every 30s).
  // If user never authenticates (e.g. --version), entries stay in buffer
  // and get silently dropped on exit — local file already has them.
  sinks.push(
    new RemoteSink({
      backend: new ServerRelayBackend({
        serverUrl: configuration.serverUrl,
        authToken: () => readAuthToken(),
      }),
      metadata: {
        deviceId: getMachineId(),
        appVersion: configuration.currentCliVersion,
        layer,
      },
    })
  );

  initTelemetry({
    layer,
    sinks,
    minLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'debug',
    sanitize: process.env.APP_ENV !== 'development',
  });

  // Wire global trace context provider so all Logger instances in this process
  // automatically pick up the current turn's trace context without explicit withContext() calls.
  setGlobalContextProvider(getProcessTraceContext);

  // Non-blocking log cleanup — 7-day / 500 MB retention
  setImmediate(() => cleanupOldLogs({ dir: configuration.logsDir }));

  const userId = getLoggedInUserIdSync();

  // If spawned as a child of the daemon, inherit the trace context.
  const envTraceId = process.env.FREE_TRACE_ID;
  const envSpanId = process.env.FREE_SPAN_ID;
  if (envTraceId && envSpanId) {
    processTraceCtx = continueTrace({
      traceId: envTraceId,
      spanId: envSpanId,
      sessionId: process.env.FREE_SESSION_ID || undefined,
      machineId: process.env.FREE_MACHINE_ID || undefined,
      userId,
    });
  } else {
    // Standalone CLI process — create a fresh trace context with userId.
    processTraceCtx = createTrace({ userId });
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!isCollectorReady()) return;
  await getCollector().close();
}

function getMachineId(): string {
  return `${process.platform}-${process.pid}`;
}

/**
 * Read auth token for telemetry upload.
 * Returns undefined if:
 * - User is not logged in (no credentials file)
 * - User has opted out of analytics (analyticsEnabled=false)
 */
function readAuthToken(): string | undefined {
  try {
    // Check if user has opted out of analytics (synced from server via header)
    if (!isAnalyticsEnabledSync()) return undefined;

    if (!existsSync(configuration.privateKeyFile)) return undefined;
    const data = JSON.parse(readFileSync(configuration.privateKeyFile, 'utf8'));
    return data.token;
  } catch {
    return undefined;
  }
}
