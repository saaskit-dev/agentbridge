# RFC-001: Unified Telemetry System

- **Status**: Implemented ✅（全部 Phase 完成，139/139 测试通过）
- **Created**: 2026-03-06
- **Implemented**: 2026-03-08
- **Author**: AgentBridge Team
- **Package**: `@agentbridge/core/telemetry`

---

## 1. Motivation

### 1.1 Problem Statement

A single user message traverses 4 layers before a response returns:

```
App -> Server -> CLI -> Agent -> CLI -> Server -> App
```

(Note: The Daemon manages CLI process lifecycle but is NOT in the message path. See Section 17.1 for details.)

When something goes wrong (a message never arrives, a permission request hangs, a session fails to create), there is **no way to trace what happened**. The three existing log systems are completely isolated:

| Layer | File | Format | Storage | Correlation |
|-------|------|--------|---------|-------------|
| App (React Native) | `app/sources/log.ts` | Plain text, memory only | 5k entries in-memory ring buffer | None |
| Server (Fastify) | `server/src/utils/log.ts` | Pino JSON | `~/.free/logs/server-*.log` | None |
| CLI / Daemon | `cli/src/ui/logger.ts` | Plain text | `~/.free/logs/cli-*.log` | None |

There is no trace ID, no span concept, no structured correlation between logs across layers. Each system has its own API, its own format, and its own storage strategy. A fourth system (`remoteLogger.ts`) exists as a development-only hack gated behind `DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING`.

### 1.2 Goals

1. **Single API** -- One import path, one Logger class, all layers use it
2. **Trace propagation** -- Every user-initiated operation gets a `traceId` that flows through every layer, every hop, every log entry
3. **Structured format** -- All logs are JSON with mandatory trace dimensions
4. **Local-first collection** -- Logs are always stored locally; remote upload is opt-in
5. **User-initiated diagnostics** -- Users can export anonymized diagnostic bundles when something goes wrong
6. **Zero-knowledge by default** -- Message content is never logged; sensitive data is automatically redacted
7. **Extensible** -- Adding a new layer or component requires one `new Logger('name')` call
8. **Delete the old systems** -- No wrappers, no adapters, no compatibility shims

### 1.3 Non-Goals

- Full OpenTelemetry/Jaeger/Datadog integration (can be added later as a Sink)
- Server-side log aggregation infrastructure (out of scope)
- Real-time log streaming UI (the App log viewer is sufficient for now)

---

## 2. Architecture Overview

```
@agentbridge/core/src/telemetry/
|
|-- types.ts           TraceContext, LogEntry, Level, Layer
|-- context.ts         Trace context creation, propagation, serialization
|-- logger.ts          Logger class (the only public API for logging)
|-- span.ts            Span class (timing + nested operations)
|-- collector.ts       LogCollector (pipeline: sanitize -> route to sinks)
|-- sanitizer.ts       Automatic sensitive data redaction
|-- exporter.ts        Diagnostic bundle export (zip)
|
|-- sinks/
|   |-- types.ts       LogSink interface
|   |-- file.ts        FileSink -- append JSONL to disk (CLI/Server/Daemon)
|   |-- memory.ts      MemorySink -- ring buffer in memory (App)
|   |-- remote.ts      RemoteSink -- batched HTTP upload (opt-in telemetry)
|   |-- console.ts     ConsoleSink -- structured console output (development)
|
|-- index.ts           Public exports
```

### 2.1 Dependency Direction

```
Logger --> LogCollector --> Sanitizer --> LogSink[]
  |
  +--> Span (optional)
  |
  +--> TraceContext (optional, flows from wire protocol)
```

The telemetry module has **zero dependencies** on any app-specific code. It depends only on:
- Node.js `fs` (for FileSink, conditionally imported)
- `crypto.randomUUID` or equivalent (for ID generation)

All sinks are injected at initialization time by each app layer. The core logger code runs identically in Node.js and React Native.

---

## 3. Data Model

### 3.1 TraceContext

```typescript
interface TraceContext {
  readonly traceId: string        // nanoid(21) -- lifecycle of one user operation
  readonly spanId: string         // nanoid(12) -- current processing step
  readonly parentSpanId?: string  // parent step (for nesting)
  readonly sessionId?: string     // session this operation belongs to
  readonly machineId?: string     // machine running this operation
}
```

**Rules:**
- `traceId` is created once at the origin of a user action (App sends a message, CLI starts a session, etc.)
- `traceId` is **inherited** at every subsequent layer -- it never changes within one operation
- `spanId` is created fresh at each layer boundary -- it represents "this layer's processing of the operation"
- `parentSpanId` links to the previous layer's `spanId`, forming a causal chain

### 3.2 LogEntry

```typescript
interface LogEntry {
  // --- Timestamps ---
  timestamp: string              // ISO 8601 with milliseconds (e.g. "2026-03-06T14:23:01.456Z")

  // --- Classification ---
  level: 'debug' | 'info' | 'warn' | 'error'
  layer: 'app' | 'server' | 'cli' | 'daemon' | 'agent'
  component: string              // module name (e.g. 'socket', 'sync', 'claude-loop', 'rpc')

  // --- Trace dimensions (all optional, present when available) ---
  traceId?: string
  spanId?: string
  parentSpanId?: string
  sessionId?: string
  machineId?: string

  // --- Content ---
  message: string                // human-readable log message
  data?: Record<string, unknown> // structured key-value pairs
  error?: {                      // error details (only for level: 'error')
    message: string
    stack?: string
    code?: string
  }

  // --- Performance ---
  durationMs?: number            // span duration (set automatically by Span.end())
}
```

**Storage format:** One JSON object per line (JSONL). Example:

```jsonl
{"timestamp":"2026-03-06T14:23:01.456Z","level":"info","layer":"app","component":"sync","traceId":"V1StGXR8_Z5jdHi6B-myT","spanId":"a3f8Bc2dE1g4","sessionId":"550e8400-e29b-41d4-a716-446655440000","message":"Sending message","data":{"localId":"f47ac10b-58cc"}}
{"timestamp":"2026-03-06T14:23:01.512Z","level":"info","layer":"server","component":"socket","traceId":"V1StGXR8_Z5jdHi6B-myT","spanId":"h5i6Jk7lM8n9","parentSpanId":"a3f8Bc2dE1g4","sessionId":"550e8400-e29b-41d4-a716-446655440000","message":"Message received, creating DB record","data":{"seq":42}}
{"timestamp":"2026-03-06T14:23:01.587Z","level":"info","layer":"cli","component":"claude-loop","traceId":"V1StGXR8_Z5jdHi6B-myT","spanId":"o0p1Qr2sT3u4","parentSpanId":"h5i6Jk7lM8n9","sessionId":"550e8400-e29b-41d4-a716-446655440000","message":"Forwarding to agent","durationMs":75}
```

**Querying:** `grep "V1StGXR8_Z5jdHi6B-myT" ~/.free/logs/*.log` shows the complete lifecycle across all layers.

### 3.3 Layer Enum

```typescript
type Layer = 'app' | 'server' | 'cli' | 'daemon' | 'agent'
```

| Layer | Process | Description |
|-------|---------|-------------|
| `app` | React Native app | Mobile/web UI |
| `server` | Fastify server | API + WebSocket gateway |
| `cli` | free-cli process | Session host, Claude wrapper |
| `daemon` | Daemon process | Background session manager |
| `agent` | Claude/Gemini/Codex | AI agent subprocess |

---

## 4. Core API

### 4.1 Logger

```typescript
class Logger {
  /**
   * Create a logger for a specific component.
   * The component name appears in every log entry.
   *
   * @param component - Module/feature name (e.g. 'socket', 'sync', 'rpc')
   */
  constructor(component: string)

  /**
   * Log at the specified level.
   * These methods work without a TraceContext -- suitable for
   * startup logs, shutdown logs, and infrastructure messages.
   */
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, err?: Error, data?: Record<string, unknown>): void

  /**
   * Create a scoped logger that automatically attaches TraceContext
   * to every log entry. This is the primary API for request-scoped logging.
   *
   * @param ctx - TraceContext from the incoming request/message
   * @returns ScopedLogger with identical debug/info/warn/error methods
   */
  withContext(ctx: TraceContext): ScopedLogger

  /**
   * Start a timed span. The span logs its start and, on end(), its duration.
   * Spans can be nested.
   *
   * @param name - Human-readable name for this operation
   * @param ctx - Optional TraceContext (creates a child span)
   * @returns Span object -- call span.end() when done
   */
  span(name: string, ctx?: TraceContext): Span
}
```

### 4.2 ScopedLogger

```typescript
interface ScopedLogger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, err?: Error, data?: Record<string, unknown>): void

  /** Access the underlying TraceContext */
  readonly context: TraceContext
}
```

### 4.3 Span

```typescript
class Span {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly name: string

  /**
   * Log within this span's context.
   */
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, err?: Error, data?: Record<string, unknown>): void

  /**
   * Create a child span (for nested operations).
   */
  child(name: string): Span

  /**
   * End the span. Logs completion with durationMs.
   * After end() is called, further logging on this span is a no-op.
   */
  end(data?: Record<string, unknown>): void

  /**
   * Get the TraceContext for this span (for passing to downstream layers).
   */
  toContext(): TraceContext
}
```

### 4.4 TraceContext Functions

```typescript
/**
 * Create a new trace. Use at the origin of a user action.
 * Generates fresh traceId and spanId.
 */
function createTrace(opts: {
  sessionId?: string
  machineId?: string
}): TraceContext

/**
 * Continue a trace from an upstream layer.
 * Inherits traceId, creates a new spanId, sets parentSpanId.
 */
function continueTrace(upstream: {
  traceId: string
  spanId: string
  sessionId?: string
  machineId?: string
}): TraceContext

/**
 * Inject trace context into a carrier object (for wire transmission).
 * Adds _trace field to the carrier.
 */
function injectTrace(ctx: TraceContext, carrier: Record<string, unknown>): void

/**
 * Extract trace context from a carrier object (received from wire).
 * Returns undefined if no trace context is present.
 */
function extractTrace(carrier: Record<string, unknown>): TraceContext | undefined
```

**Wire format:**
```typescript
// injectTrace adds:
carrier._trace = {
  tid: ctx.traceId,
  sid: ctx.spanId,
  pid: ctx.parentSpanId,    // omitted if undefined
  ses: ctx.sessionId,       // omitted if undefined
  mid: ctx.machineId,       // omitted if undefined
}

// extractTrace reads from carrier._trace
```

Short field names (`tid`, `sid`, `pid`, `ses`, `mid`) minimize overhead on the wire. The `_trace` key is namespaced to avoid collision with existing fields.

---

## 5. LogCollector & Sinks

### 5.1 LogCollector

The LogCollector is the central pipeline. All Logger instances emit entries to a single global LogCollector. The collector sanitizes entries and routes them to registered sinks.

```typescript
class LogCollector {
  private sinks: LogSink[] = []
  private sanitizer: Sanitizer
  private layer: Layer
  private minLevel: Level

  constructor(opts: {
    layer: Layer
    minLevel?: Level           // default: 'debug'
    sanitizer?: Sanitizer      // default: built-in sanitizer
  })

  /**
   * Register a sink. Entries will be written to all registered sinks.
   */
  addSink(sink: LogSink): void

  /**
   * Remove a sink (e.g. when disabling telemetry).
   */
  removeSink(sink: LogSink): void

  /**
   * Called internally by Logger. Sanitizes and dispatches to all sinks.
   */
  emit(entry: LogEntry): void

  /**
   * Flush all sinks (call before process exit).
   */
  flush(): Promise<void>

  /**
   * Close all sinks and prevent further writes.
   */
  close(): Promise<void>
}
```

**Initialization (global, once per process):**

```typescript
// Must be called before any Logger is used.
// Each app layer calls this once at startup.
function initTelemetry(opts: {
  layer: Layer
  minLevel?: Level
  sinks: LogSink[]
  sanitizer?: Sanitizer
}): void

// Returns the global collector (for adding/removing sinks later).
function getCollector(): LogCollector
```

### 5.2 LogSink Interface

```typescript
interface LogSink {
  /** Unique name for this sink (for debugging) */
  readonly name: string

  /**
   * Write a single log entry. Must not throw.
   * Implementations should be non-blocking where possible.
   */
  write(entry: LogEntry): void

  /**
   * Flush buffered entries to storage. Called before process exit.
   */
  flush(): Promise<void>

  /**
   * Release resources. Called on shutdown.
   */
  close(): Promise<void>
}
```

### 5.3 FileSink

For CLI, Daemon, and Server. Appends JSONL to a file on disk.

```typescript
class FileSink implements LogSink {
  constructor(opts: {
    dir: string               // e.g. '~/.free/logs'
    prefix: string            // e.g. 'cli', 'server', 'daemon'
    maxFileSize?: number      // rotate at this size (default: 50MB)
    maxFiles?: number         // keep N rotated files (default: 10)
  })
}
```

**File naming:** `{prefix}-{YYYY-MM-DD}-{HH-MM-SS}-{pid}.jsonl`

Example: `cli-2026-03-06-14-23-01-12345.jsonl`

**Rotation:** When the file exceeds `maxFileSize`, create a new file. Delete files beyond `maxFiles` count (oldest first).

### 5.4 MemorySink

For the App (React Native). Stores entries in a ring buffer.

```typescript
class MemorySink implements LogSink {
  constructor(opts: {
    maxEntries?: number       // default: 10_000
  })

  /**
   * Get all entries (for UI display).
   */
  getEntries(): LogEntry[]

  /**
   * Get entries matching a filter (for search).
   */
  query(filter: LogFilter): LogEntry[]

  /**
   * Subscribe to new entries (for real-time UI updates).
   */
  onChange(listener: (entry: LogEntry) => void): () => void

  /**
   * Export all entries as JSONL string (for diagnostic bundle).
   */
  exportJsonl(): string

  /**
   * Clear all entries.
   */
  clear(): void
}

interface LogFilter {
  level?: Level | Level[]
  traceId?: string
  sessionId?: string
  component?: string
  since?: string              // ISO 8601 timestamp
  until?: string              // ISO 8601 timestamp
  search?: string             // full-text search in message
}
```

### 5.5 RemoteSink

Opt-in telemetry upload. Batches entries and sends via HTTP POST.

```typescript
class RemoteSink implements LogSink {
  constructor(opts: {
    endpoint: string          // e.g. 'https://api.example.com/v1/telemetry/logs'
    authToken?: string        // bearer token for authentication
    batchSize?: number        // send when N entries buffered (default: 50)
    flushIntervalMs?: number  // send at least every N ms (default: 30_000)
    maxBufferSize?: number    // drop oldest if buffer exceeds (default: 500)
    minLevel?: Level          // only upload entries >= this level (default: 'warn')
    extraSanitizer?: Sanitizer // additional redaction before upload
  })
}
```

