import { describe, expect, it } from 'vitest';
import {
  MAX_RPC_COMMAND_STDOUT_CHARS,
  capCapturedOutput,
  truncateForRpcTransport,
} from '../transportSafety';

describe('transportSafety', () => {
  it('truncates oversized strings with a notice', () => {
    const result = truncateForRpcTransport('x'.repeat(256), 64, 'stdout');
    expect(result.truncated).toBe(true);
    expect(result.originalLength).toBe(256);
    expect(result.value).toContain('truncated for RPC safety');
    expect(result.value.length).toBeLessThanOrEqual(64);
  });

  it('caps streamed output accumulation', () => {
    let current = '';
    let truncated = false;

    for (const chunk of [
      'a'.repeat(MAX_RPC_COMMAND_STDOUT_CHARS / 2),
      'b'.repeat(MAX_RPC_COMMAND_STDOUT_CHARS),
    ]) {
      const next = capCapturedOutput(current, chunk, MAX_RPC_COMMAND_STDOUT_CHARS);
      current = next.value;
      truncated = truncated || next.truncated;
    }

    expect(truncated).toBe(true);
    expect(current.length).toBe(MAX_RPC_COMMAND_STDOUT_CHARS);
    expect(current).toBe(
      'a'.repeat(MAX_RPC_COMMAND_STDOUT_CHARS / 2) +
        'b'.repeat(MAX_RPC_COMMAND_STDOUT_CHARS / 2)
    );
  });
});
