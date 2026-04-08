import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/api/types', () => ({}));

vi.mock('@/storage/files', () => ({
  getPublicUrl: vi.fn((path: string) => path),
}));

vi.mock('@/types', () => ({}));

vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    warn() {}
    info() {}
    error() {}
    debug() {}
  },
}));

import {
  EventRouter,
  type MachineScopedConnection,
  type SessionScopedConnection,
  type UserScopedConnection,
} from '../eventRouter';

function makeSessionConnection(
  userId: string,
  sessionId: string,
  socketId: string
): SessionScopedConnection {
  return {
    connectionType: 'session-scoped',
    userId,
    sessionId,
    socket: {
      id: socketId,
      emit: vi.fn(),
    } as any,
  };
}

function makeMachineConnection(
  userId: string,
  machineId: string,
  socketId: string
): MachineScopedConnection {
  return {
    connectionType: 'machine-scoped',
    userId,
    machineId,
    socket: {
      id: socketId,
      emit: vi.fn(),
    } as any,
  };
}

function makeUserConnection(userId: string, socketId: string): UserScopedConnection {
  return {
    connectionType: 'user-scoped',
    userId,
    socket: {
      id: socketId,
      emit: vi.fn(),
    } as any,
  };
}

describe('EventRouter connection presence', () => {
  it('tracks whether a session-scoped connection still exists', () => {
    const router = new EventRouter();
    const sessionConnection = makeSessionConnection('user-1', 'session-1', 'socket-1');
    const unrelatedUserConnection = makeUserConnection('user-1', 'socket-2');

    router.addConnection('user-1', sessionConnection);
    router.addConnection('user-1', unrelatedUserConnection);

    expect(router.hasSessionConnection('user-1', 'session-1')).toBe(true);
    expect(router.hasSessionConnection('user-1', 'session-2')).toBe(false);

    router.removeConnection('user-1', sessionConnection);

    expect(router.hasSessionConnection('user-1', 'session-1')).toBe(false);
  });

  it('tracks whether a machine-scoped connection still exists', () => {
    const router = new EventRouter();
    const machineConnection = makeMachineConnection('user-1', 'machine-1', 'socket-1');
    const sessionConnection = makeSessionConnection('user-1', 'session-1', 'socket-2');

    router.addConnection('user-1', machineConnection);
    router.addConnection('user-1', sessionConnection);

    expect(router.hasMachineConnection('user-1', 'machine-1')).toBe(true);
    expect(router.hasMachineConnection('user-1', 'machine-2')).toBe(false);

    router.removeConnection('user-1', machineConnection);

    expect(router.hasMachineConnection('user-1', 'machine-1')).toBe(false);
  });
});
