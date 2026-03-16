/**
 * IPCServer + IPCClient integration tests
 *
 * Uses real Unix sockets in /tmp to verify the full protocol roundtrip.
 * Each test gets a unique socket path to avoid collisions.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { IPCServer } from './IPCServer';
import { IPCClient } from './IPCClient';
import type { SessionManager } from '../sessions/SessionManager';
import type { SpawnSessionOptions, SpawnSessionResult, IPCServerMessage } from './protocol';
import type { NormalizedMessage } from '../sessions/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpSocket(): string {
  return join(tmpdir(), `free-test-${randomUUID().slice(0, 8)}.sock`);
}

function makeMsg(text: string): NormalizedMessage {
  return {
    id: `msg-${randomUUID().slice(0, 8)}`,
    createdAt: Date.now(),
    isSidechain: false,
    role: 'agent',
    content: [{ type: 'text', text, uuid: 'u1', parentUUID: null }],
  } as NormalizedMessage;
}

/** Stub session object — just enough to pass existence checks in IPCServer. */
const STUB_SESSION = { sessionId: 'stub', sendInput: vi.fn(), abort: vi.fn() };

function makeMockSessionManager(overrides: Partial<SessionManager> = {}): SessionManager {
  return {
    // Default: return a stub session so attach succeeds. Tests that need
    // "session not found" behavior should override get to return undefined.
    get: vi.fn().mockReturnValue(STUB_SESSION),
    list: vi.fn().mockReturnValue([]),
    register: vi.fn(),
    unregister: vi.fn(),
    stop: vi.fn(),
    handleSigterm: vi.fn(),
    handleSigint: vi.fn(),
    ...overrides,
  } as unknown as SessionManager;
}

/** Wait for a specific message type on the IPCClient */
function waitForMessage(client: IPCClient, type: IPCServerMessage['type'], timeout = 3000): Promise<IPCServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const handler = (msg: IPCServerMessage) => {
      clearTimeout(timer);
      client.off(type, handler);
      resolve(msg);
    };
    client.on(type, handler);
  });
}

// Cleanup tracker
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanups.splice(0)) {
    try { fn(); } catch { /* ignore */ }
  }
});

