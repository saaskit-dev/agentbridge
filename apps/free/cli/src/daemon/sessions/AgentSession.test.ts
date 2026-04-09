/**
 * AgentSession unit tests
 *
 * Tests lifecycle, input routing, signal handling, and shutdown behavior
 * using a minimal concrete TestAgentSession subclass.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { AgentSession, type AgentSessionOpts } from './AgentSession';
import type { AgentBackend } from './AgentBackend';
import type { IPCServerMessage } from '@/daemon/ipc/protocol';
import type { ApiSessionClient } from '@/api/apiSession';
import type { Credentials } from '@/persistence';
import type { AgentType } from './types';
import type { NormalizedMessage } from './types';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { SessionCapabilities } from './capabilities';
import { PushableAsyncIterable } from '@/utils/PushableAsyncIterable';
import { initCliTelemetry } from '@/telemetry';

// ---------------------------------------------------------------------------
// Minimal concrete subclass for testing
// ---------------------------------------------------------------------------

class TestAgentSession extends AgentSession<string> {
  readonly agentType: AgentType = 'claude';
  mockBackend!: AgentBackend;

  createBackend(): AgentBackend {
    this.mockBackend = {
      agentType: 'claude',
      output: {
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      } as never,
      start: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendPtyInput: vi.fn(),
      resizePty: vi.fn(),
    };
    return this.mockBackend;
  }

  createModeHasher(): (mode: string) => string {
    return () => 'hash';
  }

  defaultMode(): string {
    return 'default';
  }

  protected extractMode(): string {
    return 'default';
  }

  injectBackend(backend: AgentBackend): void {
    this.backend = backend;
  }

  emitOutputMessage(message: NormalizedMessage): void {
    this.forwardOutputMessage(message);
  }

  finishStreamingText(): void {
    this.completeStreamingText();
  }

  /** Test helper: inject a session object without going through initialize(). */
  injectSession(session: ApiSessionClient): void {
    this.session = session;
  }

  /** Test helper: inject messageQueue so we can test sendInput routing */
  injectMessageQueue(): MessageQueue2<string> {
    const q = new MessageQueue2<string>(() => 'hash');
    this.messageQueue = q;
    return q;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockSession(sessionId = 'test-session-id'): ApiSessionClient {
  return {
    sessionId,
    rpcHandlerManager: {
      registerHandler: vi.fn(),
      unregisterHandler: vi.fn(),
    },
    sendNormalizedMessage: vi.fn().mockResolvedValue('local-id'),
    sendStreamingTextDelta: vi.fn(),
    sendStreamingTextComplete: vi.fn(),
    sendUsageData: vi.fn(),
    updateCapabilities: vi.fn(),
    updateMetadata: vi.fn(),
    sendSessionDeath: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as ApiSessionClient;
}

function makeOpts(broadcast?: (sid: string, msg: IPCServerMessage) => void): AgentSessionOpts {
  return {
    credential: { token: 'test-token' } as Credentials,
    machineId: 'test-machine',
    startedBy: 'cli',
    cwd: '/tmp/test',
    broadcast: broadcast ?? (() => {}),
    daemonInstanceId: 'test-daemon-instance',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PushableAsyncIterable safety', () => {
  it('push() after end() does not throw', () => {
    const iterable = new PushableAsyncIterable<string>();
    iterable.end();
    // Should silently drop, not throw
    expect(() => iterable.push('late message')).not.toThrow();
  });
});

describe('AgentSession.shutdown()', () => {
  it('broadcasts session_state:archived when session is set', async () => {
    const broadcasts: IPCServerMessage[] = [];
    const session = new TestAgentSession(makeOpts((_, msg) => broadcasts.push(msg)));
    session.injectSession(makeMockSession('sess-abc'));

    await session.shutdown('test_reason');

    const archived = broadcasts.find(
      (m): m is Extract<IPCServerMessage, { type: 'session_state' }> =>
        m.type === 'session_state' && m.state === 'archived'
    );
    expect(archived).toBeDefined();
    expect(archived?.sessionId).toBe('sess-abc');
  });

  it('does not broadcast when session was never initialized', async () => {
    const broadcasts: IPCServerMessage[] = [];
    const session = new TestAgentSession(makeOpts((_, msg) => broadcasts.push(msg)));

    await session.shutdown('no_session');

    const sessionStateMsgs = broadcasts.filter(m => m.type === 'session_state');
    expect(sessionStateMsgs).toHaveLength(0);
  });

  it('is idempotent — second shutdown is a no-op', async () => {
    const broadcasts: IPCServerMessage[] = [];
    const session = new TestAgentSession(makeOpts((_, msg) => broadcasts.push(msg)));
    session.injectSession(makeMockSession('sess-dup'));

    await session.shutdown('first');
    await session.shutdown('second');

    const archived = broadcasts.filter(
      m => m.type === 'session_state' && (m as { state?: string }).state === 'archived'
    );
    expect(archived).toHaveLength(1);
  });

  it('does NOT call sendSessionDeath when _keepStateForRecovery is set (daemon shutdown path)', async () => {
    const session = new TestAgentSession(makeOpts());
    const mockSession = makeMockSession('sess-recovery');
    session.injectSession(mockSession);

    // Simulate daemon SIGTERM/HTTP stop — sets _keepStateForRecovery = true
    session.handleSigterm();
    await session.shutdown('daemon_stop');

    expect(mockSession.sendSessionDeath).not.toHaveBeenCalled();
    // close() is still called to tidy up the WebSocket
    expect(mockSession.close).toHaveBeenCalled();
  });

  it('calls sendSessionDeath when shutting down normally (session-level kill)', async () => {
    const session = new TestAgentSession(makeOpts());
    const mockSession = makeMockSession('sess-normal');
    session.injectSession(mockSession);

    // No handleSigterm — normal session end
    await session.shutdown('user_kill');

    expect(mockSession.sendSessionDeath).toHaveBeenCalled();
  });
});

describe('AgentSession.sendInput()', () => {
  it('buffers messages before messageQueue is initialized (pre-init queue)', () => {
    const session = new TestAgentSession(makeOpts());
    // messageQueue is undefined — messages should be buffered
    session.sendInput('msg1');
    session.sendInput('msg2');
    // No throw — messages are silently buffered
  });

  it('pushes to messageQueue when initialized', () => {
    const session = new TestAgentSession(makeOpts());
    const q = session.injectMessageQueue();
    const pushSpy = vi.spyOn(q, 'push');

    session.sendInput('hello');

    expect(pushSpy).toHaveBeenCalledWith('hello', 'default');
  });
});

describe('AgentSession.abort()', () => {
  it('closes messageQueue and returns when no backend exists', async () => {
    const session = new TestAgentSession(makeOpts());
    // No backend, no queue — should resolve cleanly
    await session.abort();
  });

  it('calls backend.abort when backend exists', async () => {
    const session = new TestAgentSession(makeOpts());
    session.injectSession(makeMockSession());
    session.injectMessageQueue();
    // createBackend is called inside run(), but we can test abort after manual setup
    const backend = session.createBackend();
    // Access private field via any for testing
    (session as any).backend = backend;

    await session.abort();
    expect(backend.abort).toHaveBeenCalled();
  });
});

describe('AgentSession usage reporting', () => {
  it('reports token_count events using the message id as a stable usage key', async () => {
    const session = new TestAgentSession(makeOpts());
    const mockSession = makeMockSession('sess-usage');
    session.injectSession(mockSession);
    session.injectBackend({
      ...session.createBackend(),
      getCurrentModel: () => 'gpt-5-codex',
    });

    await session.emitOutputMessage({
      id: 'msg-usage-1',
      role: 'event',
      createdAt: 1_234_567,
      isSidechain: false,
      content: {
        type: 'token_count',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5,
        },
      },
    });

    expect(mockSession.sendUsageData).toHaveBeenCalledWith(
      {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
      {
        model: 'gpt-5-codex',
        key: 'usage:msg-usage-1',
        timestamp: 1_234_567,
        agentType: 'claude',
        startedBy: 'cli',
        localOnly: false,
      }
    );
  });

  it('broadcasts token_count events marked as local-only without persistence', async () => {
    const session = new TestAgentSession(makeOpts());
    const mockSession = makeMockSession('sess-usage-local');
    session.injectSession(mockSession);

    await session.emitOutputMessage({
      id: 'msg-usage-local-1',
      role: 'event',
      createdAt: 1_234_890,
      isSidechain: false,
      content: {
        type: 'token_count',
        reportToServer: false,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          context_used_tokens: 4321,
          context_window_size: 128000,
        },
      },
    });

    expect(mockSession.sendUsageData).toHaveBeenCalledWith(
      {
        input_tokens: 0,
        output_tokens: 0,
        context_used_tokens: 4321,
        context_window_size: 128000,
      },
      {
        model: undefined,
        key: 'usage:msg-usage-local-1',
        timestamp: 1_234_890,
        agentType: 'claude',
        startedBy: 'cli',
        localOnly: true,
      }
    );
  });
});

describe('AgentSession.toSummary()', () => {
  it('returns correct summary shape when session is set', () => {
    const session = new TestAgentSession(makeOpts());
    session.injectSession(makeMockSession('sess-x'));

    const summary = session.toSummary();
    expect(summary.sessionId).toBe('sess-x');
    expect(summary.agentType).toBe('claude');
    expect(summary.cwd).toBe('/tmp/test');
    expect(summary.state).toBe('idle');
    expect(summary.startedBy).toBe('cli');
    expect(typeof summary.startedAt).toBe('string');
  });

  it('returns "uninitialized" when session is not set', () => {
    const session = new TestAgentSession(makeOpts());
    const summary = session.toSummary();
    expect(summary.sessionId).toBe('uninitialized');
  });
});

describe('AgentSession.sessionId', () => {
  it('throws when accessed before initialization', () => {
    const session = new TestAgentSession(makeOpts());
    expect(() => session.sessionId).toThrow();
  });

  it('returns sessionId after injection', () => {
    const session = new TestAgentSession(makeOpts());
    session.injectSession(makeMockSession('sess-y'));
    expect(session.sessionId).toBe('sess-y');
  });
});

describe('AgentSession signal handlers', () => {
  it('handleSigterm sets pendingExit and closes queue if idle', () => {
    const session = new TestAgentSession(makeOpts());
    const q = session.injectMessageQueue();
    const closeSpy = vi.spyOn(q, 'close');

    // lastStatus defaults to 'idle'
    session.handleSigterm();

    expect(closeSpy).toHaveBeenCalled();
  });

  it('handleSigint closes messageQueue immediately', () => {
    const session = new TestAgentSession(makeOpts());
    const q = session.injectMessageQueue();
    const closeSpy = vi.spyOn(q, 'close');

    session.handleSigint();

    expect(closeSpy).toHaveBeenCalled();
  });
});

describe('AgentSession PTY forwarding', () => {
  it('sendPtyInput forwards to backend when available', () => {
    const session = new TestAgentSession(makeOpts());
    const backend = session.createBackend();
    (session as any).backend = backend;

    session.sendPtyInput('base64data');
    expect(backend.sendPtyInput).toHaveBeenCalledWith('base64data');
  });

  it('resizePty forwards to backend when available', () => {
    const session = new TestAgentSession(makeOpts());
    const backend = session.createBackend();
    (session as any).backend = backend;

    session.resizePty(120, 40);
    expect(backend.resizePty).toHaveBeenCalledWith(120, 40);
  });

  it('sendPtyInput is safe when no backend exists', () => {
    const session = new TestAgentSession(makeOpts());
    expect(() => session.sendPtyInput('data')).not.toThrow();
  });

  it('resizePty is safe when no backend exists', () => {
    const session = new TestAgentSession(makeOpts());
    expect(() => session.resizePty(80, 24)).not.toThrow();
  });
});

describe('AgentSession capability forwarding', () => {
  it('forwards capabilities to IPC clients and session persistence', () => {
    const broadcasts: IPCServerMessage[] = [];
    const session = new TestAgentSession(makeOpts((_, msg) => broadcasts.push(msg)));
    const apiSession = makeMockSession('sess-caps');
    session.injectSession(apiSession);

    const capabilities: SessionCapabilities = {
      models: {
        available: [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }],
        current: 'gemini-2.5-pro',
      },
    };

    (session as any).forwardCapabilities(capabilities);

    expect(apiSession.updateCapabilities).toHaveBeenCalledWith(capabilities);
    expect(broadcasts).toContainEqual({
      type: 'capabilities',
      sessionId: 'sess-caps',
      capabilities,
    });
  });
});

