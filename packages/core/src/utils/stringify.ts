/**
 * Type-aware stringification utility.
 *
 * Unlike the built-in `String()`, this handles objects, Errors, and other
 * complex types in a way that preserves useful information instead of
 * producing `[object Object]`.
 *
 * For Error instances, returns just `.message` — this makes it a drop-in
 * replacement for the common `error instanceof Error ? error.message : String(error)` pattern.
 */
export function safeStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'symbol':
      return value.toString();
    case 'function':
      return value.name ? `[Function: ${value.name}]` : '[Function]';
    case 'object':
      break;
    default:
      return String(value);
  }

  // Error — return .message only (callers who need .name/.stack can read them directly)
  if (value instanceof Error) {
    return value.message || value.name || 'Error';
  }

  // Date
  if (value instanceof Date) {
    return value.toISOString();
  }

  // RegExp
  if (value instanceof RegExp) {
    return value.toString();
  }

  // ArrayBuffer / TypedArray
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return `[${value.constructor.name} byteLength=${value instanceof ArrayBuffer ? value.byteLength : (value as ArrayBufferView).byteLength}]`;
  }

  // Plain objects & arrays — JSON.stringify with a safety net
  try {
    return JSON.stringify(value);
  } catch {
    // Circular references, BigInt inside objects, etc.
    return Object.prototype.toString.call(value);
  }
}

/**
 * Extract a human-friendly error/detail message from unknown values.
 *
 * Prefers common structured fields like `error`, `message`, `stderr`, `details`,
 * then falls back to `safeStringify`.
 */
export function extractErrorMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || value.name || 'Error';

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;

    if (typeof record.error === 'string') return record.error;
    if (record.error instanceof Error) return record.error.message || record.error.name || 'Error';

    if (typeof record.message === 'string') return record.message;
    if (typeof record.stderr === 'string' && record.stderr.trim()) return record.stderr;
    if (typeof record.details === 'string' && record.details.trim()) return record.details;
    if (typeof record.reason === 'string' && record.reason.trim()) return record.reason;
    if (typeof record.status === 'string' && record.status.trim()) return record.status;

    return safeStringify(value);
  }

  return String(value);
}

/**
 * Coerce an unknown caught value into an Error instance.
 *
 * Drop-in replacement for the common pattern:
 *   `error instanceof Error ? error : new Error(String(error))`
 *
 * Also useful as the second argument to `logger.error()`.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(safeStringify(value));
}
