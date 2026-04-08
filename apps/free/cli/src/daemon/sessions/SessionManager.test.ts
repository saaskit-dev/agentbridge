import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from './SessionManager';
import type { AgentSession } from './AgentSession';

type AnySession = AgentSession<any>;

function makeMockSession(overrides: Partial<AnySession> = {}): AnySession {
  return {
    agentType: 'claude',
    sessionId: 'sess-1',
    toSummary: vi
      .fn()
      .mockReturnValue({
        sessionId: 'sess-1',
        agentType: 'claude',
        cwd: '/tmp',
        state: 'idle',
        startedAt: '2026-01-01',
        startedBy: 'cli',
      }),
    sendInput: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    handleSigterm: vi.fn(),
    handleSigint: vi.fn(),
    sendPtyInput: vi.fn(),
    resizePty: vi.fn(),
    ...overrides,
  } as unknown as AnySession;
}

describe('SessionManager', () => {
  it('register and get', () => {
    const mgr = new SessionManager();
    const session = makeMockSession();
    mgr.register('sess-1', session);
    expect(mgr.get('sess-1')).toBe(session);
  });

  it('get returns undefined for unknown id', () => {
    const mgr = new SessionManager();
    expect(mgr.get('nonexistent')).toBeUndefined();
  });

  it('list returns all registered sessions', () => {
    const mgr = new SessionManager();
    const s1 = makeMockSession();
    const s2 = makeMockSession({ agentType: 'codex' });
    mgr.register('sess-1', s1);
    mgr.register('sess-2', s2);
    expect(mgr.list()).toHaveLength(2);
    expect(mgr.list()).toContain(s1);
    expect(mgr.list()).toContain(s2);
  });

  it('unregister removes session and calls onEvictHistory', () => {
    const evict = vi.fn();
    const mgr = new SessionManager(evict);
    mgr.register('sess-1', makeMockSession());
    expect(mgr.get('sess-1')).toBeDefined();

    mgr.unregister('sess-1');

    expect(mgr.get('sess-1')).toBeUndefined();
    expect(evict).toHaveBeenCalledWith('sess-1');
  });

  it('unregister is safe for unknown session', () => {
    const evict = vi.fn();
    const mgr = new SessionManager(evict);
    mgr.unregister('nonexistent');
    expect(evict).toHaveBeenCalledWith('nonexistent');
  });

  it('stop calls shutdown then unregister', async () => {
    const evict = vi.fn();
    const mgr = new SessionManager(evict);
    const session = makeMockSession();
    mgr.register('sess-1', session);

    await mgr.stop('sess-1');

    expect(session.shutdown).toHaveBeenCalledWith('remote_stop');
    expect(mgr.get('sess-1')).toBeUndefined();
    expect(evict).toHaveBeenCalledWith('sess-1');
  });

  it('stop is a no-op for unknown session', async () => {
    const mgr = new SessionManager();
    await mgr.stop('nonexistent'); // should not throw
  });

  it('handleSigterm calls handleSigterm on all sessions', () => {
    const mgr = new SessionManager();
    const s1 = makeMockSession();
    const s2 = makeMockSession();
    mgr.register('s1', s1);
    mgr.register('s2', s2);

    mgr.handleSigterm();

    expect(s1.handleSigterm).toHaveBeenCalled();
    expect(s2.handleSigterm).toHaveBeenCalled();
  });

  it('handleSigint calls handleSigint on all sessions', () => {
    const mgr = new SessionManager();
    const s1 = makeMockSession();
    const s2 = makeMockSession();
    mgr.register('s1', s1);
    mgr.register('s2', s2);

    mgr.handleSigint();

    expect(s1.handleSigint).toHaveBeenCalled();
    expect(s2.handleSigint).toHaveBeenCalled();
  });

  it('register rejects duplicate session ids', () => {
    const mgr = new SessionManager();
    const s1 = makeMockSession();
    const s2 = makeMockSession({ agentType: 'codex' });
    mgr.register('sess-1', s1);
    expect(() => mgr.register('sess-1', s2)).toThrow('Session sess-1 is already registered');
    expect(mgr.get('sess-1')).toBe(s1);
    expect(mgr.list()).toHaveLength(1);
  });
});
