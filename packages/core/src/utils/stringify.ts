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