async function setupPair(
  sessionManager?: SessionManager,
  onSpawnSession?: (opts: SpawnSessionOptions) => Promise<SpawnSessionResult>,
  onSessionOrphaned?: (sessionId: string) => void,
): Promise<{ server: IPCServer; client: IPCClient; socketPath: string }> {
  const socketPath = tmpSocket();
  const mgr = sessionManager ?? makeMockSessionManager();
  const spawn = onSpawnSession ?? (async () => ({ type: 'success' as const, sessionId: 'spawned-1' }));

  const server = new IPCServer(mgr, spawn, onSessionOrphaned);
  await server.start(socketPath);

  const client = new IPCClient();
  await client.connect(socketPath);

  cleanups.push(() => {
    client.disconnect();
    server.stop();
  });

  return { server, client, socketPath };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IPC Protocol', () => {
  it('spawn_session returns success', async () => {
    const { client } = await setupPair();

    const resultPromise = waitForMessage(client, 'spawn_result');
    client.send({ type: 'spawn_session', opts: { directory: '/tmp', agent: 'claude' } });

    const result = await resultPromise;
    expect(result.type).toBe('spawn_result');
    if (result.type === 'spawn_result') {
      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('spawned-1');
    }
  });

  it('spawn_session returns error on failure', async () => {
    const { client } = await setupPair(
      undefined,
      async () => ({ type: 'error', error: 'auth failed' }),
    );

    const resultPromise = waitForMessage(client, 'spawn_result');
    client.send({ type: 'spawn_session', opts: { directory: '/tmp' } });

    const result = await resultPromise;
    if (result.type === 'spawn_result') {
      expect(result.success).toBe(false);
      expect(result.error).toBe('auth failed');
    }
  });

  it('attach receives empty history for new session', async () => {
    const { client } = await setupPair();

    const histPromise = waitForMessage(client, 'history');
    client.send({ type: 'attach', sessionId: 'sess-1' });

    const hist = await histPromise;
    if (hist.type === 'history') {
      expect(hist.sessionId).toBe('sess-1');
      expect(hist.msgs).toHaveLength(0);
    }
  });

  it('attach to non-existent session returns session_state:archived', async () => {
    const mgr = makeMockSessionManager({
      get: vi.fn().mockReturnValue(undefined),
    });
    const { client } = await setupPair(mgr);

    const statePromise = waitForMessage(client, 'session_state');
    client.send({ type: 'attach', sessionId: 'ghost-session' });

    const state = await statePromise;
    if (state.type === 'session_state') {
      expect(state.sessionId).toBe('ghost-session');
      expect(state.state).toBe('archived');
    }
  });

  it('broadcast delivers agent_output to attached client', async () => {
    const { server, client } = await setupPair();

    // Attach first
    const histPromise = waitForMessage(client, 'history');
    client.send({ type: 'attach', sessionId: 'sess-1' });
    await histPromise;

    // Broadcast a message
    const outputPromise = waitForMessage(client, 'agent_output');
    const msg = makeMsg('hello from agent');
    server.broadcast('sess-1', { type: 'agent_output', sessionId: 'sess-1', msg });

    const output = await outputPromise;
    if (output.type === 'agent_output') {
      expect(output.sessionId).toBe('sess-1');
      expect(output.msg.role).toBe('agent');
    }
  });

  it('broadcast does not deliver to detached client', async () => {
    const { server, client } = await setupPair();

    // Attach then detach
    const histPromise = waitForMessage(client, 'history');
    client.send({ type: 'attach', sessionId: 'sess-1' });
    await histPromise;
    client.send({ type: 'detach', sessionId: 'sess-1' });

    // Small delay to ensure detach is processed
    await new Promise((r) => setTimeout(r, 50));

    // Broadcast should not reach client
    const received: IPCServerMessage[] = [];
    client.on('agent_output', (msg) => received.push(msg));
    server.broadcast('sess-1', { type: 'agent_output', sessionId: 'sess-1', msg: makeMsg('should not arrive') });

    await new Promise((r) => setTimeout(r, 100));
    expect(received).toHaveLength(0);
  });

  it('history replay includes previous broadcasts', async () => {
    const { server, client } = await setupPair();

    // Broadcast before anyone attaches (builds up history ring)
    server.broadcast('sess-1', { type: 'agent_output', sessionId: 'sess-1', msg: makeMsg('msg-1') });
    server.broadcast('sess-1', { type: 'agent_output', sessionId: 'sess-1', msg: makeMsg('msg-2') });

    // Now attach and check history
    const histPromise = waitForMessage(client, 'history');
    client.send({ type: 'attach', sessionId: 'sess-1' });

    const hist = await histPromise;
    if (hist.type === 'history') {
      expect(hist.msgs).toHaveLength(2);
    }
  });

  it('evictHistory clears session data', async () => {
    const { server, client } = await setupPair();

    // Build up history
    server.broadcast('sess-1', { type: 'agent_output', sessionId: 'sess-1', msg: makeMsg('msg-1') });

    // Evict
    server.evictHistory('sess-1');

    // Attach: should get empty history
    const histPromise = waitForMessage(client, 'history');
    client.send({ type: 'attach', sessionId: 'sess-1' });

    const hist = await histPromise;
    if (hist.type === 'history') {
      expect(hist.msgs).toHaveLength(0);
    }
  });

  it('list_sessions returns session summaries', async () => {
    const mgr = makeMockSessionManager({
      list: vi.fn().mockReturnValue([
        {
          sessionId: 's1',
          toSummary: () => ({
            sessionId: 's1',
            agentType: 'claude',
            cwd: '/tmp',
            state: 'idle',
            startedAt: '2026-01-01',
            startedBy: 'cli',
          }),
        },
      ]),
    });
    const { client } = await setupPair(mgr);

    const listPromise = waitForMessage(client, 'session_list');
    client.send({ type: 'list_sessions' });

    const list = await listPromise;
    if (list.type === 'session_list') {
      expect(list.sessions).toHaveLength(1);
      expect(list.sessions[0].sessionId).toBe('s1');
      expect(list.sessions[0].attachedClients).toBe(0);
    }
  });

  it('send_input routes to session.sendInput', async () => {
    const sendInput = vi.fn();
    const mgr = makeMockSessionManager({
      get: vi.fn().mockReturnValue({ sendInput }),
    });
    const { client } = await setupPair(mgr);

    client.send({ type: 'send_input', sessionId: 'sess-1', text: 'user input' });

    // Wait for server to process
    await new Promise((r) => setTimeout(r, 50));
    expect(sendInput).toHaveBeenCalledWith('user input');
  });

  it('abort routes to session.abort', async () => {
    const abort = vi.fn().mockResolvedValue(undefined);
    const mgr = makeMockSessionManager({
      get: vi.fn().mockReturnValue({ abort }),
    });
    const { client } = await setupPair(mgr);

    client.send({ type: 'abort', sessionId: 'sess-1' });

    await new Promise((r) => setTimeout(r, 50));
    expect(abort).toHaveBeenCalled();
  });

  it('session_state broadcast reaches attached client', async () => {
    const { server, client } = await setupPair();

    const histPromise = waitForMessage(client, 'history');
    client.send({ type: 'attach', sessionId: 'sess-1' });
    await histPromise;

    const statePromise = waitForMessage(client, 'session_state');
    server.broadcast('sess-1', { type: 'session_state', sessionId: 'sess-1', state: 'archived' });

    const state = await statePromise;
    if (state.type === 'session_state') {
      expect(state.state).toBe('archived');
    }
  });

  it('capabilities broadcast reaches attached client', async () => {
    const { server, client } = await setupPair();

    const histPromise = waitForMessage(client, 'history');
    client.send({ type: 'attach', sessionId: 'sess-1' });
    await histPromise;

    const capabilitiesPromise = waitForMessage(client, 'capabilities');
    server.broadcast('sess-1', {
      type: 'capabilities',
      sessionId: 'sess-1',
      capabilities: {
        modes: {
          available: [{ id: 'code', name: 'Code' }],
          current: 'code',
        },
      },
    });

    const result = await capabilitiesPromise;
    if (result.type === 'capabilities') {
      expect(result.capabilities.modes?.current).toBe('code');
    }
  });

  it('pty_data routes to session.sendPtyInput', async () => {
    const sendPtyInput = vi.fn();
    const mgr = makeMockSessionManager({
      get: vi.fn().mockReturnValue({ sendPtyInput }),
    });
    const { client } = await setupPair(mgr);

    const data = Buffer.from('keypress').toString('base64');
    client.send({ type: 'pty_data', sessionId: 'sess-1', data });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPtyInput).toHaveBeenCalledWith(data);
  });

  it('pty_resize routes to session.resizePty', async () => {
    const resizePty = vi.fn();
    const mgr = makeMockSessionManager({
      get: vi.fn().mockReturnValue({ resizePty }),
    });
    const { client } = await setupPair(mgr);

    client.send({ type: 'pty_resize', sessionId: 'sess-1', cols: 120, rows: 40 });

    await new Promise((r) => setTimeout(r, 50));
    expect(resizePty).toHaveBeenCalledWith(120, 40);
  });

  it('set_model routes to session.setModel', async () => {
    const setModel = vi.fn().mockResolvedValue(undefined);
    const mgr = makeMockSessionManager({
      get: vi.fn().mockReturnValue({ setModel }),
    });
    const { client } = await setupPair(mgr);

    client.send({ type: 'set_model', sessionId: 'sess-1', modelId: 'gemini-2.5-pro' });

    await new Promise((r) => setTimeout(r, 50));
    expect(setModel).toHaveBeenCalledWith('gemini-2.5-pro');
  });

  it('set_mode routes to session.setMode', async () => {
    const setMode = vi.fn().mockResolvedValue(undefined);
    const mgr = makeMockSessionManager({
      get: vi.fn().mockReturnValue({ setMode }),
    });
    const { client } = await setupPair(mgr);

    client.send({ type: 'set_mode', sessionId: 'sess-1', modeId: 'code' });

    await new Promise((r) => setTimeout(r, 50));
    expect(setMode).toHaveBeenCalledWith('code');
  });

  it('set_config routes to session.setConfig', async () => {
    const setConfig = vi.fn().mockResolvedValue(undefined);
    const mgr = makeMockSessionManager({
      get: vi.fn().mockReturnValue({ setConfig }),
    });
    const { client } = await setupPair(mgr);

    client.send({
      type: 'set_config',
      sessionId: 'sess-1',
      optionId: 'model',
      value: 'gemini-2.5-pro',
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(setConfig).toHaveBeenCalledWith('model', 'gemini-2.5-pro');
  });
});

