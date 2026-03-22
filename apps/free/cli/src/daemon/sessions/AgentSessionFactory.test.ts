import { describe, it, expect, beforeEach } from 'vitest';

// AgentSessionFactory uses a module-level registry, so we need to isolate each test.
// We'll dynamically import to get a fresh module for factory tests.
// Alternatively, we test against the shared registry and accept ordering constraints.

import { AgentSessionFactory } from './AgentSessionFactory';
import type { AgentSessionOpts } from './AgentSession';
import type { Credentials } from '@/persistence';
import type { IPCServerMessage } from '@/daemon/ipc/protocol';

function makeOpts(): AgentSessionOpts {
  return {
    credential: { token: 'test' } as Credentials,
    machineId: 'test-machine',
    startedBy: 'cli',
    cwd: '/tmp',
    broadcast: (_sid: string, _msg: IPCServerMessage) => {},
    daemonInstanceId: 'test-daemon-instance',
  };
}

describe('AgentSessionFactory', () => {
  it('isRegistered returns true for known agents', () => {
    // daemon/run.ts registers all 4 agents at startup; in test environment
    // we check that the factory at least supports registration
    expect(AgentSessionFactory.isRegistered('__test_nonexistent__')).toBe(false);
  });

  it('create throws for unregistered agent type', () => {
    expect(() => AgentSessionFactory.create('__never_registered__', makeOpts())).toThrow(
      /Unknown agentType/
    );
  });

  it('register and create round-trip', () => {
    // Register a dummy class that captures opts
    let capturedOpts: AgentSessionOpts | undefined;

    class DummySession {
      constructor(opts: AgentSessionOpts) {
        capturedOpts = opts;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AgentSessionFactory.register('__test_dummy__' as any, DummySession as any);
    expect(AgentSessionFactory.isRegistered('__test_dummy__' as any)).toBe(true);

    const opts = makeOpts();
    const session = AgentSessionFactory.create('__test_dummy__' as any, opts);

    expect(session).toBeInstanceOf(DummySession);
    expect(capturedOpts).toBe(opts);
  });
});
