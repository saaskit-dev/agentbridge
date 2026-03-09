// Platform-agnostic telemetry exports
// All code in this entry point runs in Node.js AND React Native

// Core types
export type { TraceContext, LogEntry, Level, WireTrace, LogFilter } from './types.js'
export { LEVEL_VALUES, levelValue } from './types.js'

// Trace context
export { createTrace, continueTrace, resumeTrace, injectTrace, extractTrace, setIdGenerator } from './context.js'
export type { IdGenerator } from './context.js'

// Logger
export { Logger, setGlobalContextProvider } from './logger.js'
export type { ScopedLogger } from './logger.js'

// Span
export { Span } from './span.js'

// Collector
export { LogCollector, initTelemetry, getCollector, isCollectorReady } from './collector.js'
export type { InitTelemetryOptions } from './collector.js'

// Sanitizer
export { Sanitizer } from './sanitizer.js'

// Sinks (platform-agnostic)
export type { LogSink } from './sinks/types.js'
export { MemorySink } from './sinks/memory.js'
export type { MemorySinkOptions, AsyncStorageLike } from './sinks/memory.js'
export { ConsoleSink } from './sinks/console.js'
export { RemoteSink } from './sinks/remote.js'
export type { RemoteSinkOptions } from './sinks/remote.js'

// Remote backends
export { AxiomBackend } from './sinks/backends/axiom.js'
export { NewRelicBackend } from './sinks/backends/newrelic.js'
export { ServerRelayBackend } from './sinks/backends/serverRelay.js'
export type { ServerRelayBackendOptions } from './sinks/backends/serverRelay.js'
export type { RemoteBackend, RemoteRequest, DeviceMetadata } from './sinks/backends/types.js'
export { createRemoteBackend, setTelemetryToken } from './sinks/backends/config.js'