**Upload payload:**
```typescript
POST /v1/telemetry/logs
Content-Type: application/json
Authorization: Bearer <token>

{
  "deviceId": "<anonymous device hash>",
  "appVersion": "1.2.3",
  "entries": [
    { ...LogEntry },
    { ...LogEntry }
  ]
}
```

**Failure handling:** Silent drop. No retries. No local queue persistence. Telemetry must never block or degrade the user experience.

### 5.6 ConsoleSink

For development only. Outputs structured logs to stdout/stderr with color.

```typescript
class ConsoleSink implements LogSink {
  constructor(opts?: {
    color?: boolean           // default: true
    compact?: boolean         // single-line format (default: true)
  })
}
```

Output format (compact):
```
14:23:01.456 [INFO] socket | Message received | trace=V1StGXR8 session=550e8400 seq=42
14:23:01.587 [WARN] rpc   | Handler timeout   | trace=V1StGXR8 session=550e8400 durationMs=5000
14:23:01.590 [ERR]  auth  | Token expired      | error="jwt expired"
```

---

## 6. Sanitizer

The sanitizer runs in the LogCollector pipeline **before** entries reach any sink. This is not optional -- it is a mandatory part of the pipeline.

### 6.1 Rules

```typescript
class Sanitizer {
  /**
   * Default sensitive key patterns (case-insensitive partial match).
   */
  private static readonly SENSITIVE_KEYS = [
    'token', 'key', 'secret', 'password', 'credential', 'authorization',
    'cookie', 'encryptionkey', 'privatekey', 'accesskey',
    // User content (end-to-end encrypted, must never appear in logs)
    'content', 'text', 'message', 'body', 'draft', 'prompt',
    // Encryption artifacts
    'c',           // SessionMessageContent.c (encrypted payload)
    'nonce',
    'ciphertext',
  ]

  /**
   * Process a log entry. Returns a new entry with sensitive data redacted.
   */
  process(entry: LogEntry): LogEntry

  /**
   * Redact values in a data object recursively.
   *
   * Rules:
   * 1. Keys matching SENSITIVE_KEYS -> value becomes '[REDACTED]'
   * 2. Strings longer than 500 chars -> truncated to 500 + '...[truncated]'
   * 3. Uint8Array / Buffer -> '[BINARY <byteLength>]'
   * 4. Nested objects -> recurse (max depth 5, then '[DEEP_OBJECT]')
   * 5. Arrays -> process each element (max 20 elements, then '[...N more]')
   */
  private redactObject(obj: Record<string, unknown>, depth?: number): Record<string, unknown>
}
```

### 6.2 Error Sanitization

Error stacks are preserved (they contain file paths and line numbers, which are useful for debugging and do not contain user data). Error messages are preserved unless they contain sensitive patterns (e.g., tokens in error messages).

### 6.3 Custom Sanitizers

The RemoteSink can apply an additional sanitizer layer for extra-aggressive redaction before data leaves the device:

```typescript
const remoteSanitizer = new Sanitizer({
  extraSensitiveKeys: ['sessionId', 'machineId'], // redact IDs for remote upload
  maxStringLength: 200,                             // more aggressive truncation
})

new RemoteSink({
  endpoint: '...',
  extraSanitizer: remoteSanitizer,
})
```

---

## 7. Trace Propagation Through the Wire Protocol

### 7.1 Socket.IO Events

All client-to-server and server-to-client events gain an optional `_trace` field.

**Changes to `packages/core/src/interfaces/websocket.ts`:**

```typescript
// Wire trace format (compact for bandwidth)
interface WireTrace {
  tid: string        // traceId
  sid: string        // spanId
  pid?: string       // parentSpanId
  ses?: string       // sessionId
  mid?: string       // machineId
}

// ClientToServerEvents -- add _trace to all events
interface ClientToServerEvents {
  message: (data: {
    sid: string
    message: unknown
    localId?: string
    _trace?: WireTrace           // <-- NEW
  }) => void

  'session-alive': (data: {
    sid: string
    time: number
    thinking?: boolean
    mode?: string
    _trace?: WireTrace           // <-- NEW
  }) => void

  'session-end': (data: {
    sid: string
    time: number
    _trace?: WireTrace           // <-- NEW
  }) => void

  'update-metadata': (data: {
    sid: string
    metadata: string
    expectedVersion: number
    _trace?: WireTrace           // <-- NEW
  }, callback: OptimisticCallback) => void

  'update-state': (data: {
    sid: string
    agentState: string
    expectedVersion: number
    _trace?: WireTrace           // <-- NEW
  }, callback: OptimisticCallback) => void

  'rpc-call': (data: {
    method: string
    params: unknown
    _trace?: WireTrace           // <-- NEW
  }, callback: (response: RpcResponse) => void) => void

  'usage-report': (data: {
    key: string
    sessionId: string
    tokens: Record<string, number>
    cost: Record<string, number>
    _trace?: WireTrace           // <-- NEW
  }) => void

  // Streaming events
  'streaming:text-delta': (data: {
    sessionId: string
    messageId: string
    delta: string
    timestamp: number
    _trace?: WireTrace           // <-- NEW
  }) => void

  'streaming:thinking-delta': (data: {
    sessionId: string
    messageId: string
    delta: string
    timestamp: number
    _trace?: WireTrace           // <-- NEW
  }) => void
}

// ServerToClientEvents -- add _trace to update and ephemeral
interface ServerToClientEvents {
  update: (data: Update & {
    _trace?: WireTrace           // <-- NEW
  }) => void

  ephemeral: (data: EphemeralPayload & {
    _trace?: WireTrace           // <-- NEW
  }) => void

  'rpc-request': (data: {
    method: string
    params: unknown
    _trace?: WireTrace           // <-- NEW
  }, callback: (response: unknown) => void) => void
}
```

### 7.2 HTTP API

REST API requests carry trace context in HTTP headers:

```
X-Trace-Id: V1StGXR8_Z5jdHi6B-myT
X-Span-Id: a3f8Bc2dE1g4
X-Parent-Span-Id: h5i6Jk7lM8n9
```

The server's HTTP middleware extracts these headers and constructs a `TraceContext` available to route handlers.

### 7.3 Backward Compatibility

`_trace` is optional on all events. When absent:
- The **receiving layer** generates a new `traceId` locally (degraded mode -- trace starts at this layer instead of the origin)
- Existing clients that don't send `_trace` continue to work
- This allows incremental rollout: update one layer at a time

---

## 8. Per-Layer Initialization

### 8.1 App (React Native)

```typescript
// app/_layout.tsx (or equivalent entry point)
import { initTelemetry, MemorySink, RemoteSink } from '@agentbridge/core/telemetry'

const memorySink = new MemorySink({ maxEntries: 10_000 })

initTelemetry({
  layer: 'app',
  minLevel: __DEV__ ? 'debug' : 'info',
  sinks: [
    memorySink,
    // ConsoleSink only in dev
    ...(__DEV__ ? [new ConsoleSink()] : []),
  ],
})

// Expose memorySink for the log viewer UI and diagnostic export
export { memorySink }

// Opt-in telemetry (toggled from settings)
function enableTelemetry(token: string, endpoint: string) {
  const remoteSink = new RemoteSink({ endpoint, authToken: token, minLevel: 'warn' })
  getCollector().addSink(remoteSink)
  return () => getCollector().removeSink(remoteSink)
}
```

### 8.2 Server (Fastify)

```typescript
// server/src/main.ts
import { initTelemetry, FileSink, ConsoleSink } from '@agentbridge/core/telemetry'

initTelemetry({
  layer: 'server',
  minLevel: process.env.LOG_LEVEL as Level || 'debug',
  sinks: [
    new FileSink({
      dir: logsDir,
      prefix: 'server',
      maxFileSize: 50 * 1024 * 1024,  // 50MB
      maxFiles: 10,
    }),
  ],
})
```

### 8.3 CLI

```typescript
// cli/src/index.ts
import { initTelemetry, FileSink } from '@agentbridge/core/telemetry'

initTelemetry({
  layer: 'cli',
  minLevel: process.env.DEBUG ? 'debug' : 'info',
  sinks: [
    new FileSink({
      dir: configuration.logsDir,
      prefix: 'cli',
    }),
  ],
})
```

### 8.4 Daemon

```typescript
// cli/src/daemon/run.ts
import { initTelemetry, FileSink } from '@agentbridge/core/telemetry'

initTelemetry({
  layer: 'daemon',
  minLevel: 'debug',
  sinks: [
    new FileSink({
      dir: configuration.logsDir,
      prefix: 'daemon',
    }),
  ],
})
```

---

## 9. Trace Flow Examples

### 9.1 User Sends a Message (Happy Path)

```
Step 1: App -- User taps Send
  - App creates: traceId=aaa, spanId=A1
  - Log: [app/sync] "Sending message" trace=aaa span=A1
  - Socket.IO emit('message', { sid, message, _trace: { tid: 'aaa', sid: 'A1', ses: sessionId } })

Step 2: Server -- Receives message
  - Server extracts _trace, calls continueTrace -> spanId=S1, parentSpanId=A1
  - Log: [server/socket] "Message received" trace=aaa span=S1 parent=A1
  - DB: sessionMessage.create(...)
  - Log: [server/socket] "Message persisted" trace=aaa span=S1 seq=42
  - eventRouter.emitUpdate({ ..., _trace: { tid: 'aaa', sid: 'S1' } })
  - Log: [server/event-router] "Broadcasting to 2 connections" trace=aaa span=S1

Step 3: CLI -- Receives update via WebSocket
  - CLI extracts _trace, calls continueTrace -> spanId=C1, parentSpanId=S1
  - Log: [cli/api-session] "Update received" trace=aaa span=C1 parent=S1
  - Decrypts message
  - Log: [cli/api-session] "Message decrypted, routing" trace=aaa span=C1

Step 4: CLI -- Forwards to Agent
  - Log: [cli/claude-loop] "Forwarding to agent" trace=aaa span=C1
  - Starts agent span: spanId=AG1, parentSpanId=C1
  - Log: [agent/claude] "Processing user message" trace=aaa span=AG1 parent=C1

Step 5: Agent -- Responds
  - Log: [agent/claude] "Response generated" trace=aaa span=AG1 durationMs=3200

Step 6: CLI -- Sends response back
  - Log: [cli/claude-loop] "Agent response received" trace=aaa span=C1
  - Encrypts and enqueues
  - Socket.IO emit('message', { sid, message, _trace: { tid: 'aaa', sid: 'C1' } })

Step 7: Server -- Receives agent response
  - continueTrace -> spanId=S2, parentSpanId=C1
  - Log: [server/socket] "Agent response received" trace=aaa span=S2
  - DB: sessionMessage.create(...)
  - eventRouter.emitUpdate({ ..., _trace: { tid: 'aaa', sid: 'S2' } })

Step 8: App -- Receives response
  - continueTrace -> spanId=A2, parentSpanId=S2
  - Log: [app/sync] "Response received" trace=aaa span=A2 parent=S2
  - Updates UI
```

**Querying:**
```bash
grep '"traceId":"aaa"' ~/.free/logs/*.jsonl
# Shows 10+ entries across server, cli, daemon logs with the full story

# Or on the App, the MemorySink can be queried:
memorySink.query({ traceId: 'aaa' })
```

### 9.2 Debugging a Failed Permission Request

```bash
# User reports: "My agent asked for permission but I never saw the prompt"
# User exports diagnostic bundle from App

# Developer receives diagnostic-2026-03-06.zip
# Opens logs.jsonl, searches for the session:
grep '"sessionId":"550e8400"' logs.jsonl | grep '"component":"rpc"'

# Finds:
# [server/rpc] "RPC request forwarded to app" trace=xyz session=550e8400
# [app/rpc] -- NOTHING. The event never reached the app.

# Now search server logs for trace=xyz:
grep '"traceId":"xyz"' server-2026-03-06-*.jsonl

# Finds:
# [server/event-router] "Broadcasting to 0 connections (session-scoped)" trace=xyz
# -> The app was disconnected at that moment. Root cause found.
```

---

## 10. Diagnostic Export

### 10.1 Export Format

```
diagnostic-2026-03-06T14-23-01.zip
|-- logs.jsonl          Sanitized log entries (all layers available on this device)
|-- timeline.json       Ordered event summary
|-- environment.json    Device/version info (anonymized)
|-- sessions.json       Active session metadata (sanitized)
```

### 10.2 timeline.json

A condensed view of what happened, derived from log entries:

```json
[
  {
    "time": "2026-03-06T14:23:01.456Z",
    "event": "message_sent",
    "traceId": "aaa",
    "sessionId": "550e8400",
    "layer": "app",
    "durationMs": null
  },
  {
    "time": "2026-03-06T14:23:01.512Z",
    "event": "message_persisted",
    "traceId": "aaa",
    "sessionId": "550e8400",
    "layer": "server",
    "durationMs": 56
  }
]
```

### 10.3 environment.json

```json
{
  "platform": "ios",
  "osVersion": "18.3",
  "appVersion": "1.2.3",
  "coreVersion": "0.5.0",
  "deviceModel": "iPhone16,1",
  "locale": "en-US",
  "timezone": "America/Los_Angeles",
  "activeSessions": 2,
  "uptimeMinutes": 47
}
```

No user ID, no device ID, no IP addresses.

### 10.4 App UI

```
Settings -> Support -> Export Diagnostic Logs
  [Toggle] Include last 24 hours / last 1 hour / current session only
  [Preview] "142 log entries, 3 sessions"
  [Button] Share...  (system share sheet)
  [Button] Copy to clipboard (for small exports)
```

### 10.5 CLI Command

```bash
# Export all logs for a specific session
free diagnostic export --session 550e8400

# Export all logs from the last hour
free diagnostic export --since 1h

# Export all logs matching a trace ID
free diagnostic export --trace V1StGXR8_Z5jdHi6B-myT

# Output: Created diagnostic-2026-03-06T14-23-01.zip (24KB)
```

---

## 11. Migration Plan

### 11.1 Files to Delete

| File | Replacement |
|------|-------------|
| `apps/free/cli/src/ui/logger.ts` | `@agentbridge/core/telemetry` Logger + FileSink |
| `apps/free/server/src/utils/log.ts` | `@agentbridge/core/telemetry` Logger + FileSink |
| `apps/free/app/sources/log.ts` | `@agentbridge/core/telemetry` Logger + MemorySink |
| `apps/free/app/sources/utils/remoteLogger.ts` | `@agentbridge/core/telemetry` RemoteSink |

### 11.2 Environment Variables to Delete

| Variable | Replacement |
|----------|-------------|
| `DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING` | RemoteSink (opt-in via settings, not env var) |

