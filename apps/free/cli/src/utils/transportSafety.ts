const DEFAULT_NOTICE_PREVIEW_CHARS = 4_000;

export const MAX_RPC_WIRE_RESPONSE_CHARS = 24 * 1024 * 1024;
export const MAX_RPC_COMMAND_STDOUT_CHARS = 2 * 1024 * 1024;
export const MAX_RPC_COMMAND_STDERR_CHARS = 256 * 1024;
export const MAX_RPC_READ_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_RPC_DIRECTORY_ENTRIES = 5_000;
export const MAX_RPC_DIRECTORY_TREE_NODES = 5_000;

function withTruncationNotice(
  value: string,
  maxChars: number,
  label: string,
  originalLength: number
): string {
  const notice = `\n...[${label} truncated for RPC safety, original length=${originalLength}]`;
  if (notice.length >= maxChars) {
    return notice.slice(0, maxChars);
  }
  const previewChars = Math.max(0, maxChars - notice.length);
  return value.slice(0, previewChars) + notice;
}

export function truncateForRpcTransport(
  value: string,
  maxChars: number,
  label: string
): { value: string; truncated: boolean; originalLength: number } {
  if (value.length <= maxChars) {
    return { value, truncated: false, originalLength: value.length };
  }

  return {
    value: withTruncationNotice(value, maxChars, label, value.length),
    truncated: true,
    originalLength: value.length,
  };
}

export function capCapturedOutput(
  current: string,
  chunk: string,
  maxChars: number
): { value: string; truncated: boolean } {
  if (current.length >= maxChars) {
    return { value: current, truncated: true };
  }

  const remaining = maxChars - current.length;
  if (chunk.length <= remaining) {
    return { value: current + chunk, truncated: false };
  }

  return {
    value: current + chunk.slice(0, remaining),
    truncated: true,
  };
}

export function serializeWithinRpcLimit(
  value: unknown,
  maxChars = MAX_RPC_WIRE_RESPONSE_CHARS
): { ok: true; serialized: string } | { ok: false; error: string } {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > maxChars) {
      return {
        ok: false,
        error: `Serialized RPC payload exceeded safe limit (${serialized.length} > ${maxChars})`,
      };
    }
    return { ok: true, serialized };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Serialized RPC payload could not be encoded safely',
    };
  }
}

export function previewForRpcLog(value: string): string {
  return truncateForRpcTransport(value, DEFAULT_NOTICE_PREVIEW_CHARS, 'log preview').value;
}
