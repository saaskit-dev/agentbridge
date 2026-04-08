/**
 * Covers the race where emitIdleStatus (500ms after last agent_message_chunk) runs
 * before waitForResponseComplete registers idleResolver — previously caused a bogus
 * 10-minute response complete timeout.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AcpBackend } from '../acp.js';
import type { AcpAgentConfig } from '../../../types/agent.js';
import type { AgentMessage } from '../../../interfaces/agent.js';

/** Minimal config: no process spawn — tests inject a mock connection. */
function makeTestConfig(): AcpAgentConfig {
  return {
    cwd: '/tmp',
    agentName: 'opencode',
    transport: 'acp',
    command: 'noop',
    args: [],
  };
}

/**
 * Access private AcpBackend hooks for tests (avoid intersecting with private fields — TS reduces to `never`).
 */
function asInternal(b: AcpBackend): {
  emitIdleStatus(): void;
  connection: { prompt: (req: unknown) => Promise<void> } | null;
  acpSessionId: string | null;
  handleSessionUpdate(params: unknown): void;
} {
  return b as unknown as {
    emitIdleStatus(): void;
    connection: { prompt: (req: unknown) => Promise<void> } | null;
    acpSessionId: string | null;
    handleSessionUpdate(params: unknown): void;
  };
}

describe('AcpBackend idle vs waitForResponseComplete race', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Simulates: emitIdleStatus runs during await prompt() (e.g. 500ms idle after last
   * agent_message_chunk before JSON-RPC prompt returns). waitForResponseComplete must
   * resolve immediately — not wait 10 minutes for a second idle.
   */
  it('resolves waitForResponseComplete when idle was emitted before waiter was registered', async () => {
    const backend = new AcpBackend(makeTestConfig());
    const internal = asInternal(backend);

    internal.connection = {
      prompt: vi.fn(async () => {
        internal.emitIdleStatus();
      }),
    };
    internal.acpSessionId = 'ses_test';

    await backend.sendPrompt('local', [{ type: 'text', text: 'hello' }]);
    await expect(backend.waitForResponseComplete()).resolves.toBeUndefined();
  });

  /**
   * Normal path: prompt returns first; waitForResponseComplete installs idleResolver;
   * then emitIdleStatus resolves the waiter.
   */
  it('resolves waitForResponseComplete when idle is emitted after waiter is registered', async () => {
    const backend = new AcpBackend(makeTestConfig());
    const internal = asInternal(backend);

    internal.connection = {
      prompt: vi.fn().mockResolvedValue(undefined),
    };
    internal.acpSessionId = 'ses_test';

    await backend.sendPrompt('local', [{ type: 'text', text: 'hello' }]);

    const wait = backend.waitForResponseComplete();
    await Promise.resolve();
    internal.emitIdleStatus();
    await expect(wait).resolves.toBeUndefined();
  });

  /**
   * Bug fix: prompt() resolves but idle was never emitted (e.g. all tool calls timed
   * out and cleared activeToolCalls but did NOT call emitIdleStatus). sendPrompt() must
   * force-emit idle so waitForResponseComplete() resolves immediately instead of
   * hanging for the 10-20 min inactivity timeout.
   */
  it('force-emits idle when prompt() resolves with no prior idle emission', async () => {
    const backend = new AcpBackend(makeTestConfig());
    const internal = asInternal(backend);

    // prompt() resolves without any emitIdleStatus call (simulates tool-call-timeout scenario)
    internal.connection = {
      prompt: vi.fn().mockResolvedValue(undefined),
    };
    internal.acpSessionId = 'ses_test';

    await backend.sendPrompt('local', [{ type: 'text', text: 'hello' }]);
    // waitForResponseComplete must resolve immediately — no manual emitIdleStatus needed
    await expect(backend.waitForResponseComplete()).resolves.toBeUndefined();
  });

  /**
   * If prompt fails, the idle-before-wait flag must not leak to the next turn.
   */
  it('clears idle-before-wait flag when sendPrompt throws', async () => {
    const backend = new AcpBackend(makeTestConfig());
    const internal = asInternal(backend);

    internal.connection = {
      prompt: vi.fn().mockRejectedValue(new Error('boom')),
    };
    internal.acpSessionId = 'ses_test';

    await expect(backend.sendPrompt('local', [{ type: 'text', text: 'hello' }])).rejects.toThrow('boom');

    internal.connection = {
      prompt: vi.fn().mockResolvedValue(undefined),
    };

    await backend.sendPrompt('local', [{ type: 'text', text: 'again' }]);
    const wait = backend.waitForResponseComplete();
    await Promise.resolve();
    internal.emitIdleStatus();
    await expect(wait).resolves.toBeUndefined();
  });

  it('emits token-count when prompt() returns ACP usage', async () => {
    const backend = new AcpBackend(makeTestConfig());
    const internal = asInternal(backend);
    const messages: AgentMessage[] = [];

    backend.onMessage(msg => {
      messages.push(msg);
    });

    internal.connection = {
      prompt: vi.fn().mockResolvedValue({
        stopReason: 'end_turn',
        usage: {
          inputTokens: 120,
          outputTokens: 45,
          cachedReadTokens: 30,
          cachedWriteTokens: 15,
          totalTokens: 210,
        },
      }),
    };
    internal.acpSessionId = 'ses_test';

    await backend.sendPrompt('local', [{ type: 'text', text: 'hello' }]);

    expect(messages).toContainEqual({
      type: 'token-count',
      input_tokens: 120,
      output_tokens: 45,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 15,
    });
  });

  it('emits non-reporting token-count when session_update is usage_update', () => {
    const backend = new AcpBackend(makeTestConfig());
    const internal = asInternal(backend);
    const messages: AgentMessage[] = [];

    backend.onMessage(msg => {
      messages.push(msg);
    });

    internal.handleSessionUpdate({
      update: {
        sessionUpdate: 'usage_update',
        used: 4321,
        size: 128000,
      },
    });

    expect(messages).toContainEqual({
      type: 'token-count',
      input_tokens: 0,
      output_tokens: 0,
      context_used_tokens: 4321,
      context_window_size: 128000,
      reportToServer: false,
    });
  });
});