### 11.3 Server Endpoints to Delete

| Endpoint | Replacement |
|----------|-------------|
| `POST /logs-combined-from-cli-and-mobile-for-simple-ai-debugging` | `POST /v1/telemetry/logs` |

### 11.4 Files to Modify (102 files total)

**CLI (69 files):** Replace `import { logger } from '@/ui/logger'` with:
```typescript
import { Logger } from '@agentbridge/core/telemetry'
const log = new Logger('component-name')
```

Existing call patterns and their replacements:

```typescript
// Before                                    // After
logger.debug('msg')                          log.debug('msg')
logger.debug('msg', obj)                     log.debug('msg', { detail: obj })
logger.info('msg')                           log.info('msg')
logger.warn('msg')                           log.warn('msg')
logger.infoDeveloper('msg')                  log.debug('msg')  // debug level replaces infoDeveloper
logger.debugLargeJson('label', obj, 100, 10) log.debug('label', { payload: obj })  // sanitizer handles truncation
logger.getLogPath()                          // Remove: no longer needed per-file
```

**Server (30 files):** Replace `import { log, warn, error, debug } from '@/utils/log'` with:
```typescript
import { Logger } from '@agentbridge/core/telemetry'
const log = new Logger('component-name')
```

Existing call patterns:

```typescript
// Before                                        // After
log('msg')                                       log.info('msg')
log({ module: 'auth' }, 'msg')                   log.info('msg')  // component already set in constructor
log({ module: 'auth', level: 'debug' }, 'msg')   log.debug('msg')
warn('msg')                                      log.warn('msg')
error('msg')                                     log.error('msg')
debug('msg')                                     log.debug('msg')
```

**App (3 files + 1 remoteLogger):** Replace `import { log } from '@/log'` with:
```typescript
import { Logger } from '@agentbridge/core/telemetry'
const log = new Logger('component-name')
```

```typescript
// Before              // After
log.log('msg')         log.info('msg')
```

### 11.5 Critical Path Files (Trace Context Injection)

These files require trace context propagation, not just logger replacement:

| File | What to add |
|------|-------------|
| `app/sources/sync/sync.ts` | `createTrace()` when sending messages; `extractTrace()` when receiving updates |
| `app/sources/sync/apiSocket.ts` | Pass `_trace` in all Socket.IO emits |
| `server/src/app/api/socket/sessionUpdateHandler.ts` | `extractTrace()` from incoming events; pass to `eventRouter` |
| `server/src/app/events/eventRouter.ts` | Include `_trace` in `emitUpdate()` and `emitEphemeral()` payloads |
| `server/src/app/api/routes/v3SessionRoutes.ts` | Extract trace from HTTP headers; include in response |
| `cli/src/api/apiSession.ts` | `extractTrace()` from received updates; `injectTrace()` when sending |
| `cli/src/claude/loop.ts` | Pass `TraceContext` between local/remote launchers |
| `cli/src/claude/claudeRemoteLauncher.ts` | Forward `TraceContext` to agent |
| `cli/src/claude/claudeLocalLauncher.ts` | Forward `TraceContext` to agent |
| `cli/src/daemon/run.ts` | `TraceContext` in session spawn and webhook handling |
| `cli/src/daemon/streamingMessageHandler.ts` | Forward `_trace` in streaming deltas |
| `packages/core/src/interfaces/websocket.ts` | Add `_trace?: WireTrace` to all event types |
| `packages/core/src/interfaces/events.ts` | Add `_trace?: WireTrace` to `UpdatePayload` and `EphemeralPayload` |

---

## 12. Implementation Phases

### Phase 1: Core Telemetry Infrastructure

**Scope:** `packages/core/src/telemetry/`

**Deliverables:**
1. `types.ts` -- All type definitions
2. `context.ts` -- `createTrace`, `continueTrace`, `injectTrace`, `extractTrace`
3. `logger.ts` -- `Logger`, `ScopedLogger`
4. `span.ts` -- `Span`
5. `collector.ts` -- `LogCollector`, `initTelemetry`, `getCollector`
6. `sanitizer.ts` -- `Sanitizer`
7. `sinks/types.ts` -- `LogSink` interface
8. `sinks/file.ts` -- `FileSink`
9. `sinks/memory.ts` -- `MemorySink`
10. `sinks/remote.ts` -- `RemoteSink`
11. `sinks/console.ts` -- `ConsoleSink`
12. `exporter.ts` -- `exportDiagnostic`
13. `index.ts` -- Public exports
14. Unit tests for all of the above

**Acceptance criteria:**
- All types compile
- Logger writes to FileSink and produces valid JSONL
- MemorySink supports query and onChange
- Sanitizer redacts all sensitive keys
- TraceContext serializes/deserializes round-trip through `injectTrace`/`extractTrace`
- Exporter produces a valid zip with logs.jsonl, timeline.json, environment.json

**Also update:**
- `packages/core/src/index.ts` -- Export telemetry module

### Phase 2: Wire Protocol

**Scope:** `packages/core/src/interfaces/`

**Deliverables:**
1. `websocket.ts` -- Add `_trace?: WireTrace` to all `ClientToServerEvents` and `ServerToClientEvents`
2. `events.ts` -- Add `_trace?: WireTrace` to `UpdatePayload` and `EphemeralPayload`

**Acceptance criteria:**
- Types compile with no breaking changes (all additions are optional)
- Existing tests pass without modification

### Phase 3: Server Migration

**Scope:** `apps/free/server/src/`

**Deliverables:**
1. Delete `utils/log.ts`
2. Add `initTelemetry()` call in `main.ts`
3. Replace logger imports in all 30 files
4. Add trace context extraction in socket handlers (`sessionUpdateHandler.ts`, `rpcHandler.ts`, `streamingHandler.ts`, etc.)
5. Add trace context propagation in `eventRouter.ts`
6. Add trace context extraction from HTTP headers in route middleware
7. Delete `devRoutes.ts` log endpoint (or replace with `/v1/telemetry/logs`)

**Acceptance criteria:**
- Server starts and produces JSONL logs in `~/.free/logs/server-*.jsonl`
- All existing functionality works (sessions, messages, RPC, streaming)
- Incoming `_trace` is extracted and appears in server logs
- Outgoing updates include `_trace` when available

### Phase 4: CLI & Daemon Migration

**Scope:** `apps/free/cli/src/`

**Deliverables:**
1. Delete `ui/logger.ts`
2. Add `initTelemetry()` in `index.ts` (CLI) and `daemon/run.ts` (Daemon)
3. Replace logger imports in all 69 files
4. Add trace context handling in `apiSession.ts` (extract from incoming, inject into outgoing)
5. Add trace context propagation in `loop.ts`, `claudeLocalLauncher.ts`, `claudeRemoteLauncher.ts`
6. Add trace context in daemon session spawn (`run.ts`)
7. Update `doctor.ts` to use new Logger (convert console.log calls)
8. Add `free diagnostic export` command
9. Add `free logs` command (tail, search)

**Acceptance criteria:**
- CLI starts and produces JSONL logs in `~/.free/logs/cli-*.jsonl`
- Daemon produces JSONL logs in `~/.free/logs/daemon-*.jsonl`
- Messages flowing through CLI have traceId in logs
- `free diagnostic export --session <id>` produces a valid zip
- `free logs search --trace <id>` returns matching entries across all log files

### Phase 5: App Migration

**Scope:** `apps/free/app/sources/`

**Deliverables:**
1. Delete `log.ts`
2. Delete `utils/remoteLogger.ts`
3. Add `initTelemetry()` in app entry point (`_layout.tsx`)
4. Replace log imports in `sync/sync.ts` and other files
5. Add trace context creation in `sync.ts` `sendMessage()`
6. Add trace context extraction in `sync.ts` update subscription
7. Add trace context injection in `apiSocket.ts` for all Socket.IO emits
8. Build log viewer screen (replace existing `dev/logs.tsx`)
   - Filter by level, session, trace, component
   - Real-time updates via MemorySink.onChange
   - Search
9. Build diagnostic export from Settings -> Support
10. Opt-in telemetry toggle in Settings -> Privacy

**Acceptance criteria:**
- App logs to MemorySink
- Log viewer shows structured entries with filters
- Messages sent from App include `_trace` in Socket.IO events
- Diagnostic export produces shareable zip
- Opt-in telemetry sends sanitized warn/error entries to server

### Phase 6: Cleanup

**Scope:** All packages

**Deliverables:**
1. Delete `DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING` from all `.env` files
2. Delete server endpoint `/logs-combined-from-cli-and-mobile-for-simple-ai-debugging`
3. Remove `fileConsolidatedLogger` from server
4. Remove `monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds` references
5. Update all CLAUDE.md files with new logging conventions
6. Verify no remaining imports of old logger modules

**Acceptance criteria:**
- `grep -r "DANGEROUSLY_LOG" . --include="*.ts"` returns zero results (excluding node_modules)
- `grep -r "ui/logger" . --include="*.ts"` returns zero results
- `grep -r "utils/log" apps/free/server/src --include="*.ts"` returns zero results
- `grep -r "sources/log" apps/free/app/sources --include="*.ts"` returns zero results
- All tests pass

---

## 13. Design Decisions & Rationale

### 13.1 Why not AsyncLocalStorage for context propagation?

React Native does not support `AsyncLocalStorage`. Since the core module must run on all platforms, we use explicit context passing. This is more verbose but universally portable and makes the data flow explicit.

### 13.2 Why not OpenTelemetry?

OpenTelemetry is designed for microservice backends. Its SDK is heavy (~2MB), has complex configuration, and is not optimized for mobile or CLI environments. Our system is intentionally minimal (~10KB) and can export to OpenTelemetry-compatible backends later via a custom Sink.

### 13.3 Why JSONL instead of binary format?

- Human-readable with `cat` and `grep`
- Trivially parseable in any language
- Appendable without corruption (each line is independent)
- Compresses well in diagnostic zip exports

### 13.4 Why delete existing loggers instead of wrapping them?

Wrappers create maintenance burden, dual code paths, and confusion about which to use. A clean break is simpler and ensures consistent behavior everywhere.

### 13.5 Why optional _trace on the wire?

Allows incremental rollout. Old clients can talk to new servers and vice versa. The system degrades gracefully: without `_trace`, logs still work -- they just lack cross-layer correlation.

### 13.6 Why per-module Logger instances instead of a global singleton?

Per-module instances automatically tag entries with the `component` name, eliminating the need to manually include it in every log call. They also enable per-module log level overrides in the future.

### 13.7 Why no database for log storage?

Logs are append-only, time-ordered data. JSONL files are simpler, faster, and have zero dependencies. A database adds complexity without benefit for this use case.

### 13.8 Why sanitize in the pipeline instead of at the call site?

Call-site sanitization is error-prone -- developers will forget. Pipeline sanitization is guaranteed. The Sanitizer processes every entry before it reaches any Sink, making it impossible to accidentally log sensitive data.

### 13.9 Console output for CLI

The CLI's existing logger has a critical constraint: console output interferes with Claude's PTY session. The new system preserves this by default:
- `FileSink` writes to file only (no console)
- `ConsoleSink` is only added explicitly (e.g., for `free logs tail` command or development)
- `Logger.info()` does **not** write to console by default -- this is a deliberate change from the old `logger.info()` behavior

For user-facing CLI output (progress messages, QR codes, etc.), continue using direct `console.log` calls. The telemetry logger is for diagnostic/debugging logs only, not user UI.

---

## 14. File Inventory

Complete list of all new and modified files:

### New Files (14)

```
packages/core/src/telemetry/types.ts
packages/core/src/telemetry/context.ts
packages/core/src/telemetry/logger.ts
packages/core/src/telemetry/span.ts
packages/core/src/telemetry/collector.ts
packages/core/src/telemetry/sanitizer.ts
packages/core/src/telemetry/exporter.ts
packages/core/src/telemetry/sinks/types.ts
packages/core/src/telemetry/sinks/file.ts
packages/core/src/telemetry/sinks/memory.ts
packages/core/src/telemetry/sinks/remote.ts
packages/core/src/telemetry/sinks/console.ts
packages/core/src/telemetry/index.ts
packages/core/src/telemetry/__tests__/    (test files)
```

### Deleted Files (4)

```
apps/free/cli/src/ui/logger.ts
apps/free/server/src/utils/log.ts
apps/free/app/sources/log.ts
apps/free/app/sources/utils/remoteLogger.ts
```

### Modified Files -- Wire Protocol (2)

```
packages/core/src/interfaces/websocket.ts
packages/core/src/interfaces/events.ts
```

### Modified Files -- Core Exports (1)

```
packages/core/src/index.ts
```

### Modified Files -- Logger Migration (102)