describe('IPCClient', () => {
  it('on/off handler management', async () => {
    const { server, client } = await setupPair();

    // Attach to get history callback
    const received: IPCServerMessage[] = [];
    const handler = (msg: IPCServerMessage) => received.push(msg);

    client.on('agent_output', handler);

    const histPromise = waitForMessage(client, 'history');
    client.send({ type: 'attach', sessionId: 'sess-1' });
    await histPromise;

    server.broadcast('sess-1', { type: 'agent_output', sessionId: 'sess-1', msg: makeMsg('first') });
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);

    // Remove handler
    client.off('agent_output', handler);
    server.broadcast('sess-1', { type: 'agent_output', sessionId: 'sess-1', msg: makeMsg('second') });
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1); // still 1, handler removed
  });

  it('multiple handlers for same type', async () => {
    const { server, client } = await setupPair();

    const histPromise = waitForMessage(client, 'history');
    client.send({ type: 'attach', sessionId: 'sess-1' });
    await histPromise;

    const count = { a: 0, b: 0 };
    client.on('agent_output', () => count.a++);
    client.on('agent_output', () => count.b++);

    server.broadcast('sess-1', { type: 'agent_output', sessionId: 'sess-1', msg: makeMsg('test') });
    await new Promise((r) => setTimeout(r, 50));

    expect(count.a).toBe(1);
    expect(count.b).toBe(1);
  });

  it('buffers send_input when socket is not writable', () => {
    // Create a disconnected client
    const client = new IPCClient();
    // socket is undefined → not writable
    client.send({ type: 'send_input', sessionId: 'sess-1', text: 'buffered msg' });
    // Should not throw; message is buffered internally
  });
});

