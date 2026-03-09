/**
 * Truncation utility for logging large objects
 *
 * Recursively truncates strings and arrays within an object
 * to produce a readable summary suitable for log files.
 */

export function truncateForLog(
  obj: unknown,
  maxStringLength: number = 100,
  maxArrayLength: number = 10
): unknown {
  if (typeof obj === 'string') {
    return obj.length > maxStringLength
      ? obj.substring(0, maxStringLength) + '... [truncated]'
      : obj;
  }

  if (Array.isArray(obj)) {
    const truncated = obj.map(item => truncateForLog(item, maxStringLength, maxArrayLength)).slice(0, maxArrayLength);
    if (obj.length > maxArrayLength) {
      truncated.push(`... [${obj.length - maxArrayLength} more items]`);
    }
    return truncated;
  }

  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'usage') continue;
      result[key] = truncateForLog(value, maxStringLength, maxArrayLength);
    }
    return result;
  }

  return obj;
}
