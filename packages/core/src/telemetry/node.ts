// Node.js-specific telemetry exports
// This entry point uses 'fs' and other Node.js APIs

export { FileSink } from './sinks/file.js';
export type { FileSinkOptions } from './sinks/file.js';
export { exportDiagnostic } from './exporter.js';
export type { ExportOptions, ExportResult } from './exporter.js';
export { cleanupOldLogs } from './cleanup.js';
export type { CleanupOptions } from './cleanup.js';