```
-- CLI (69 files) --
apps/free/cli/src/api/rpc/RpcHandlerManager.ts
apps/free/cli/src/api/pushNotifications.ts
apps/free/cli/src/api/api.ts
apps/free/cli/src/api/apiMachine.ts
apps/free/cli/src/api/apiSession.ts
apps/free/cli/src/api/serverCapabilities.ts
apps/free/cli/src/agent/acp/AcpBackend.ts
apps/free/cli/src/agent/acp/sessionUpdateHandlers.ts
apps/free/cli/src/agent/factories/gemini.ts
apps/free/cli/src/agent/transport/handlers/GeminiTransport.ts
apps/free/cli/src/claude/claudeLocal.ts
apps/free/cli/src/claude/claudeLocalLauncher.ts
apps/free/cli/src/claude/claudeRemote.ts
apps/free/cli/src/claude/claudeRemoteLauncher.ts
apps/free/cli/src/claude/loop.ts
apps/free/cli/src/claude/runClaude.ts
apps/free/cli/src/claude/session.ts
apps/free/cli/src/claude/sdk/query.ts
apps/free/cli/src/claude/sdk/utils.ts
apps/free/cli/src/claude/sdk/metadataExtractor.ts
apps/free/cli/src/claude/utils/claudeCheckSession.ts
apps/free/cli/src/claude/utils/claudeFindLastSession.ts
apps/free/cli/src/claude/utils/claudeSettings.ts
apps/free/cli/src/claude/utils/generateHookSettings.ts
apps/free/cli/src/claude/utils/permissionHandler.ts
apps/free/cli/src/claude/utils/sessionScanner.ts
apps/free/cli/src/claude/utils/startFreeServer.ts
apps/free/cli/src/claude/utils/startHookServer.ts
apps/free/cli/src/codex/runCodex.ts
apps/free/cli/src/codex/codexMcpClient.ts
apps/free/cli/src/codex/utils/diffProcessor.ts
apps/free/cli/src/codex/utils/permissionHandler.ts
apps/free/cli/src/commands/auth.ts
apps/free/cli/src/daemon/run.ts
apps/free/cli/src/daemon/controlClient.ts
apps/free/cli/src/daemon/controlServer.ts
apps/free/cli/src/daemon/install.ts
apps/free/cli/src/daemon/linux/installUser.ts
apps/free/cli/src/daemon/mac/install.ts
apps/free/cli/src/daemon/mac/installUser.ts
apps/free/cli/src/daemon/mac/uninstall.ts
apps/free/cli/src/daemon/streamingMessageHandler.ts
apps/free/cli/src/daemon/uninstall.ts
apps/free/cli/src/gemini/runGemini.ts
apps/free/cli/src/gemini/utils/config.ts
apps/free/cli/src/gemini/utils/conversationHistory.ts
apps/free/cli/src/gemini/utils/diffProcessor.ts
apps/free/cli/src/gemini/utils/permissionHandler.ts
apps/free/cli/src/index.ts
apps/free/cli/src/modules/common/registerCommonHandlers.ts
apps/free/cli/src/modules/proxy/startHTTPDirectProxy.ts
apps/free/cli/src/modules/watcher/startFileWatcher.ts
apps/free/cli/src/opencode/runOpenCode.ts
apps/free/cli/src/persistence.ts
apps/free/cli/src/ui/auth.ts
apps/free/cli/src/ui/doctor.ts
apps/free/cli/src/ui/messageFormatter.ts
apps/free/cli/src/ui/messageFormatterInk.ts
apps/free/cli/src/utils/BasePermissionHandler.ts
apps/free/cli/src/utils/BaseReasoningProcessor.ts
apps/free/cli/src/utils/MessageQueue.ts
apps/free/cli/src/utils/MessageQueue2.ts
apps/free/cli/src/utils/browser.ts
apps/free/cli/src/utils/caffeinate.ts
apps/free/cli/src/utils/expandEnvVars.ts
apps/free/cli/src/utils/serverConnectionErrors.ts
apps/free/cli/src/utils/spawnFreeCLI.ts
apps/free/cli/src/utils/tmux.ts
apps/free/cli/src/utils/versionCheck.ts

-- Server (30 files) --
apps/free/server/src/main.ts
apps/free/server/src/app/api/api.ts
apps/free/server/src/app/api/socket.ts
apps/free/server/src/app/api/routes/accessKeysRoutes.ts
apps/free/server/src/app/api/routes/accountRoutes.ts
apps/free/server/src/app/api/routes/artifactsRoutes.ts
apps/free/server/src/app/api/routes/authRoutes.ts
apps/free/server/src/app/api/routes/connectRoutes.ts
apps/free/server/src/app/api/routes/kvRoutes.ts
apps/free/server/src/app/api/routes/machinesRoutes.ts
apps/free/server/src/app/api/routes/sessionRoutes.ts
apps/free/server/src/app/api/routes/voiceRoutes.ts
apps/free/server/src/app/api/socket/accessKeyHandler.ts
apps/free/server/src/app/api/socket/artifactUpdateHandler.ts
apps/free/server/src/app/api/socket/machineUpdateHandler.ts
apps/free/server/src/app/api/socket/pingHandler.ts
apps/free/server/src/app/api/socket/rpcHandler.ts
apps/free/server/src/app/api/socket/sessionUpdateHandler.ts
apps/free/server/src/app/api/socket/streamingHandler.ts
apps/free/server/src/app/api/socket/usageHandler.ts
apps/free/server/src/app/api/utils/enableAuthentication.ts
apps/free/server/src/app/api/utils/enableErrorHandlers.ts
apps/free/server/src/app/api/utils/enableMonitoring.ts
apps/free/server/src/app/auth/auth.ts
apps/free/server/src/app/events/eventRouter.ts
apps/free/server/src/app/github/githubDisconnect.ts
apps/free/server/src/app/monitoring/metrics.ts
apps/free/server/src/app/presence/sessionCache.ts
apps/free/server/src/app/session/sessionDelete.ts
apps/free/server/src/modules/github.ts

-- Server utilities (3 files) --
apps/free/server/src/utils/delay.ts
apps/free/server/src/utils/backoff.ts
apps/free/server/src/utils/shutdown.ts

-- App (4 files) --
apps/free/app/sources/sync/sync.ts
apps/free/app/sources/sync/apiFeed.ts
apps/free/app/sources/app/(app)/dev/logs.tsx
apps/free/app/sources/app/_layout.tsx
```

---

## 15. Testing Strategy

### 15.1 Unit Tests (Phase 1)

```
telemetry/__tests__/
|-- context.test.ts       createTrace, continueTrace, inject/extract round-trip
|-- logger.test.ts        Logger output format, ScopedLogger context attachment
|-- span.test.ts          Span timing, nesting, auto-close
|-- collector.test.ts     Multi-sink dispatch, level filtering
|-- sanitizer.test.ts     Sensitive key redaction, truncation, depth limits
|-- sinks/
|   |-- file.test.ts      JSONL format, rotation, concurrent writes
|   |-- memory.test.ts    Ring buffer, query, onChange, export
|   |-- remote.test.ts    Batching, flush interval, failure handling
|-- exporter.test.ts      Zip structure, timeline generation
```

### 15.2 Integration Tests (Phase 3-5)

```
tests/
|-- telemetry-e2e.test.ts
|   - Start server with telemetry
|   - Connect CLI client with telemetry
|   - Send a message from "app" -> server -> CLI
|   - Verify traceId appears in server logs, CLI logs, and response
|   - Verify _trace field in Socket.IO events
|
|-- diagnostic-export.test.ts
|   - Generate logs across layers
|   - Export diagnostic bundle
|   - Verify zip contents, sanitization, timeline
```

---

## 16. Performance Considerations

### 16.1 Logging Overhead

- `Logger.debug()` with no sinks: ~0.1us (level check + early return)
- `Logger.info()` with FileSink: ~5us (JSON.stringify + appendFileSync)
- `Logger.info()` with MemorySink: ~1us (push to array)
- `Sanitizer.process()`: ~2us for typical entry (no regex, just Set.has())

### 16.2 FileSink

- Uses `appendFileSync` for reliability (same as current `logger.ts`)
- Consider switching to buffered async writes if profiling shows bottleneck
- File rotation happens synchronously at write time when size threshold is exceeded

### 16.3 RemoteSink

- Batched uploads: never blocks the main thread
- `fetch()` is fire-and-forget with catch
- Buffer overflow: oldest entries dropped silently
- No retry on failure

### 16.4 Wire Overhead

`_trace` adds ~120 bytes per Socket.IO event:
```json
{"_trace":{"tid":"V1StGXR8_Z5jdHi6B-myT","sid":"a3f8Bc2dE1g4","ses":"550e8400-e29b-41d4-a716-446655440000"}}
```

This is negligible compared to encrypted message payloads (typically 1-50KB).

---

## 17. Self-Review: Corrections and Amendments

This section documents issues found during self-review of the original RFC. All corrections below are **binding** -- they override conflicting statements in earlier sections.

### 17.1 [CORRECTION] Message Chain -- Daemon is NOT in the Path

**Original claim (Section 1.1):**
> UI -> App -> Server -> Daemon -> CLI -> Agent

**Corrected architecture:**

```
App (user sends message)
  -> Server (Socket.IO gateway, persists to DB)
    -> CLI (Socket.IO client, connected directly to Server)
      -> Agent (Claude/Gemini/Codex subprocess)
      <- Agent response
    <- CLI sends response via Socket.IO
  <- Server broadcasts to App
<- App displays response
```

The Daemon is a **session lifecycle manager**. It:
- Spawns CLI processes (`spawnFreeCLI`)
- Monitors process health (heartbeat, PID tracking)
- Handles version updates (restart on new CLI version)
- Manages tmux sessions

**Messages never flow through the Daemon.** The CLI connects directly to the Server via Socket.IO. The Daemon layer produces infrastructure logs (session spawn, health checks) but is not part of the message trace chain.

**Impact on trace propagation:**
- Trace context only needs to flow: App -> Server -> CLI -> Agent (4 hops, not 6)
- Daemon logs should carry `sessionId` where applicable (e.g., when spawning a session) but do not participate in message-level `traceId` chains
- Section 9.1 trace flow example should be updated to remove Daemon hops

### 17.2 [CORRECTION] Server Logs Are Not Locally Accessible in Production

**Original claim (Section 9.1):**
> `grep "traceId" ~/.free/logs/*.log` shows the complete lifecycle across all layers.

**Reality:** In production, the Server runs on `api.free-servers.com` (or equivalent hosted infrastructure). Users have no access to server logs. Only CLI/Daemon/App logs exist on the user's device.

**Corrected diagnostic model:**

```
User's device has:         Developer has access to:
  - App logs (MemorySink)    - Server logs (FileSink on hosted server)
  - CLI logs (FileSink)      - User's diagnostic export (if shared)
  - Daemon logs (FileSink)
```

**What this means:**
1. The user's diagnostic export will contain App + CLI + Daemon logs (3 layers out of 4)
2. The developer must correlate user exports with server-side logs using the shared `traceId`
3. The Server needs a **log query capability**: given a `traceId`, return all server-side log entries. This can be a simple CLI tool for developers:
   ```bash
   # On the server host
   grep "traceId\":\"V1StGXR8" /var/log/free-server/*.jsonl
   ```
4. For local development (server running locally), `grep` across `~/.free/logs/` still works

**Addition to Phase 3 (Server Migration):**
- Add a developer-only admin endpoint or CLI command to query server logs by traceId
- Not user-facing; only for internal debugging

### 17.3 [CORRECTION] MemorySink Must Persist to Disk on App

**Original design:** MemorySink keeps 10k entries in memory only.

**Problem:** iOS/Android aggressively kill backgrounded apps. When the user encounters a problem and re-opens the app to export logs, the memory buffer is empty.

**Corrected design:**

```typescript
class MemorySink implements LogSink {
  constructor(opts: {
    maxEntries?: number          // in-memory ring buffer (default: 10_000)
    persistence?: {
      storage: AsyncStorageLike  // AsyncStorage, MMKV, or equivalent
      key: string                // storage key (default: '@telemetry/logs')
      maxPersistedEntries: number // how many to persist (default: 2_000)
      flushIntervalMs: number    // persist every N ms (default: 5_000)
    }
  })
}
```

**Behavior:**
- In-memory ring buffer for fast UI access (unchanged)
- Background flush: every 5 seconds, persist the latest 2k entries to AsyncStorage
- On app launch: load persisted entries into the ring buffer before any new logs arrive
- Persistence is optional (no-op if not configured)
- Persist on `AppState.change` to 'background' event (catch the moment before kill)

### 17.4 [CORRECTION] Logger Must Distinguish Diagnostic Logs from User Output

**Problem:** The current `logger.info()` writes to both console (user-facing) and file (diagnostic). The RFC makes `Logger.info()` file-only, which silently breaks ~20 user-facing messages (install status, daemon messages, etc.)

**Solution: The Logger is ONLY for diagnostic/debugging logs. User-facing output stays as direct console calls.**

```typescript
// DIAGNOSTIC LOG (goes to sinks, never to console)
import { Logger } from '@agentbridge/core/telemetry'
const log = new Logger('daemon')
log.info('Session spawned successfully', { pid: 1234 })

// USER-FACING OUTPUT (goes to console, not to sinks)
console.log('Daemon installed and started successfully!')
console.log('  Auto-start on login')
```

**Migration rule for the 69 CLI files:**

| Current code | What it does | Migration |
|---|---|---|
| `logger.debug('...')` | File only | `log.debug('...')` |
| `logger.info('...')` used as **user output** | Console + file | `console.log('...')` (keep as-is or make explicit) |
| `logger.info('...')` used as **diagnostic info** | Console + file | `log.info('...')` |
| `logger.warn('...')` | Console + file | Evaluate: user warning or diagnostic? Split accordingly |
| `logger.infoDeveloper('...')` | File always, console only in DEBUG | `log.debug('...')` |

**Files that use `logger.info()` for user output (must keep console.log):**
- `daemon/linux/installUser.ts` (~15 calls -- install status messages)
- `daemon/mac/installUser.ts` (~10 calls -- install status messages)
- `daemon/mac/uninstall.ts` (~5 calls)
- `daemon/run.ts` (a few status messages)
- `codex/codexMcpClient.ts` (connection status)

**`doctor.ts` should NOT be migrated at all.** Its 92 `console.log` calls are intentional user-facing diagnostic output. It is a CLI UI tool, not a logging consumer.

### 17.5 [CORRECTION] Must Expose Log File Path

**Problem:** Multiple files use `logger.logFilePath` or `logger.getLogPath()` to pass the path to other modules:
- `loop.ts:50` -- passes to Session constructor
- `runClaude.ts:248` -- displays to developer
- `daemon/run.ts:770` -- persists to daemon state
- `opencode/runOpenCode.ts:317`, `gemini/runGemini.ts:503`, `codex/runCodex.ts:382` -- pass to agent config

**Addition to FileSink:**

```typescript
class FileSink implements LogSink {
  /** Returns the path of the current log file. */
  getFilePath(): string
}
```

**Addition to LogCollector:**

```typescript
class LogCollector {
  /** Returns the file path of the first FileSink, or undefined. */
  getLogFilePath(): string | undefined
}
```

### 17.6 [SIMPLIFICATION] Remove Span Nesting -- Keep It Flat

**Original design:** Span supports `child()` for nested operations, forming a tree.

**Reality check:** Looking at all 102 files, not a single place has nested operation tracking. The code is:
```typescript
logger.debug('[loop] Iteration with mode: local')
logger.debug('[START] Hook server started on port 3001')
```

Nobody is going to call `span.child('substep')`.

**Simplified Span:**

```typescript
class Span {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly name: string

  // Log within this span's context
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, err?: Error, data?: Record<string, unknown>): void

  // End the span (logs completion with durationMs)
  end(data?: Record<string, unknown>): void

  // Get context for passing to downstream layers
  toContext(): TraceContext

  // REMOVED: child() method
  // REMOVED: nested span support
}
```

If nesting is needed in the future, it can be added. Do not build it now.

### 17.7 [CLARIFICATION] withContext() is Only for Critical Path Files

**102 files need logger migration. Only ~13 need TraceContext.**

The migration breaks into two tiers:

**Tier 1: Simple logger swap (89 files)**
Only change the import and method names. No TraceContext, no `withContext()`.

```typescript
// Before
import { logger } from '@/ui/logger'
logger.debug('[CAFFEINATE] Started')

// After
import { Logger } from '@agentbridge/core/telemetry'
const log = new Logger('caffeinate')
log.debug('Started')
```

**Tier 2: Trace-aware files (13 files)**
These are on the message critical path and need `withContext()` or `span()`.