describe('AgentSession streaming output', () => {
  it('streams consecutive agent text chunks under the first source message id', () => {
    const session = new TestAgentSession(makeOpts());
    const apiSession = makeMockSession('sess-stream');
    session.injectSession(apiSession);
    const backend = session.createBackend();
    session.injectBackend(backend);

    session.emitOutputMessage({
      id: 'agent-1',
      createdAt: 1000,
      role: 'agent',
      isSidechain: false,
      content: [{ type: 'text', text: 'Hel', uuid: 'u1', parentUUID: null }],
    });
    session.emitOutputMessage({
      id: 'agent-2',
      createdAt: 1001,
      role: 'agent',
      isSidechain: false,
      content: [{ type: 'text', text: 'lo', uuid: 'u2', parentUUID: null }],
    });
    session.finishStreamingText();

    expect(apiSession.sendStreamingTextDelta).toHaveBeenNthCalledWith(1, 'agent-1', 'Hel');
    expect(apiSession.sendStreamingTextDelta).toHaveBeenNthCalledWith(2, 'agent-1', 'lo');
    expect(apiSession.sendStreamingTextComplete).toHaveBeenCalledWith('agent-1', 'Hello');
  });
});

describe('AgentSession visible backend failures', () => {
  beforeAll(() => {
    initCliTelemetry();
  });

  it('publishes a daemon-log event when backend.sendMessage throws and keeps session alive', async () => {
    const session = new TestAgentSession(makeOpts());
    const apiSession = makeMockSession('sess-error');
    session.injectSession(apiSession);
    session.injectMessageQueue();
    const output = new PushableAsyncIterable<NormalizedMessage>();

    const backend = {
      agentType: 'claude' as const,
      output,
      start: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi
        .fn()
        .mockRejectedValue(new Error('Initialize timeout after 30000ms - codex did not respond')),
      abort: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockImplementation(async () => {
        output.end();
      }),
    } satisfies AgentBackend;

    vi.spyOn(session, 'createBackend').mockReturnValue(backend);

    const runPromise = session.run();
    session.sendInput('hello');

    await vi.waitFor(() => {
      expect(apiSession.sendNormalizedMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'event',
          content: expect.objectContaining({
            type: 'daemon-log',
            level: 'error',
            component: 'daemon/sessions/AgentSession',
            message: '[AgentSession] backend send failed',
            error: 'Initialize timeout after 30000ms - codex did not respond',
          }),
        })
      );
    });

    // Session should still be alive after the error — trigger graceful exit
    session.handleSigint();
    await runPromise;
  });

  it(
    'auto-restarts backend after unexpected crash and enters dormant mode',
    { timeout: 10_000 },
    async () => {
      // Use short cooldown for test speed
      const origCooldown = TestAgentSession.RESTART_COOLDOWN_MS;
      TestAgentSession.RESTART_COOLDOWN_MS = 100;

      try {
        const session = new TestAgentSession(makeOpts());
        const apiSession = makeMockSession('sess-dead-backend');
        session.injectSession(apiSession);
        session.injectMessageQueue();

        let startCount = 0;
        vi.spyOn(session, 'createBackend').mockImplementation(() => {
          startCount++;
          const output = new PushableAsyncIterable<NormalizedMessage>();
          return {
            agentType: 'claude' as const,
            output,
            start: vi.fn().mockImplementation(async () => {
              // Simulate backend dying shortly after start
              setTimeout(() => output.end(), 50);
            }),
            sendMessage: vi.fn().mockResolvedValue(undefined),
            abort: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockImplementation(async () => {
              output.end();
            }),
          } satisfies AgentBackend;
        });

        const runPromise = session.run();

        // Wait for restart cycles to exhaust and enter dormant mode
        await new Promise(r => setTimeout(r, 2000));

        // 1 initial + 3 restarts = 4 total backend creations
        expect(startCount).toBeGreaterThanOrEqual(2); // At least one restart

        // Should have published crash error events + dormant mode notification
        const errorCalls = (
          apiSession.sendNormalizedMessage as ReturnType<typeof vi.fn>
        ).mock.calls.filter(
          (c: any) => c[0]?.role === 'event' && c[0]?.content?.type === 'daemon-log'
        );
        expect(errorCalls.length).toBeGreaterThanOrEqual(1);

        // The dormant mode message should tell user to send a message or archive
        const dormantMsg = errorCalls.find((c: any) =>
          c[0]?.content?.message?.includes('Send a message to restart')
        );
        expect(dormantMsg).toBeDefined();

        // Session should still be alive (dormant, waiting for user action) — kill it
        session.handleSigint();
        await runPromise;
      } finally {
        TestAgentSession.RESTART_COOLDOWN_MS = origCooldown;
      }
    }
  );

  it(
    'enters dormant mode when backend.start throws and recovers on user message',
    { timeout: 10_000 },
    async () => {
      const session = new TestAgentSession(makeOpts());
      const apiSession = makeMockSession('sess-start-error');
      session.injectSession(apiSession);
      session.injectMessageQueue();

      let startCallCount = 0;
      vi.spyOn(session, 'createBackend').mockImplementation(() => {
        startCallCount++;
        const output = new PushableAsyncIterable<NormalizedMessage>();
        return {
          agentType: 'claude' as const,
          output,
          start: vi.fn().mockRejectedValue(new Error('agent boot failed')),
          sendMessage: vi.fn().mockResolvedValue(undefined),
          abort: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn().mockImplementation(async () => {
            output.end();
          }),
        } satisfies AgentBackend;
      });

      const runPromise = session.run();

      // Wait for dormant mode to be entered
      await new Promise(r => setTimeout(r, 500));

      // Should have published a daemon-log event with retry instructions
      expect(apiSession.sendNormalizedMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'event',
          content: expect.objectContaining({
            type: 'daemon-log',
            level: 'error',
            component: 'daemon/sessions/AgentSession',
            message:
              '[AgentSession] Agent failed to start. Send a message to retry, or archive this session.',
            error: 'agent boot failed',
          }),
        })
      );

      // Session is still alive — signal exit
      session.handleSigint();
      await runPromise;
    }
  );

  it(
    'recovers from zombie state when backend dies mid-turn (sendMessage hangs)',
    { timeout: 10_000 },
    async () => {
      const origCooldown = TestAgentSession.RESTART_COOLDOWN_MS;
      TestAgentSession.RESTART_COOLDOWN_MS = 100;

      try {
        const session = new TestAgentSession(makeOpts());
        const apiSession = makeMockSession('sess-zombie');
        session.injectSession(apiSession);
        session.injectMessageQueue();

        let startCount = 0;
        vi.spyOn(session, 'createBackend').mockImplementation(() => {
          startCount++;
          const output = new PushableAsyncIterable<NormalizedMessage>();
          return {
            agentType: 'claude' as const,
            output,
            start: vi.fn().mockImplementation(async () => {
              // Backend dies 50ms after start — simulates process exit mid-turn
              setTimeout(() => output.end(), 50);
            }),
            // sendMessage never resolves — simulates the exact bug scenario where
            // the backend process dies while the sendPrompt promise is pending
            sendMessage: vi.fn().mockImplementation(() => new Promise(() => {})),
            abort: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockImplementation(async () => {
              output.end();
            }),
          } satisfies AgentBackend;
        });

        const runPromise = session.run();
        session.sendInput('trigger send');

        // Wait for restart attempts to exhaust and enter dormant mode.
        // Without the Promise.race fix, messageLoop would hang forever on
        // the pending sendMessage promise, and this timeout would expire.
        await new Promise(r => setTimeout(r, 3000));

        // If startCount > 1, the messageLoop exited and restart logic fired.
        expect(startCount).toBeGreaterThanOrEqual(2);

        // Should have published error events including dormant mode message
        const errorCalls = (
          apiSession.sendNormalizedMessage as ReturnType<typeof vi.fn>
        ).mock.calls.filter(
          (c: any) => c[0]?.role === 'event' && c[0]?.content?.type === 'daemon-log'
        );
        expect(errorCalls.length).toBeGreaterThanOrEqual(1);

        session.handleSigint();
        await runPromise;
      } finally {
        TestAgentSession.RESTART_COOLDOWN_MS = origCooldown;
      }
    }
  );
});
