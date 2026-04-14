/**
 * AgentSession unit tests
 *
 * Tests lifecycle, input routing, signal handling, and shutdown behavior
 * using a minimal concrete TestAgentSession subclass.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
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
import { getAcpSessionId, initCliTelemetry, setAcpSessionId } from '@/telemetry';
import { ApiClient } from '@/api/api';

const {
  mockStartFreeServer,
  mockRegisterKillSessionHandler,
  mockPersistSession,
  mockEraseSession,
  mockStartOfflineReconnection,
} = vi.hoisted(() => ({
  mockStartFreeServer: vi.fn(async () => ({
    stop: vi.fn(),
    url: 'http://127.0.0.1:4317',
    toolNames: ['change_title'],
  })),
  mockRegisterKillSessionHandler: vi.fn(),
  mockPersistSession: vi.fn().mockResolvedValue(undefined),
  mockEraseSession: vi.fn().mockResolvedValue(undefined),
  mockStartOfflineReconnection: vi.fn(),
}));

vi.mock('@/claude/utils/startFreeServer', () => ({
  startFreeServer: mockStartFreeServer,
}));

vi.mock('@/claude/registerKillSessionHandler', () => ({
  registerKillSessionHandler: mockRegisterKillSessionHandler,
}));

vi.mock('./sessionPersistence', () => ({
  persistSession: mockPersistSession,
  eraseSession: mockEraseSession,
}));

vi.mock('@/utils/serverConnectionErrors', () => ({
  startOfflineReconnection: (...args: unknown[]) => mockStartOfflineReconnection(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockStartOfflineReconnection.mockReturnValue({
    cancel: vi.fn(),
    isReconnected: vi.fn(() => false),
    getSession: vi.fn(() => null),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

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

function makeMockSession(sessionId = 'test-session-id'): ApiSessionClient & {
  __emitLastSeqChanged: (lastSeq: number) => void;
} {
  let lastSeq = 0;
  let onLastSeqChangedHandler: ((nextLastSeq: number) => void) | null = null;

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
    onUserMessage: vi.fn(),
    onFileTransfer: vi.fn(),
    onFetchAttachment: vi.fn(),
    onLastSeqChanged: vi.fn((handler: (nextLastSeq: number) => void) => {
      onLastSeqChangedHandler = handler;
      return () => {
        if (onLastSeqChangedHandler === handler) {
          onLastSeqChangedHandler = null;
        }
      };
    }),
    getLastSeq: vi.fn(() => lastSeq),
    keepAlive: vi.fn(),
    once: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    __emitLastSeqChanged: (nextLastSeq: number) => {
      lastSeq = nextLastSeq;
      onLastSeqChangedHandler?.(nextLastSeq);
    },
  } as unknown as ApiSessionClient & {
    __emitLastSeqChanged: (lastSeq: number) => void;
  };
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
    const broadcasts: IPCServerMessage[] = [];
    const session = new TestAgentSession(makeOpts((_, msg) => broadcasts.push(msg)));
    const mockSession = makeMockSession('sess-recovery');
    session.injectSession(mockSession);

    // Simulate daemon SIGTERM/HTTP stop — sets _keepStateForRecovery = true
    session.handleSigterm();
    await session.shutdown('daemon_stop');

    const archived = broadcasts.filter(
      m => m.type === 'session_state' && (m as { state?: string }).state === 'archived'
    );
    expect(archived).toHaveLength(0);
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

describe('AgentSession.preflightResume()', () => {
  it('resolves resume sessions before creating the managed session', async () => {
    const session = new TestAgentSession({ ...makeOpts(), resumeSessionId: 'resume-123' });
    const backend = {
      agentType: 'claude' as const,
      output: new PushableAsyncIterable<NormalizedMessage>(),
      start: vi.fn().mockResolvedValue(undefined),
      resolveSession: vi.fn().mockImplementation(async () => {
        setAcpSessionId('probe-session');
        return 'resolved-456';
      }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    } satisfies AgentBackend;

    vi.spyOn(session, 'createBackend').mockReturnValue(backend);
    setAcpSessionId('existing-session');

    await session.preflightResume();

    expect(backend.start).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/test',
        resumeSessionId: 'resume-123',
        session: expect.objectContaining({ sessionId: 'resume-preflight' }),
        mcpServerUrl: expect.stringContaining('http://127.0.0.1:'),
        freeMcpToolNames: ['change_title'],
      })
    );
    expect(backend.resolveSession).toHaveBeenCalled();
    expect(backend.stop).toHaveBeenCalled();
    expect((session as any).opts.resumeSessionId).toBe('resolved-456');
    expect(getAcpSessionId()).toBe('existing-session');
  });

  it('is a no-op when there is no resume session id', async () => {
    const session = new TestAgentSession(makeOpts());
    const createBackendSpy = vi.spyOn(session, 'createBackend');

    await session.preflightResume();

    expect(createBackendSpy).not.toHaveBeenCalled();
  });
});

describe('AgentSession.initialize()', () => {
  it('uses api.restoreSession when restoreSession is enabled', async () => {
    const session = new TestAgentSession({
      ...makeOpts(),
      sessionId: 'managed-restore',
      restoreSession: true,
      resumeSessionId: 'upstream-123',
    });
    const apiSession = makeMockSession('managed-restore');
    const restoreSession = vi.fn().mockResolvedValue({
      id: 'managed-restore',
      seq: 1,
      metadata: {},
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      capabilities: null,
      capabilitiesVersion: 0,
    });
    const getOrCreateSession = vi.fn();
    const sessionSyncClient = vi.fn().mockReturnValue(apiSession);
    vi.spyOn(ApiClient, 'create').mockResolvedValue({
      restoreSession,
      getOrCreateSession,
      sessionSyncClient,
    } as unknown as ApiClient);

    await session.initialize();

    expect(restoreSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'managed-restore',
        machineId: 'test-machine',
      })
    );
    expect(getOrCreateSession).not.toHaveBeenCalled();
    expect(sessionSyncClient).toHaveBeenCalled();
    expect(mockStartFreeServer).toHaveBeenCalledWith(apiSession);
  });

  it('does not throw when initialize falls back to the offline session stub', async () => {
    const session = new TestAgentSession(makeOpts());
    const getOrCreateSession = vi.fn().mockResolvedValue(null);
    const sessionSyncClient = vi.fn();
    vi.spyOn(ApiClient, 'create').mockResolvedValue({
      getOrCreateSession,
      sessionSyncClient,
    } as unknown as ApiClient);

    await expect(session.initialize()).resolves.toBeUndefined();
    expect(sessionSyncClient).not.toHaveBeenCalled();
    expect(mockStartFreeServer).not.toHaveBeenCalled();

    await session.shutdown('test_cleanup');
  });

  it('throws when managed restore cannot reach the server', async () => {
    const session = new TestAgentSession({
      ...makeOpts(),
      sessionId: 'managed-restore',
      restoreSession: true,
    });
    const restoreSession = vi.fn().mockResolvedValue(null);
    const getOrCreateSession = vi.fn();
    const sessionSyncClient = vi.fn();
    vi.spyOn(ApiClient, 'create').mockResolvedValue({
      restoreSession,
      getOrCreateSession,
      sessionSyncClient,
    } as unknown as ApiClient);

    await expect(session.initialize()).rejects.toThrow(
      'Failed to restore managed session "managed-restore": server unavailable'
    );
    expect(getOrCreateSession).not.toHaveBeenCalled();
    expect(sessionSyncClient).not.toHaveBeenCalled();
    expect(mockStartFreeServer).not.toHaveBeenCalled();
  });

  it('uses strict session recovery for daemon-owned sessions even without resumeSessionId', async () => {
    const session = new TestAgentSession({
      ...makeOpts(),
      startedBy: 'daemon',
      sessionId: 'daemon-recovery-1',
      resumeSessionId: undefined,
    });
    const apiSession = makeMockSession('daemon-recovery-1');
    const getOrCreateSession = vi.fn().mockResolvedValue({
      id: 'daemon-recovery-1',
      seq: 1,
      metadata: {},
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      capabilities: null,
      capabilitiesVersion: 0,
    });
    const sessionSyncClient = vi.fn().mockReturnValue(apiSession);
    vi.spyOn(ApiClient, 'create').mockResolvedValue({
      getOrCreateSession,
      sessionSyncClient,
    } as unknown as ApiClient);

    await session.initialize();

    expect(getOrCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'daemon-recovery-1',
        strictSessionId: true,
      })
    );
  });

  it('persists advanced lastSeq after initialize for crash recovery', async () => {
    vi.useFakeTimers();

    const session = new TestAgentSession(makeOpts());
    const apiSession = makeMockSession('managed-last-seq');
    const getOrCreateSession = vi.fn().mockResolvedValue({
      id: 'managed-last-seq',
      seq: 0,
      metadata: {},
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      capabilities: null,
      capabilitiesVersion: 0,
    });
    const sessionSyncClient = vi.fn().mockReturnValue(apiSession);
    vi.spyOn(ApiClient, 'create').mockResolvedValue({
      getOrCreateSession,
      sessionSyncClient,
    } as unknown as ApiClient);

    await session.initialize();
    expect(mockPersistSession).toHaveBeenCalledTimes(1);

    apiSession.__emitLastSeqChanged(42);
    await vi.advanceTimersByTimeAsync(300);

    expect(mockPersistSession).toHaveBeenCalledTimes(2);
    expect(mockPersistSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: 'managed-last-seq',
        lastSeq: 42,
      })
    );
  });

  it('preserves persisted lastSeq across offline recovery and session swap', async () => {
    mockStartOfflineReconnection.mockImplementation(
      ({ onReconnected }: { onReconnected: () => Promise<unknown> }) => {
        void onReconnected();
        return {
          cancel: vi.fn(),
          isReconnected: vi.fn(() => true),
          getSession: vi.fn(() => null),
        };
      }
    );

    const session = new TestAgentSession({
      ...makeOpts(),
      startedBy: 'daemon',
      sessionId: 'daemon-recovery-offline',
      lastSeq: 2062,
    });
    const swappedSession = makeMockSession('daemon-recovery-offline');
    const getOrCreateSession = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'daemon-recovery-offline',
        seq: 2062,
        metadata: {},
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        capabilities: null,
        capabilitiesVersion: 0,
        lastSeq: 0,
      });
    const sessionSyncClient = vi.fn().mockReturnValue(swappedSession);
    vi.spyOn(ApiClient, 'create').mockResolvedValue({
      getOrCreateSession,
      sessionSyncClient,
    } as unknown as ApiClient);

    await session.initialize();
    await Promise.resolve();
    await Promise.resolve();

    expect(getOrCreateSession).toHaveBeenCalledTimes(2);
    expect(sessionSyncClient).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'daemon-recovery-offline',
        lastSeq: 2062,
      })
    );
    expect(mockStartFreeServer).toHaveBeenCalledWith(swappedSession);
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

describe('AgentSession session RPC handlers', () => {
  it('restartAgent returns before waiting for a stuck backend stop', async () => {
    const session = new TestAgentSession(makeOpts());
    const mockSession = makeMockSession('sess-restart');
    session.injectSession(mockSession);
    session.injectBackend({
      ...session.createBackend(),
      stop: vi.fn(
        () =>
          new Promise<void>(() => {
            // Intentionally never resolves to simulate a stuck backend stop.
          })
      ),
    });

    (session as any).registerSessionRpcHandlers();

    const restartCall = (mockSession.rpcHandlerManager.registerHandler as any).mock.calls.find(
      ([name]: [string]) => name === 'restartAgent'
    );
    expect(restartCall).toBeTruthy();

    const handler = restartCall[1];
    await expect(handler()).resolves.toEqual({
      success: true,
      message: 'Restarting agent process',
    });
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