```
app/sources/sync/sync.ts               -- creates trace, sends message
app/sources/sync/apiSocket.ts           -- injects trace into Socket.IO
server/src/app/api/socket/sessionUpdateHandler.ts -- extracts & continues trace
server/src/app/events/eventRouter.ts    -- propagates trace in broadcasts
server/src/app/api/routes/v3SessionRoutes.ts      -- HTTP trace headers
cli/src/api/apiSession.ts              -- extracts & continues trace
cli/src/claude/loop.ts                 -- passes trace to launchers
cli/src/claude/claudeRemoteLauncher.ts -- forwards trace to agent
cli/src/claude/claudeLocalLauncher.ts  -- forwards trace to agent
cli/src/daemon/run.ts                  -- trace in session spawn (sessionId only)
cli/src/daemon/streamingMessageHandler.ts -- forwards trace in deltas
packages/core/src/interfaces/websocket.ts  -- type definitions
packages/core/src/interfaces/events.ts     -- type definitions
```

### 17.8 [CORRECTION] Layer Should Be string, Not Union Type

**Original:**
```typescript
type Layer = 'app' | 'server' | 'cli' | 'daemon' | 'agent'
```

**Problem:** Adding a new component (MCP server, web dashboard, new agent type) requires changing the core type definition.

**Corrected:**
```typescript
// Layer is a free-form string. Convention documented, not enforced by type system.
type Layer = string

// Conventional values (documented, not exhaustive):
// 'app'     -- React Native mobile/web app
// 'server'  -- Fastify API server
// 'cli'     -- free-cli session process
// 'daemon'  -- free-cli daemon process
// 'agent'   -- AI agent subprocess (Claude, Gemini, Codex, OpenCode)
```

### 17.9 [ADDITION] Log Retention and Cleanup

**Problem not addressed in original RFC:** `~/.free/logs/` accumulates files from every process launch. Over weeks, this becomes hundreds of files and gigabytes.

**Global cleanup strategy:**

```typescript
// Added to FileSink or as a standalone utility
function cleanupOldLogs(opts: {
  dir: string
  maxAgeDays?: number      // delete files older than N days (default: 7)
  maxTotalSizeMB?: number  // delete oldest files if total exceeds (default: 500)
}): void
```

**When to run:**
- On every `initTelemetry()` call (once per process start)
- Non-blocking: runs in background after initialization
- Targets all `.jsonl` and `.log` files in the logs directory

**Defaults:**
- Keep logs for 7 days
- Cap total directory size at 500MB
- Delete oldest files first when over cap

### 17.10 [ADDITION] High-Frequency Event Throttling

**Problem:** Streaming events (`text_delta`, `thinking_delta`) fire tens of times per second per session. Logging each one produces noise and inflates log files.

**Solution: Level-based filtering + per-component overrides.**

```typescript
initTelemetry({
  layer: 'server',
  minLevel: 'debug',
  // Override log level for noisy components
  componentLevels: {
    'streaming': 'warn',       // Only log warnings/errors from streaming
    'socket-heartbeat': 'off', // Suppress heartbeat entirely
  },
  sinks: [...]
})
```

**For streaming specifically:**
- `text_delta` and `thinking_delta` should be logged at `debug` level
- Summary log at `info` level when streaming completes: `"Streaming completed, 142 deltas, 3847 chars, 2.3s"`
- This means in production (minLevel: 'info'), individual deltas are not logged, only the summary

### 17.11 [ADDITION] Handling Server-Side Trace Correlation

Since users cannot access server logs (Section 17.2), we need a mechanism for developers to correlate traces:

**Option A: Server returns traceId in error responses**

When the server encounters an error processing a traced request, include the traceId in the error response payload. The App can display: "Something went wrong. Reference: V1StGXR8" -- the user can share this with support, and the developer can grep server logs.

```typescript
// Server error response
{
  error: 'session-not-found',
  message: 'Session does not exist',
  traceId: 'V1StGXR8_Z5jdHi6B-myT'  // <-- include for support reference
}
```

**Option B: Server-side trace query (developer tool)**

A CLI tool or admin endpoint for developers to query server logs:

```bash
# Developer runs on server host
free-server logs --trace V1StGXR8_Z5jdHi6B-myT
free-server logs --session 550e8400 --since 1h --level error
```

Both options should be implemented. Option A is low-cost and immediately useful. Option B is a developer workflow improvement.

---

## 18. Updated Implementation Phases (Post Self-Review)

The phase structure remains the same, but with these adjustments:

### Phase 1 Adjustments
- Remove `Span.child()` method (Section 17.6)
- `Layer` type becomes `string` (Section 17.8)
- MemorySink gains optional persistence config (Section 17.3)
- FileSink exposes `getFilePath()` (Section 17.5)
- LogCollector gains `componentLevels` option (Section 17.10)
- Add `cleanupOldLogs` utility (Section 17.9)

### Phase 3 Adjustments (Server)
- Add traceId to error responses (Section 17.11 Option A)
- Add developer trace query tool (Section 17.11 Option B)
- Configure `componentLevels` to throttle streaming logs (Section 17.10)

### Phase 4 Adjustments (CLI)
- Carefully audit all `logger.info()` calls: user output vs diagnostic (Section 17.4)
- `doctor.ts` is excluded from migration (Section 17.4)
- Expose log file path through `getCollector().getLogFilePath()` (Section 17.5)
- Add log retention cleanup on daemon start (Section 17.9)

### Phase 5 Adjustments (App)
- MemorySink configured with AsyncStorage persistence (Section 17.3)
- Persist logs on `AppState` background event
- Load persisted logs on app launch

### Migration File Count (Corrected)
- **Tier 1 (simple swap):** 89 files -- change import + method names only
- **Tier 2 (trace-aware):** 13 files -- add TraceContext creation/propagation
- **Excluded:** `doctor.ts` (remains console.log)
- **Total modified:** 102 files (unchanged count, but effort is more accurately estimated)

---

## 19. Self-Review Round 2: Hard Blockers

This round focuses on issues that will **prevent the system from working** if not addressed.

### 19.1 [BLOCKER] App Does NOT Depend on @agentbridge/core

**Finding:** `grep -r "@agentbridge/core" apps/free/app/` returns **zero results**. The App has its own encryption (`@/sync/encryption/`), its own types (`@/sync/apiTypes.ts`), and its own WebSocket client (`@/sync/apiSocket.ts`). It does not import anything from `@agentbridge/core`.

**Impact:** The entire premise of "one import from `@agentbridge/core/telemetry`" requires the App to add `@agentbridge/core` as a dependency. This is a non-trivial change:
- `@agentbridge/core` may have Node.js-only dependencies (`fs`, `crypto`, `child_process`) that don't work in React Native
- The core package is 55MB -- adding it to the App bundle may not be acceptable
- The App's build system (Expo/Metro) may need configuration changes

**Solutions (pick one):**

**Option A: Publish telemetry as a separate lightweight package**
```
@agentbridge/telemetry (new, ~10KB, zero Node.js dependencies)
  - types.ts, context.ts, logger.ts, span.ts, collector.ts, sanitizer.ts
  - sinks/types.ts, sinks/memory.ts (platform-agnostic)

@agentbridge/telemetry-node (new, depends on @agentbridge/telemetry)
  - sinks/file.ts (uses fs)
  - sinks/pino.ts (uses pino)
  - exporter.ts (uses archiver/zip)

All three apps import from @agentbridge/telemetry
CLI and Server additionally import from @agentbridge/telemetry-node
```

**Option B: Add telemetry to core but make it tree-shakeable**
```
@agentbridge/core/telemetry  -- platform-agnostic code only
@agentbridge/core/telemetry/node -- Node.js-specific sinks

App adds @agentbridge/core as dependency but only imports /telemetry
Metro bundler tree-shakes unused Node.js code
```

**Option C: Copy the telemetry types/core into the App separately**

This defeats the "single source of truth" goal and is not recommended.

**Recommendation:** Option A. A separate `@agentbridge/telemetry` package with zero platform dependencies. This is the cleanest approach and avoids polluting the App with Node.js code.

### 19.2 [BLOCKER] TraceId Round-Trip Through the Agent is Not Specified

**The gap:** When a user message arrives at the CLI, it flows through:
```
apiSession.ts (receives update) -> routeIncomingMessage() -> pendingMessageCallback
  -> claudeRemote.ts (opts.nextMessage() returns the message)
    -> SDK query() processes it
    -> for await (const message of response) -- agent responses come out
      -> opts.onMessage(message)
        -> claudeRemoteLauncher.ts onMessage()
          -> sdkToLogConverter.convert(msg)
            -> messageQueue.enqueue(logMessage)
              -> session.client.sendClaudeSessionMessage(logMessage)
                -> apiSession.ts enqueueMessage() -- SENDS BACK TO SERVER
```

**The problem:** At step 1, the incoming message has a `_trace` attached to the Socket.IO `update` event. But by the time we reach the last step (sending the agent response back), the `_trace` is gone. There is no variable, no parameter, no field that carries it through the agent processing pipeline.

**Specifically:**
- `routeIncomingMessage()` only extracts the message body, not the `_trace`
- `pendingMessageCallback` receives a `UserMessage`, which has no trace field
- `claudeRemote.opts.nextMessage()` returns `{ message: string, mode: EnhancedMode }` -- no trace
- The agent SDK is a black box; it doesn't know about trace
- `onMessage` callback receives `SDKMessage` -- no trace
- `sendClaudeSessionMessage` and `enqueueMessage` have no trace parameter

**Solution: Turn-level trace binding**

The agent processes one "turn" at a time (user message in -> agent responses out). The CLI should:

1. When receiving a user message via `update` event, extract `_trace` and store it as the **current turn trace**
2. All outgoing messages during this turn attach the stored trace
3. When the turn ends (agent sends `result` message), clear the current turn trace

```typescript
// In ApiSessionClient:
private currentTurnTrace: WireTrace | undefined

// When receiving user message:
socket.on('update', (data) => {
  if (data.body.t === 'new-message') {
    this.currentTurnTrace = data._trace  // <-- capture
    // ... decrypt and route ...
  }
})

// When sending agent response:
enqueueMessage(content: unknown) {
  const trace = this.currentTurnTrace  // <-- attach
  this.pendingOutbox.push({
    content: encrypted,
    localId: randomUUID(),
    _trace: trace,                     // <-- forward
  })
}
```

This is simple and correct because the agent processes turns sequentially. No concurrency issues.

### 19.3 [BLOCKER] HTTP Sync Path Loses Trace Context

**Two paths for messages:**

| Path | Mechanism | Trace context |
|------|-----------|---------------|
| Real-time | Socket.IO `update` event | `_trace` field on event payload -- works |
| Batch sync | HTTP `GET /v3/sessions/:id/messages` | No trace context -- **broken** |

**When batch sync happens:**
- CLI reconnects after disconnect → calls `fetchMessages()` → receives messages via HTTP without any trace
- App opens and initial-syncs all messages → HTTP GET → no trace

**Why it matters:** If the CLI reconnects and re-processes missed messages, those messages have no traceId. The CLI would log them without trace correlation, making debugging incomplete.

**Solution: Store traceId in the database**

The `sessionMessage` table currently stores: `id, sessionId, seq, content (encrypted), localId, createdAt, updatedAt`

Add a `traceId` column (nullable, unencrypted):
```sql
ALTER TABLE session_message ADD COLUMN trace_id TEXT;
```

- When Server creates a message from Socket.IO (with `_trace`): store `traceId` in the column
- When Server creates a message from HTTP POST (with `X-Trace-Id` header): store from header
- When CLI/App fetches messages via HTTP GET: response includes `traceId` per message
- `traceId` is just an opaque string -- it reveals nothing about message content, so storing it unencrypted is safe

**API change:**
```typescript
// GET /v3/sessions/:id/messages response
{
  messages: [
    {
      id: "...",
      seq: 42,
      content: { c: "...", t: "encrypted" },
      localId: "...",
      traceId: "V1StGXR8_Z5jdHi6B-myT",  // <-- NEW
      createdAt: 1709740981456,
      updatedAt: 1709740981456
    }
  ]
}
```

### 19.4 [BLOCKER] Logger Initialization Ordering

**The pattern in every file:**
```typescript
import { Logger } from '@agentbridge/core/telemetry'
const log = new Logger('socket')  // <-- runs at module import time
```

**But `initTelemetry()` is called in `main.ts`:**
```typescript
// main.ts
import './api/socket'  // <-- Logger('socket') runs HERE, before initTelemetry
import { initTelemetry } from '@agentbridge/core/telemetry'

initTelemetry({ layer: 'server', sinks: [...] })  // <-- runs AFTER all imports
```

**Problem:** The `Logger('socket')` constructor runs before the global LogCollector exists. If Logger tries to access the collector in its constructor, it fails. If Logger accesses it lazily at write time, there is a window where early logs are lost.

**Solution: Lazy collector access with startup buffer**

```typescript
// Inside Logger:
class Logger {
  private static startupBuffer: LogEntry[] = []
  private static collectorReady = false

  constructor(private component: string) {
    // Constructor does nothing except store component name.
    // No collector access.
  }

  info(message: string, data?: Record<string, unknown>): void {
    const entry = this.buildEntry('info', message, data)
    if (Logger.collectorReady) {
      getCollector().emit(entry)
    } else {
      Logger.startupBuffer.push(entry)
    }
  }

  // Called by initTelemetry():
  static _onCollectorReady(): void {
    Logger.collectorReady = true
    const collector = getCollector()
    for (const entry of Logger.startupBuffer) {
      collector.emit(entry)
    }
    Logger.startupBuffer = []
  }
}
```

This guarantees:
- Logger can be instantiated at module load time (before initTelemetry)
- Early logs are buffered, not lost
- Once initTelemetry runs, buffer flushes and subsequent logs go directly to collector

### 19.5 [CORRECTED] Sanitizer Runs by Default, Dev Mode Disables It

**Original design (Section 6):** Sanitizer runs in the pipeline before all sinks.

**Round 2 over-correction:** "Only sanitize on export/upload."

**Final decision: Default ON, dev switch OFF.**

Rationale: Local log files can be read by other tools, other users on shared machines, or accidentally shared. Sanitize-by-default is the safe posture. But during active development/debugging, developers need full detail. So add a switch.

```typescript
initTelemetry({
  layer: 'cli',
  sinks: [...],
  // Default: true. Sanitizes all entries in the pipeline before any sink.
  // Set to false in development for full detail in local logs.
  sanitize: process.env.DEBUG ? false : true,
})
```

**Behavior:**
- `sanitize: true` (default, production): All entries are sanitized before reaching any sink. Safe.
- `sanitize: false` (development): Raw entries go to all sinks. Full detail for debugging.
- RemoteSink and diagnostic export **always** sanitize regardless of this flag (outbound data is always redacted)