describe('attach_session', () => {
  it('returns success when session exists', async () => {
    const mgr = makeMockSessionManager({
      get: vi.fn().mockReturnValue({ sessionId: 'sess-1' }),
    });
    const { client } = await setupPair(mgr);

    const resultPromise = waitForMessage(client, 'spawn_result');
    client.send({ type: 'attach_session', sessionId: 'sess-1' });

    const result = await resultPromise;
    if (result.type === 'spawn_result') {
      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('sess-1');
    }
  });

  it('returns failure when session does not exist', async () => {
    const mgr = makeMockSessionManager({
      get: vi.fn().mockReturnValue(undefined),
    });
    const { client } = await setupPair(mgr);

    const resultPromise = waitForMessage(client, 'spawn_result');
    client.send({ type: 'attach_session', sessionId: 'no-such-session' });

    const result = await resultPromise;
    if (result.type === 'spawn_result') {
      expect(result.success).toBe(false);
      expect(result.error).toContain('no-such-session');
    }
  });
});

describe('getAttachmentCount', () => {
  it('returns 0 for unknown session', async () => {
    const { server } = await setupPair();
    expect(server.getAttachmentCount('nonexistent')).toBe(0);
  });

  it('returns correct count after attach and detach', async () => {
    const { server, client } = await setupPair();

    const histPromise = waitForMessage(client, 'history');
    client.send({ type: 'attach', sessionId: 'sess-1' });
    await histPromise;

    expect(server.getAttachmentCount('sess-1')).toBe(1);

    client.send({ type: 'detach', sessionId: 'sess-1' });
    await new Promise((r) => setTimeout(r, 50));

    expect(server.getAttachmentCount('sess-1')).toBe(0);
  });
});