```typescript
class LogCollector {
  emit(entry: LogEntry): void {
    const toWrite = this.sanitizeEnabled ? this.sanitizer.process(entry) : entry
    for (const sink of this.sinks) {
      sink.write(toWrite)
    }
  }
}

class RemoteSink implements LogSink {
  write(entry: LogEntry): void {
    // ALWAYS sanitize before upload, regardless of global flag
    const sanitized = this.sanitizer.process(entry)
    this.buffer.push(sanitized)
  }
}

function exportDiagnostic(...): Promise<Uint8Array> {
  // ALWAYS sanitize on export, regardless of global flag
  const sanitized = entries.map(e => sanitizer.process(e))
  return buildZip(sanitized, ...)
}
```

### 19.6 [OVER-ENGINEERING] timeline.json in Diagnostic Export is Redundant

**Original design:** Diagnostic zip contains `logs.jsonl` and a derived `timeline.json`.

**Reality:** `logs.jsonl` already contains timestamps and is ordered chronologically. A developer can:
```bash
# This IS the timeline:
cat logs.jsonl | jq '{time: .timestamp, layer: .layer, msg: .message, trace: .traceId}'
```

Generating a separate `timeline.json` requires:
- Defining "events" vs "logs" (arbitrary distinction)
- Extra code to derive timeline from log entries
- Maintenance when new event types are added

**Decision:** Remove `timeline.json` from the export format. Keep it simple:

```
diagnostic-2026-03-06T14-23-01.zip
|-- logs.jsonl          Sanitized log entries
|-- environment.json    Device/version info (anonymized)
```

### 19.7 [REVERTED] _trace on ALL Socket.IO Events -- Keep Original Design

**Round 2 over-correction:** "Only add `_trace` to message, rpc-call, rpc-request, update."

**Final decision: Add `_trace` to ALL events, as originally designed in Section 7.1.**

Rationale: The bandwidth overhead is negligible (~120 bytes per event). But the debugging value is real for every event type:

| Event | Why trace matters |
|-------|-------------------|
| `session-alive` | "Why did the server think the session was dead?" -- heartbeat gaps become visible |
| `session-end` | "Who ended the session and why?" |
| `update-metadata` | "Why did metadata change?" -- correlate with the agent action that triggered it |
| `update-state` | "Why did agent state flip?" -- correlate with the permission request |
| `usage-report` | "Why is this session's cost wrong?" -- trace back to the specific turn |
| `streaming:text-delta` | "Why did streaming stop mid-response?" -- find the exact delta where it broke |
| `streaming:thinking-delta` | Same as text-delta |
| `ephemeral` | "Why did the UI show thinking but nothing happened?" -- correlate with server-side state |

The worst case (streaming at 50 deltas/sec) adds 6KB/s. Messages are already 1-50KB each. This is noise-level overhead. Cutting trace from any event means cutting your ability to debug that event. Not worth the savings.

### 19.8 [ADDITION] The Two-Message-Path Problem

Messages between App and CLI travel through two independent paths. The trace design must handle both:

**Path 1: Real-time (Socket.IO)**
```
App emits('message', { sid, message, _trace })
  -> Server on('message') -> persists -> broadcasts update with _trace
    -> CLI on('update') -> extracts _trace
```

**Path 2: Batch sync (HTTP)**
```
App POST /v3/sessions/:id/messages { messages: [...] }
  -> Server persists (with traceId if in X-Trace-Id header)

CLI GET /v3/sessions/:id/messages?after_seq=N
  -> Server returns messages (with traceId from DB column)
    -> CLI processes, has traceId
```

**Both paths must carry trace context.** The DB storage of traceId (Section 19.3) enables this.

For outgoing messages from CLI (agent responses), the same dual-path applies:
- Real-time: CLI emits Socket.IO `message` event with `_trace` (Section 19.2 turn-level binding)
- Batch: CLI POST to `/v3/sessions/:id/messages` with `X-Trace-Id` header

---

## 20. Updated Architecture Summary (Post Both Reviews)

```
@agentbridge/core/telemetry (sub-path export, platform-agnostic)
  types.ts, context.ts, logger.ts, span.ts, collector.ts, sanitizer.ts
  sinks/types.ts, sinks/memory.ts, sinks/console.ts, sinks/remote.ts

@agentbridge/core/telemetry/node (sub-path export, Node.js-specific)
  sinks/file.ts, exporter.ts, cleanup.ts

Consumers:
  App         -> @agentbridge/core/telemetry (MemorySink + RemoteSink)
  Server      -> @agentbridge/core/telemetry + ./node (FileSink)
  CLI/Daemon  -> @agentbridge/core/telemetry + ./node (FileSink)
```

### Database change:
```
session_message table: ADD traceId TEXT (nullable, unencrypted)
```

### Wire protocol:
```
_trace added to: ALL Socket.IO events (both ClientToServer and ServerToClient)
Overhead is ~120 bytes/event, negligible vs message payloads
```

### Logger initialization:
```
Logger instances: created at module load time (safe, no collector needed)
initTelemetry(): called once in main/entry, flushes startup buffer
```

### Sanitization:
```
Default ON (production): all sinks receive sanitized entries
Dev mode (DEBUG=1): local sinks receive raw entries for full detail
RemoteSink + diagnostic export: ALWAYS sanitize, regardless of flag
```

### Diagnostic export:
```
diagnostic-<timestamp>.zip
  logs.jsonl        (sanitized)
  environment.json  (anonymized)
```

---

## 21. Self-Review Round 3

Angles: implementer ("can I build this?"), user ("can I debug with this?"), ops ("will this break in production?").

### 21.1 [SIMPLIFICATION] One Package in Core, Not Two Separate Packages

**Round 2 recommendation (Section 19.1):** Create `@agentbridge/telemetry` + `@agentbridge/telemetry-node` as two new packages.

**Problem with that:** Two packages means two package.json, two build configs, two version numbers, cross-package dependency management. Overhead for a ~10KB module.

**Better approach: Add to existing `packages/core` with sub-path export.**

`@agentbridge/core` already uses sub-path exports (`./types`, `./interfaces`). Its only runtime dependency is `tweetnacl`. Node.js-specific code (`fs`, `socket.io`) is in peer/optional dependencies. The App can depend on core and only import the telemetry sub-path -- Metro/webpack will tree-shake the rest.

```jsonc
// packages/core/package.json -- add these exports
{
  "exports": {
    // ... existing exports ...
    "./telemetry": {
      "import": "./dist/telemetry/index.mjs",
      "require": "./dist/telemetry/index.cjs"
    },
    "./telemetry/node": {
      "import": "./dist/telemetry/node.mjs",
      "require": "./dist/telemetry/node.cjs"
    }
  }
}
```

```typescript
// App imports (platform-agnostic, no fs/node dependencies):
import { Logger, initTelemetry, MemorySink } from '@agentbridge/core/telemetry'

// CLI/Server imports (adds Node.js sinks):
import { Logger, initTelemetry } from '@agentbridge/core/telemetry'
import { FileSink, exportDiagnostic } from '@agentbridge/core/telemetry/node'
```

**Concrete changes:**
- App's `package.json` adds `"@agentbridge/core": "workspace:*"` as dependency
- `packages/core/src/telemetry/index.ts` exports platform-agnostic code only (Logger, Span, MemorySink, RemoteSink, ConsoleSink, Sanitizer, context functions)
- `packages/core/src/telemetry/node.ts` exports Node.js-specific code (FileSink, exporter, cleanup)
- `packages/core/src/telemetry/node.ts` imports `fs` -- this file is never imported by the App so Metro never resolves `fs`

**This replaces Section 19.1 and Section 20's two-package recommendation.** One package, two entry points.

### 21.2 [SIMPLIFIED] Cross-Device Diagnostic Model

**Original concern:** App (phone), Server (cloud), CLI (laptop) are three machines. App export only has 1/3 of logs.

**Actual situation -- this is simpler than we thought:**

```
Server logs       -> We own the server. We always have these.
App logs          -> Default: RemoteSink uploads to cloud. We have these.
                     Fallback: User exports diagnostic zip from App.
CLI/Daemon logs   -> Default: RemoteSink uploads to cloud. We have these.
                     Fallback: User exports via `free diagnostic export`.
```

**RemoteSink is ON by default** (user can opt-out in settings). This means in the normal case, we already have all three layers' logs on our infrastructure. No need for the App to fetch server logs, no need for a trace query API.

**Developer debugging flow:**

```
1. Get traceId (from server logs, uploaded telemetry, or user report)
2. Query our telemetry backend for traceId=xxx
   -> Returns: app + server + cli entries (all uploaded by RemoteSink)
3. Done. Full trace.
```

**Fallback (user opted out of telemetry):**

```
1. Ask user to export from App: Settings -> Support -> Export Diagnostic Logs
2. Ask user to export from CLI: `free diagnostic export --session xyz`
3. User sends both zips to us
4. We combine with our server logs
5. grep traceId across all three
```

**No new server endpoints needed.** No trace query API. No cross-device fetching. Just RemoteSink doing its job.

**Key implication for RemoteSink design:**
- Default: ON (not opt-in, but opt-OUT)
- Only sends warn/error level + trace metadata (no message content)
- User can disable in Settings -> Privacy
- Clear disclosure in onboarding / privacy policy

### 21.3 [SIMPLIFICATION] Don't Add nanoid -- Use crypto.randomUUID()

**RFC specifies:** `nanoid(21)` for traceId, `nanoid(12)` for spanId.

**Problem:** The project doesn't use nanoid anywhere. Adding a new dependency for ID generation is unnecessary. The codebase already uses:
- `crypto.randomUUID()` in Node.js (CLI, Server)
- `expo-crypto.randomUUID()` in React Native (App)
- `randomKeyNaked(12)` for short IDs (Server)

**Decision: Use `crypto.randomUUID()` for traceId. Use the first 12 chars of a UUID for spanId.**

```typescript
// context.ts
function generateTraceId(): string {
  return crypto.randomUUID()  // "550e8400-e29b-41d4-a716-446655440000" (36 chars)
}

function generateSpanId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)  // "550e8400e29b" (12 chars)
}
```

For React Native, `crypto.randomUUID()` is available via `expo-crypto` or the global `crypto` object (RN 0.76+). The telemetry package should accept an optional `idGenerator` in `initTelemetry()` for environments where `crypto.randomUUID()` isn't available:

```typescript
initTelemetry({
  layer: 'app',
  sinks: [...],
  // Optional: override default ID generation
  generateId: () => expoRandomUUID(),
})
```

**Wire overhead:** 36 chars for traceId instead of 21 chars. Adds ~15 bytes per event. Negligible.

### 21.4 [GAP] FileSink Error Handling (Disk Full)

The current `logger.ts` silently catches `appendFileSync` errors:
```typescript
try {
  appendFileSync(this.logFilePath, logLine);
} catch (appendError) {
  // In production, fail silently
}
```

**FileSink must do the same.** A sink must NEVER throw. If the disk is full, the log entry is silently dropped. The system continues running.

```typescript
// sinks/file.ts
class FileSink implements LogSink {
  write(entry: LogEntry): void {
    try {
      appendFileSync(this.filePath, JSON.stringify(entry) + '\n')
    } catch {
      // Silently drop. Logging must never crash the application.
      // Optionally increment a dropped-count for diagnostics.
      this.droppedCount++
    }
  }
}
```

**This is a universal rule for ALL sinks:** `write()` must never throw. MemorySink can't throw (array push). RemoteSink catches fetch errors. ConsoleSink wraps console.log. FileSink catches fs errors.

### 21.5 [ADDITION] Codemod Script for Tier 1 Migration

89 files need mechanical import replacement. Doing this by hand is error-prone and slow. Include a codemod script in Phase 4/5.

```bash
# scripts/migrate-logger.sh
# Converts old logger imports to new telemetry imports

# CLI: logger.debug -> log.debug, logger.info -> log.info, etc.
# Server: log('msg') -> log.info('msg'), warn('msg') -> log.warn('msg'), etc.
# App: log.log('msg') -> log.info('msg')
```

Approach:
- Use `jscodeshift` or simple `sed` + manual review
- Run per-layer (CLI, then Server, then App)
- Component name derived from file path: `cli/src/claude/loop.ts` -> `Logger('claude-loop')`
- After codemod: run `tsc --noEmit` to catch type errors, then manual review of edge cases (the `logger.info` user-output cases from Section 17.4)

**Add to Phase 4 deliverables:** codemod script and migration guide.

### 21.6 [REMOVED] Server Trace Query Endpoint

No longer needed. Section 21.2 was simplified: RemoteSink uploads App/CLI logs to our infrastructure by default, and we always have server logs. No need for an API endpoint to query server-side traces -- we just grep our own logs.

### 21.7 Summary: What's Changed After Round 3

| # | Change | Type |
|---|--------|------|
| 21.1 | One package in core with sub-path exports, not two separate packages | Simplification |
| 21.2 | RemoteSink default ON, no cross-device fetch API needed | Simplification |
| 21.3 | Use crypto.randomUUID(), not nanoid | Simplification |
| 21.4 | All sinks must never throw | Spec gap |
| 21.5 | Codemod script for 89-file mechanical migration | Tooling |
| 21.6 | Server trace query endpoint removed (not needed) | Removed |

**Nothing is over-engineered this round.** The remaining design is lean. The Span class, sanitizer, componentLevels, and wire format are all justified and minimal.

---

## 22. Self-Review Round 4: Implementation-Level Gaps

No more architecture issues. These are practical details that would block implementation if left unspecified.

### 22.1 RemoteSink minLevel Should Default to 'debug', Not 'warn'

**Current spec (Section 5.5):** `minLevel: 'warn'`

**Problem:** If we only upload warn/error, we miss the normal-flow breadcrumbs. When debugging "message never arrived", we need to see:

```
[info] Sending message         <- missing if minLevel=warn
[info] Message persisted       <- missing
[info] Broadcasting to CLI     <- missing
[ERROR] Encryption failed      <- only this gets uploaded
```

Without the breadcrumbs, the error is an orphan -- we see it failed but not what led to it.

**Volume estimate at debug level:**
- ~50 debug entries/min/session * 200 bytes = ~10KB/min
- 5 sessions * 8 hours = ~24MB/day per user
- Acceptable given NR compression and retention policies

**Corrected default:** `minLevel: 'debug'`. All levels uploaded to enable full remote debugging. Use `componentLevels` to throttle noisy components (e.g. streaming handlers).

### 22.2 RemoteSink Needs Lazy Auth Token

**Problem:** `initTelemetry()` runs early at process startup. The auth token may not be available yet (authentication happens later).

```typescript
// CLI startup order:
initTelemetry({ sinks: [new RemoteSink({ authToken: ??? })] })  // 1. no token yet
const credentials = await authenticate()                          // 2. token obtained here
```

**Solution: authToken accepts a getter function.**

```typescript
class RemoteSink implements LogSink {
  constructor(opts: {
    endpoint: string
    authToken: string | (() => string | undefined)  // string OR lazy getter
    // ...
  })
}
```

When `authToken` is a function, RemoteSink calls it at upload time. If it returns `undefined`, the batch is silently dropped (auth not ready yet). Once auth completes, subsequent batches include the token.

```typescript
// Usage:
let currentToken: string | undefined
const remoteSink = new RemoteSink({
  endpoint: config.serverUrl + '/v1/telemetry/logs',
  authToken: () => currentToken,
})

// Later, after auth:
currentToken = credentials.token
```

### 22.3 Phase 3 Must Explicitly Build the Telemetry Ingest Endpoint

**Current Phase 3 deliverable #7:** "Delete `devRoutes.ts` log endpoint (or replace with `/v1/telemetry/logs`)"

This is too vague. The ingest endpoint is what makes RemoteSink work. It needs concrete spec.

**Add to Phase 3 deliverables:**

```
8. Implement POST /v1/telemetry/logs endpoint:
   - Auth: Bearer token (same as session API), extract userId
   - Body: { entries: LogEntry[] } (max 100 entries per request)
   - Storage: Append to per-day file: ~/.free/logs/telemetry/YYYY-MM-DD.jsonl
     Each entry tagged with userId from auth context
   - Response: 200 OK (no body) or 429 if rate limited
   - Rate limit: 60 requests/minute per user
   - No retry expectation: clients treat this as fire-and-forget
```

Developer querying:
```bash
# On the server, find all telemetry for a trace:
grep "traceId.*abc" ~/.free/logs/telemetry/*.jsonl

# For a specific user's recent errors:
grep "userId.*xxx" ~/.free/logs/telemetry/2026-03-06.jsonl | grep '"level":"error"'
```

### 22.4 Phase 1 Acceptance Criteria References Deleted timeline.json

**Section 12, Phase 1:**
> Exporter produces a valid zip with logs.jsonl, timeline.json, environment.json

**Section 19.6 removed timeline.json.**

**Corrected:** Exporter produces a valid zip with `logs.jsonl` and `environment.json`.

### 22.5 RFC Consolidation Note

This RFC now has Sections 1-16 (original design) + Sections 17-22 (four rounds of corrections). For actual implementation, a developer should read the full document and treat later sections as overriding earlier sections where they conflict. Key override map:

| Topic | Original section | Overridden by |
|-------|-----------------|---------------|
| Message chain (Daemon not in path) | 1.1 | 17.1 |
| Server logs accessibility | 9.1 | 17.2, 21.2 |
| MemorySink persistence | 5.4 | 17.3 |
| Logger vs console.log for user output | 4.1 | 17.4 |
| Log file path exposure | 4.1 | 17.5 |
| Span nesting removed | 4.3 | 17.6 |
| withContext scope (Tier 1 vs Tier 2) | 11.4 | 17.7 |
| Layer type (string not union) | 3.3 | 17.8 |
| Log retention/cleanup | (missing) | 17.9 |
| Component-level throttling | (missing) | 17.10 |
| Error response includes traceId | (missing) | 17.11 |
| Sanitizer default behavior | 6.1 | 19.5 |
| _trace on all events | 7.1 | 19.7 (reverted to original) |
| TraceId round-trip through agent | (missing) | 19.2 |
| HTTP sync path trace | (missing) | 19.3 |
| Logger startup buffer | (missing) | 19.4 |
| Package structure | 2.0 | 21.1 |
| Cross-device diagnostic model | (missing) | 21.2 |
| ID generation | 3.1 | 21.3 |
| Sink error handling | (missing) | 21.4 |
| Migration codemod | (missing) | 21.5 |
| RemoteSink minLevel | 5.5 | 22.1 |
| RemoteSink lazy auth | 5.5 | 22.2 |
| Telemetry ingest endpoint | 12 Phase 3 | 22.3 |

Before starting implementation, it is recommended to produce a consolidated spec by folding all corrections into the main sections. This is a formatting task, not a design task.

---

## 23. Multi-Backend RemoteSink (Axiom + New Relic)

### 23.1 Motivation

We want telemetry data uploaded to a managed SaaS service rather than self-hosting an ingest endpoint. Two backends are supported: **Axiom** and **New Relic**. The system must allow switching between them via configuration, with zero code changes required at the Logger call sites.

This **replaces** Section 22.3's self-built `POST /v1/telemetry/logs` endpoint entirely. We no longer build or maintain our own ingest server.

**Default backend: New Relic.** Both implementations存在代码里，切换只需改一行常量。

### 23.2 Architecture: RemoteBackend Interface

```typescript
/**
 * Abstract backend for RemoteSink.
 * Each provider implements this interface to handle
 * authentication and payload formatting.
 */
interface RemoteBackend {
  readonly name: string

  /**
   * Transform LogEntry[] into the provider-specific HTTP request.
   * Returns null if the backend is not ready (e.g. missing auth token).
   */
  buildRequest(entries: LogEntry[], metadata: DeviceMetadata): RemoteRequest | null
}

interface RemoteRequest {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: string  // JSON-serialized payload
}

interface DeviceMetadata {
  deviceId: string       // anonymous device hash
  appVersion: string
  layer: Layer
  machineId?: string
}
```

### 23.3 Axiom Backend

```typescript
class AxiomBackend implements RemoteBackend {
  readonly name = 'axiom'

  constructor(private opts: {
    dataset: string                        // e.g. 'agentbridge-logs'
    apiToken: string | (() => string | undefined)
    baseUrl?: string                       // default: 'https://api.axiom.co'
  }) {}

  buildRequest(entries: LogEntry[], meta: DeviceMetadata): RemoteRequest | null {
    const token = typeof this.opts.apiToken === 'function'
      ? this.opts.apiToken()
      : this.opts.apiToken
    if (!token) return null

    // Axiom ingest: array of JSON objects, each is one event
    // Axiom auto-detects _time field for timestamp
    const events = entries.map(entry => ({
      _time: entry.timestamp,
      ...entry,
      _deviceId: meta.deviceId,
      _appVersion: meta.appVersion,
      _layer: meta.layer,
      _machineId: meta.machineId,
    }))

    return {
      url: `${this.opts.baseUrl ?? 'https://api.axiom.co'}/v1/datasets/${this.opts.dataset}/ingest`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(events),
    }
  }
}
```

**Axiom specifics:**
- Ingest endpoint: `POST /v1/datasets/{dataset}/ingest`
- Payload: JSON array of events (no wrapper object)
- `_time` field is auto-recognized as timestamp
- Fields prefixed with `_` are Axiom metadata conventions
- Free tier: 500GB/month ingest, 0.5TB storage
- Rate limit: generous (1000 req/s on free tier)

### 23.4 New Relic Backend

```typescript
class NewRelicBackend implements RemoteBackend {
  readonly name = 'newrelic'

  constructor(private opts: {
    licenseKey: string | (() => string | undefined)
    region?: 'us' | 'eu'                  // default: 'us'
  }) {}

  buildRequest(entries: LogEntry[], meta: DeviceMetadata): RemoteRequest | null {
    const key = typeof this.opts.licenseKey === 'function'
      ? this.opts.licenseKey()
      : this.opts.licenseKey
    if (!key) return null

    const baseUrl = this.opts.region === 'eu'
      ? 'https://log-api.eu.newrelic.com'
      : 'https://log-api.newrelic.com'

    // New Relic Log API: array of log entries with common block
    const payload = [{
      common: {
        attributes: {
          'service.name': 'agentbridge',
          'device.id': meta.deviceId,
          'app.version': meta.appVersion,
          'telemetry.layer': meta.layer,
          'machine.id': meta.machineId,
        },
      },
      logs: entries.map(entry => ({
        timestamp: new Date(entry.timestamp).getTime(),  // Unix epoch ms
        message: entry.message,
        level: entry.level,
        attributes: {
          component: entry.component,
          layer: entry.layer,
          traceId: entry.traceId,
          spanId: entry.spanId,
          parentSpanId: entry.parentSpanId,
          sessionId: entry.sessionId,
          machineId: entry.machineId,
          durationMs: entry.durationMs,
          ...entry.data,
          ...(entry.error ? {
            'error.message': entry.error.message,
            'error.stack': entry.error.stack,
            'error.code': entry.error.code,
          } : {}),
        },
      })),
    }]

    return {
      url: `${baseUrl}/log/v1`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': key,
      },
      body: JSON.stringify(payload),
    }
  }
}
```

**New Relic specifics:**
- Ingest endpoint: `POST /log/v1`
- Payload: Array of `{ common, logs }` blocks (NR Log API format)
- `timestamp` must be Unix epoch milliseconds
- Auth via `Api-Key` header (not Bearer)
- Free tier: 100GB/month ingest
- Supports `common.attributes` to avoid repeating per-entry metadata

### 23.5 Updated RemoteSink

RemoteSink no longer knows about HTTP endpoints or auth tokens directly. It delegates to a `RemoteBackend`:

```typescript
class RemoteSink implements LogSink {
  constructor(opts: {
    backend: RemoteBackend
    batchSize?: number          // default: 50
    flushIntervalMs?: number    // default: 30_000
    maxBufferSize?: number      // default: 500
    minLevel?: Level            // default: 'debug' (see Section 22.1)
    metadata: DeviceMetadata
  })

  write(entry: LogEntry): void {
    // ALWAYS sanitize before upload
    const sanitized = this.sanitizer.process(entry)
    if (levelValue(sanitized.level) < levelValue(this.minLevel)) return
    this.buffer.push(sanitized)
    if (this.buffer.length >= this.batchSize) this.flush()
  }

  private async flush(): Promise<void> {
    const batch = this.buffer.splice(0, this.batchSize)
    if (batch.length === 0) return

    const request = this.opts.backend.buildRequest(batch, this.opts.metadata)
    if (!request) return  // backend not ready (no auth token yet)

    try {
      await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      })
    } catch {
      // Silent drop. Telemetry must never block the user.
    }
  }
}
```

### 23.6 Configuration & Switching

Backend is **hardcoded** in a single config file. Default is New Relic. To switch, change one line:

```typescript
// packages/core/src/telemetry/sinks/backends/config.ts

import { AxiomBackend } from './axiom'
import { NewRelicBackend } from './newrelic'
import type { RemoteBackend } from './types'

// ========================================
// Change this line to switch backend:
const ACTIVE_BACKEND: 'axiom' | 'newrelic' = 'newrelic'
// ========================================

const BACKENDS = {
  axiom: () => new AxiomBackend({
    dataset: 'agentbridge-prod',
    apiToken: () => currentTelemetryToken,
  }),
  newrelic: () => new NewRelicBackend({
    licenseKey: () => currentTelemetryToken,
    region: 'us',
  }),
} as const

let currentTelemetryToken: string | undefined

/** Called once after auth to provide the ingest token */
export function setTelemetryToken(token: string): void {
  currentTelemetryToken = token
}

export function createRemoteBackend(): RemoteBackend {
  return BACKENDS[ACTIVE_BACKEND]()
}
```

All layers (App, Server, CLI, Daemon) import from this single file. No env vars, no user settings, no runtime detection.

### 23.7 Token Distribution

API tokens for Axiom/New Relic are **our write-only token**，不是用户的。Server 在 auth 响应里下发：

```
App/CLI auth → server returns { sessionToken, telemetryToken }
```

Client 收到后调 `setTelemetryToken(telemetryToken)` 即可。RemoteBackend 通过 lazy function 读取。

**Security:** Token 是 write-only、scoped 的：
- Axiom: API token 只有 `ingest` 权限，只能写一个 dataset
- New Relic: Ingest License Key，只能写不能查
- 泄露了也只能往 dataset 写垃圾数据

### 23.8 Dataset Strategy

Separate datasets per environment to avoid polluting production data:

| Environment | Axiom Dataset | New Relic Account |
|-------------|---------------|-------------------|
| development | `agentbridge-dev` | Dev sub-account |
| preview | `agentbridge-preview` | Preview sub-account |
| production | `agentbridge-prod` | Production sub-account |

Within each dataset, filter by `_layer` (or `telemetry.layer`) to isolate App / Server / CLI logs.

### 23.9 File Structure Update

```
packages/core/src/telemetry/
|-- sinks/
|   |-- remote.ts           RemoteSink (backend-agnostic)
|   |-- backends/
|   |   |-- types.ts         RemoteBackend interface, DeviceMetadata
|   |   |-- axiom.ts         AxiomBackend
|   |   |-- newrelic.ts      NewRelicBackend
|   |   |-- config.ts        ACTIVE_BACKEND constant + createRemoteBackend()
|   |   |-- index.ts         Re-exports
```

### 23.10 Phase Adjustments

**Phase 1 changes:**
- Add `sinks/backends/types.ts`, `sinks/backends/axiom.ts`, `sinks/backends/newrelic.ts`
- Update `sinks/remote.ts` to use `RemoteBackend` interface
- Unit tests: mock `fetch`, verify each backend produces correct request format

**Phase 3 changes (Server Migration):**
- ~~Build `POST /v1/telemetry/logs` endpoint~~ → **Removed**. No self-hosted ingest.
- Instead: Auth 响应里新增 `telemetryToken` 字段，client 拿到后调 `setTelemetryToken()`
- Server 自己也用 RemoteSink + 同一个 backend（server-side token 直接写配置里）

**New Phase (after Phase 5):**
- Phase 6: Dashboard & Alerting
  - Set up Axiom/New Relic dashboards for key metrics
  - Alert on error rate spikes, trace gaps, session failures

### 23.11 Querying Logs

**Axiom (APL - Axiom Processing Language):**
```apl
// All logs for a trace
['agentbridge-prod']
| where traceId == "V1StGXR8_Z5jdHi6B-myT"
| sort by _time asc

// Error rate by layer in last hour
['agentbridge-prod']
| where _time > ago(1h) and level == "error"
| summarize count() by _layer

// Slow spans
['agentbridge-prod']
| where durationMs > 5000
| project _time, _layer, component, message, durationMs, traceId
```

**New Relic (NRQL):**
```sql
-- All logs for a trace
SELECT * FROM Log
WHERE service.name = 'agentbridge' AND traceId = 'V1StGXR8_Z5jdHi6B-myT'
ORDER BY timestamp ASC

-- Error rate by layer in last hour
SELECT count(*) FROM Log
WHERE service.name = 'agentbridge' AND level = 'error'
FACET telemetry.layer SINCE 1 hour ago

-- Slow spans
SELECT timestamp, telemetry.layer, component, message, durationMs, traceId
FROM Log WHERE durationMs > 5000 SINCE 1 day ago
```