describe('orphan detection', () => {
  it('calls onSessionOrphaned when last client disconnects', async () => {
    const orphanedSessions: string[] = [];
    const { server, client, socketPath } = await setupPair(
      undefined,
      undefined,
      (sessionId) => orphanedSessions.push(sessionId),
    );

    // Attach, then disconnect — should trigger orphan callback
    const histPromise = waitForMessage(client, 'history');
    client.send({ type: 'attach', sessionId: 'sess-1' });
    await histPromise;

    client.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    expect(orphanedSessions).toEqual(['sess-1']);
  });

  it('does not call onSessionOrphaned when socket was not attached to that session', async () => {
    const orphanedSessions: string[] = [];
    const { server, client } = await setupPair(
      undefined,
      undefined,
      (sessionId) => orphanedSessions.push(sessionId),
    );

    // Attach to sess-1 and broadcast history for sess-2 (without attaching)
    const histPromise = waitForMessage(client, 'history');
    client.send({ type: 'attach', sessionId: 'sess-1' });
    await histPromise;

    // Build history for sess-2 so attachment set exists with 0 sockets
    server.broadcast('sess-2', { type: 'agent_output', sessionId: 'sess-2', msg: makeMsg('bg') });

    client.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // Only sess-1 should be orphaned, not sess-2
    expect(orphanedSessions).toEqual(['sess-1']);
  });

  it('does not fire orphan callback when another client is still attached', async () => {
    const orphanedSessions: string[] = [];
    const socketPath = tmpSocket();
    const mgr = makeMockSessionManager();
    const spawn = async () => ({ type: 'success' as const, sessionId: 'spawned-1' });
    const server = new IPCServer(mgr, spawn, (id) => orphanedSessions.push(id));
    await server.start(socketPath);

    const client1 = new IPCClient();
    await client1.connect(socketPath);
    const client2 = new IPCClient();
    await client2.connect(socketPath);

    cleanups.push(() => {
      client1.disconnect();
      client2.disconnect();
      server.stop();
    });

    // Both clients attach to same session
    const hist1 = waitForMessage(client1, 'history');
    client1.send({ type: 'attach', sessionId: 'sess-1' });
    await hist1;

    const hist2 = waitForMessage(client2, 'history');
    client2.send({ type: 'attach', sessionId: 'sess-1' });
    await hist2;

    expect(server.getAttachmentCount('sess-1')).toBe(2);

    // Disconnect one — should NOT fire orphan callback
    client1.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    expect(orphanedSessions).toEqual([]);
    expect(server.getAttachmentCount('sess-1')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Recovery gate tests
// ---------------------------------------------------------------------------

describe('IPCServer recovery gate', () => {
  it('attach waits for recovery then succeeds', async () => {
    // Session is initially unknown
    let resolveGet: ((session: any) => void) | null = null;
    const getImpl = vi.fn().mockImplementation(() => null);

    const mgr = makeMockSessionManager({ get: getImpl });
    const { server, client } = await setupPair(mgr);

    // Open recovery gate
    server.beginRecovery();

    // Client sends attach — should NOT get an immediate archived response
    const attachPromise = waitForMessage(client, 'history', 5000).catch(() => null);
    const archivedPromise = waitForMessage(client, 'session_state', 500).catch(() => 'timeout');
    client.send({ type: 'attach', sessionId: 'recovering-sess' });

    // Confirm no immediate archived response
    const earlyResult = await archivedPromise;
    expect(earlyResult).toBe('timeout');

    // Now "recover" the session — make get() return a stub
    getImpl.mockReturnValue(STUB_SESSION);

    // End recovery gate — deferred attach should now proceed
    server.endRecovery();

    const historyMsg = await waitForMessage(client, 'history', 3000);
    expect(historyMsg).toBeDefined();
    expect((historyMsg as any).sessionId).toBe('recovering-sess');
  });

  it('attach returns archived after recovery completes without the session', async () => {
    const mgr = makeMockSessionManager({
      get: vi.fn().mockReturnValue(undefined), // session never appears
    });
    const { server, client } = await setupPair(mgr);

    server.beginRecovery();

    const archivedPromise = waitForMessage(client, 'session_state', 5000);
    client.send({ type: 'attach', sessionId: 'gone-sess' });

    // End recovery — session still not found → should get archived
    server.endRecovery();

    const msg = await archivedPromise;
    expect((msg as any).state).toBe('archived');
  });

  it('attach resolves via sessionIdMap after recovery', async () => {
    const getImpl = vi.fn().mockImplementation((id: string) => {
      // Only respond to the NEW id
      if (id === 'new-sess') return STUB_SESSION;
      return undefined;
    });
    const mgr = makeMockSessionManager({ get: getImpl });
    const { server, client } = await setupPair(mgr);

    server.beginRecovery();
    client.send({ type: 'attach', sessionId: 'old-sess' });

    // Simulate recovery: old-sess was recovered as new-sess
    server.addSessionIdMapping('old-sess', 'new-sess');
    server.endRecovery();

    const msg = await waitForMessage(client, 'history', 3000);
    expect(msg).toBeDefined();
    expect((msg as any).sessionId).toBe('new-sess');
  });

  it('attach without recovery gate responds immediately', async () => {
    const mgr = makeMockSessionManager({
      get: vi.fn().mockReturnValue(undefined),
    });
    const { client } = await setupPair(mgr);

    // No beginRecovery() — attach should fail immediately
    client.send({ type: 'attach', sessionId: 'nonexistent' });

    const msg = await waitForMessage(client, 'session_state', 1000);
    expect((msg as any).state).toBe('archived');
  });
});