### 23.12 Override Map Update

| Topic | Original section | Overridden by |
|-------|-----------------|---------------|
| RemoteSink constructor (endpoint/authToken) | 5.5 | 23.5 |
| Self-built telemetry ingest endpoint | 22.3 | 23.10 (removed) |
| Upload payload format | 5.5 | 23.3, 23.4 (per-backend) |
| Per-layer init (RemoteSink creation) | 8.1-8.4 | 23.6 |
| Phase 3 deliverable #7/#8 | 12 Phase 3 | 23.10 |

---

## 24. Self-Review Round 5: Implementation-Level Bug & Gap

### 24.1 [BUG] RemoteSink 缺少 Sanitizer 实例

Section 23.5 的 `write()` 调用了 `this.sanitizer.process(entry)`，但新的 constructor（接收 `backend`, `metadata` 等）没有 `sanitizer` 参数。旧的 Section 5.5 有 `extraSanitizer?: Sanitizer`，但在 23.5 重写 constructor 时丢失了。

**修复：** RemoteSink 内部自动创建默认 Sanitizer 实例，不需要外部传入。这符合 Section 19.5 的要求："RemoteSink ALWAYS sanitize, regardless of global flag"。

```typescript
class RemoteSink implements LogSink {
  private readonly sanitizer = new Sanitizer()  // 内部创建，不可绕过

  constructor(opts: {
    backend: RemoteBackend
    batchSize?: number
    flushIntervalMs?: number
    maxBufferSize?: number
    minLevel?: Level
    metadata: DeviceMetadata
  })

  write(entry: LogEntry): void {
    const sanitized = this.sanitizer.process(entry)  // now this.sanitizer exists
    // ...
  }
}
```

### 24.2 [BUG] config.ts 硬编码 `agentbridge-prod`，缺少环境切换

Section 23.6 的 `config.ts` 写死 `dataset: 'agentbridge-prod'`，但 Section 23.8 要求按环境分 dataset（dev/preview/prod）。当前 config 完全没有环境判断。

**修复：** 加一个 `DATASET` 常量，与 `ACTIVE_BACKEND` 同级，根据 build-time 环境变量决定：

```typescript
// packages/core/src/telemetry/sinks/backends/config.ts

import { AxiomBackend } from './axiom'
import { NewRelicBackend } from './newrelic'
import type { RemoteBackend } from './types'

// ========================================
// Change this line to switch backend:
const ACTIVE_BACKEND: 'axiom' | 'newrelic' = 'newrelic'
// ========================================

// Environment-aware dataset/account
// APP_ENV is set at build time: 'development' | 'preview' | 'production'
const ENV = process.env.APP_ENV ?? 'development'
const DATASET_SUFFIX = ENV === 'production' ? 'prod' : ENV === 'preview' ? 'preview' : 'dev'
const DATASET = `agentbridge-${DATASET_SUFFIX}`

let currentTelemetryToken: string | undefined

export function setTelemetryToken(token: string): void {
  currentTelemetryToken = token
}

const BACKENDS = {
  axiom: () => new AxiomBackend({
    dataset: DATASET,
    apiToken: () => currentTelemetryToken,
  }),
  newrelic: () => new NewRelicBackend({
    licenseKey: () => currentTelemetryToken,
    region: 'us',
  }),
} as const

export function createRemoteBackend(): RemoteBackend {
  return BACKENDS[ACTIVE_BACKEND]()
}
```

**React Native 侧** `process.env.APP_ENV` 通过 Expo 的 `extra` 或 `cross-env` 在构建时注入（项目已有 `cross-env APP_ENV=preview` 的用法）。

### 24.3 [性能回退] FileSink 用 `appendFileSync` 对 Server 是退步

当前 Server 的 Pino logger 是**异步写**，不阻塞 event loop。RFC 的 FileSink 用 `appendFileSync`（同步 I/O）。

对 CLI/Daemon 无所谓（单会话，顺序处理）。但 Server 可能同时处理几百个 WebSocket 连接，同步写会阻塞 Fastify 请求处理，在高并发下导致延迟抖动。

**修复：** FileSink 默认用 buffered async write：

```typescript
class FileSink implements LogSink {
  private writeBuffer: string[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: {
    dir: string
    prefix: string
    maxFileSize?: number
    maxFiles?: number
    bufferFlushMs?: number  // default: 100ms. Set 0 for sync mode.
  })

  write(entry: LogEntry): void {
    const line = JSON.stringify(entry) + '\n'
    if (this.bufferFlushMs === 0) {
      // Sync mode (CLI/Daemon): write immediately
      try { appendFileSync(this.filePath, line) } catch { this.droppedCount++ }
    } else {
      // Async mode (Server): buffer and flush periodically
      this.writeBuffer.push(line)
      this.scheduleFlush()
    }
  }

  async flush(): Promise<void> {
    if (this.writeBuffer.length === 0) return
    const batch = this.writeBuffer.join('')
    this.writeBuffer = []
    try {
      await fs.promises.appendFile(this.filePath, batch)
    } catch {
      this.droppedCount += batch.split('\n').length - 1
    }
  }

  // Process exit handler: sync drain
  close(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer)
    if (this.writeBuffer.length > 0) {
      try { appendFileSync(this.filePath, this.writeBuffer.join('')) } catch {}
    }
    return Promise.resolve()
  }
}
```

**初始化时的用法差异：**

```typescript
// Server: async (default)
new FileSink({ dir: logsDir, prefix: 'server' })

// CLI/Daemon: sync for simplicity
new FileSink({ dir: logsDir, prefix: 'cli', bufferFlushMs: 0 })
```

### 24.4 [GAP] DB migration 不在任何 Phase deliverables 里

Section 19.3 设计了 `session_message` 表加 `trace_id TEXT` 列，Section 19.8 和 20 都引用了这个设计。但 Phase 3 的 7 条 deliverables 没有一条提到数据库变更。

**修复：** Phase 3 新增 deliverables：

```
8. DB migration: session_message 表新增 trace_id TEXT (nullable) 列
9. sessionUpdateHandler: 创建 message 时从 _trace 提取 traceId 写入 DB
10. v3SessionRoutes GET /v3/sessions/:id/messages: 响应包含 traceId 字段
11. v3SessionRoutes POST /v3/sessions/:id/messages: 从 X-Trace-Id header 提取存 DB
```

### 24.5 [GAP] RemoteSink 并发 flush 无保护

`flushIntervalMs` 默认 30s。如果网络慢（upload 耗时 > 30s），下一个定时器触发时上一个还在飞。导致多个并发 HTTP 请求、可能乱序投递。

**修复：** 加 `flushing` 标志：

```typescript
class RemoteSink implements LogSink {
  private flushing = false

  private async flush(): Promise<void> {
    if (this.flushing) return  // skip if previous flush still in-flight
    this.flushing = true
    try {
      const batch = this.buffer.splice(0, this.batchSize)
      if (batch.length === 0) return

      const request = this.opts.backend.buildRequest(batch, this.opts.metadata)
      if (!request) {
        // Backend not ready, put entries back
        this.buffer.unshift(...batch)
        return
      }

      try {
        await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
        })
      } catch {
        // Silent drop
      }
    } finally {
      this.flushing = false
    }
  }
}
```

### 24.6 [合规] Default-ON 遥测需要用户同意机制

Section 21.2 说 RemoteSink 默认开启，向 New Relic/Axiom 发送数据。但：
- **Apple App Store** 要求在 App Privacy 中声明数据收集类型
- **GDPR** 对向第三方传输诊断数据需要用户同意
- **Google Play** Data Safety 声明同理

Section 21.2 只写了 "Clear disclosure in onboarding / privacy policy" 一句话，没有具体设计。

**修复：** 不影响核心技术架构，但需明确以下流程：

```
首次启动 → Onboarding 页面 → "帮助我们改进" 开关（默认开）→ 用户确认
                                  ↓
                        consentGranted = true
                        存入 MMKV: '@telemetry/consent' = true
                                  ↓
                   createRemoteBackend() 检查 consent
                   未同意 → return null（不创建 RemoteSink）
```

```typescript
// 修改 createRemoteBackend()
export function createRemoteBackend(): RemoteBackend | null {
  // 对 Server/CLI/Daemon: 我们自己的基础设施，不需要用户同意
  // 对 App: 检查用户同意状态
  if (isApp && !hasUserConsent()) return null
  return BACKENDS[ACTIVE_BACKEND]()
}
```

**App Store/Play Store 需要声明的数据类型：**
- Diagnostics (crash logs, performance data)
- NOT linked to user identity (anonymized deviceId)
- 用于 App Functionality 和 Analytics

### 24.7 [文档矛盾] Phase 4 deliverable #7 与 Section 17.4 冲突

Phase 4 (Section 12) deliverable #7：
> Update `doctor.ts` to use new Logger (convert console.log calls)

Section 17.4：
> `doctor.ts` should NOT be migrated at all. Its 92 `console.log` calls are intentional user-facing diagnostic output.

**修复：** Phase 4 deliverable #7 改为：
```
7. doctor.ts: 不迁移。保持 console.log（用户交互 UI，非诊断日志）
```

### 24.8 [文档矛盾] Section 11.3 替换端点已过时

当前写法：
```
POST /logs-combined-from-cli-and-mobile-for-simple-ai-debugging → POST /v1/telemetry/logs
```

Section 23.10 已删除自建 `/v1/telemetry/logs`。

**修复：** 改为：
```
POST /logs-combined-from-cli-and-mobile-for-simple-ai-debugging → 删除，无替代（RemoteSink 直接上报到 New Relic/Axiom）
```

### 24.9 Override Map Update

| Topic | Original section | Overridden by |
|-------|-----------------|---------------|
| RemoteSink missing sanitizer | 23.5 | 24.1 |
| config.ts hardcoded dataset | 23.6 | 24.2 |
| FileSink sync I/O | 5.3, 16.2 | 24.3 |
| DB migration missing from Phase 3 | 12 Phase 3 | 24.4 |
| RemoteSink concurrent flush | 23.5 | 24.5 |
| Telemetry consent mechanism | 21.2 | 24.6 |
| doctor.ts migration conflict | 12 Phase 4 | 24.7 |
| Old endpoint replacement | 11.3 | 24.8 |

---

## 实现归档（2026-03-16）

### 完成状态

全部 Phase 已完成，139/139 单元测试通过，App/CLI/Server 零 TS 错误。

### 实现文件结构

```
packages/core/src/telemetry/
├── types.ts           TraceContext, LogEntry, Level, WireTrace, LogFilter
├── context.ts         createTrace, continueTrace, resumeTrace, injectTrace, extractTrace
├── logger.ts          Logger class
├── span.ts            Span class（无 child() 方法，遵循 §17.6 简化）
├── collector.ts       LogCollector + initTelemetry() + getCollector()
├── sanitizer.ts       Sanitizer（extraSensitiveKeys 支持）
├── exporter.ts        exportDiagnostic()（ZIP: logs.jsonl + environment.json）
├── cleanup.ts         cleanupOldLogs()（RFC 未详述，额外实现）
├── node.ts            Node.js 平台特定导出（FileSink, exporter, cleanup）
├── index.ts           公共导出（平台无关核心）
│
├── sinks/
│   ├── types.ts       LogSink interface
│   ├── file.ts        FileSink（按小时轮转，非 RFC 的按秒+PID）
│   ├── memory.ts      MemorySink（含 AsyncStorage 持久化，§17.3）
│   ├── remote.ts      RemoteSink（backend 抽象层，非直接 endpoint）
│   └── console.ts     ConsoleSink
│
└── sinks/backends/    （RFC 未设计，额外实现）
    ├── types.ts       RemoteBackend, DeviceMetadata
    ├── config.ts      createRemoteBackend, setTelemetryToken
    ├── serverRelay.ts ServerRelayBackend
    ├── axiom.ts       AxiomBackend
    ├── newrelic.ts    NewRelicBackend
    └── index.ts
```

### 核心 API 与 RFC 一致性

| API | RFC 设计 | 实现 | 一致性 |
|-----|---------|------|--------|
| Logger constructor / debug / info / warn / error | §4.1 | ✅ 完全匹配 | ✅ |
| Logger.withContext() → ScopedLogger | §4.2 | ✅ 完全匹配 | ✅ |
| Span（无 child()，§17.6 简化） | §4.3 | ✅ 完全匹配 | ✅ |
| createTrace / continueTrace / resumeTrace | §4.4, §19.3 | ✅ 完全匹配 | ✅ |
| injectTrace / extractTrace（WireTrace 短字段名） | §4.4 | ✅ 完全匹配 | ✅ |
| LogEntry 数据模型 | §3.2 | ✅ 完全匹配（额外有 userId） | ✅ |
| LogCollector + initTelemetry | §5.1 | ✅ 核心匹配 | ✅ |
| Sanitizer 敏感关键字列表 | §6.1 | ✅ 完全匹配 | ✅ |
| MemorySink（ring buffer + query + onChange） | §5.4 | ✅ 完全匹配 + AsyncStorage 持久化 | ✅ |
| ConsoleSink | §5.6 | ✅ 完全匹配 | ✅ |

### 与原始设计的偏差

1. **FileSink 文件轮转**：RFC 设计按秒+PID 分文件（`{prefix}-{YYYY-MM-DD}-{HH-MM-SS}-{pid}.jsonl`），实际按小时轮转（`{prefix}-{YYYY-MM-DD}-{HH}.jsonl`），减少文件碎片。额外支持 `bufferFlushMs` 异步 buffer（server 模式）
2. **RemoteSink 架构**：RFC 设计直接接收 `endpoint` + `authToken`，实际抽象为 `RemoteBackend` 接口 + 多后端实现（ServerRelay / Axiom / NewRelic）。`minLevel` 默认值为 `'debug'`（RFC §22.1 已对齐）
3. **Exporter 输出**：RFC 描述 `timeline.json`，实际输出 `environment.json`
4. **额外功能**：`componentLevels`（按组件级别过滤）、`setGlobalContextProvider()`（全局 trace provider）、`setIdGenerator()`（自定义 ID 策略）、`isCollectorReady()`、`cleanupOldLogs()` — RFC 未提，均为实现中发现的实际需求
5. **Layer 类型**：RFC §3.3 定义封闭 union `'app' | 'server' | 'cli' | 'daemon' | 'agent'`，§17.8 修正为 `string`，实现遵循修正

### 全栈迁移

App ~70 个文件 + Server storage/main.ts + CLI 调试日志全部从 `console.log` 迁移至 `Logger`。用户终端输出（chalk/doctor/install/auth CLI 命令）保留 `console`。验证：`grep -r "sources/log\|ui/logger\|DANGEROUSLY_LOG" . --include="*.ts"` 返回 0 结果。
