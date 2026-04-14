import { describe, expect, it, vi } from 'vitest';
import { buildSessionsListItems } from './sessionsListItems';
import type { Machine, Session } from '@/sync/storageTypes';
import type { SessionListViewItem } from '@/sync/storage';

vi.mock('@/utils/sessionUtils', () => ({
  getSessionName: (session: Session) => session.metadata?.path.split('/').filter(Boolean).pop() ?? 'unknown',
  getSessionSubtitle: (session: Session) => session.metadata?.path.replace('/Users/tester', '~') ?? 'unknown',
  getSessionAvatarId: (session: Session) => `${session.metadata?.machineId}:${session.metadata?.path}`,
}));

function createMachine(id: string): Machine {
  return {
    id,
    seq: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    activeAt: 1_000,
    metadata: {
      displayName: `Machine ${id}`,
      host: `${id}.local`,
      homeDir: '/Users/tester',
      freeHomeDir: '/Users/tester/.free',
      platform: 'darwin',
      freeCliVersion: '1.0.0',
    },
    metadataVersion: 0,
    active: true,
    daemonState: null,
    daemonStateVersion: 0,
  };
}

function createSession(id: string, path: string): Session {
  return {
    id,
    seq: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    status: 'active',
    activeAt: 1_000,
    metadata: {
      path,
      host: 'tester.local',
      homeDir: '/Users/tester',
      machineId: 'machine-1',
    },
    metadataVersion: 0,
    agentState: null,
    agentStateVersion: 0,
    capabilities: null,
    capabilitiesVersion: 0,
    thinking: false,
    thinkingAt: 0,
    presence: 'online',
    permissionMode: 'accept-edits',
    queuedMessages: [],
    desiredAgentMode: null,
    desiredConfigOptions: null,
    modelMode: null,
  };
}

describe('sessionsListItems', () => {
  it('precomputes selected state and card positions without changing grouping semantics', () => {
    const machine = createMachine('machine-1');
    const items: SessionListViewItem[] = [
      { type: 'header', title: 'Recent' },
      { type: 'session', session: createSession('session-1', '/Users/tester/project-a') },
      { type: 'session', session: createSession('session-2', '/Users/tester/project-b') },
      { type: 'header', title: 'Older' },
      { type: 'session', session: createSession('session-3', '/Users/tester/project-c') },
      { type: 'project-group', displayPath: '~/project-z', machine },
      { type: 'session', session: createSession('session-4', '/Users/tester/project-z') },
      { type: 'active-sessions', sessions: [createSession('session-5', '/Users/tester/project-live')] },
    ];

    const result = buildSessionsListItems(items, 'session-3');

    expect(result.map(item => item.key)).toEqual([
      'header-Recent-0',
      'session-session-1',
      'session-session-2',
      'header-Older-3',
      'session-session-3',
      'project-group-machine-1-~/project-z-5',
      'session-session-4',
      'active-sessions',
    ]);
    expect(result[1]).toMatchObject({ type: 'session', cardPosition: 'first', selected: false });
    expect(result[1]).toMatchObject({
      sessionName: 'project-a',
      sessionSubtitle: '~/project-a',
      avatarId: 'machine-1:/Users/tester/project-a',
    });
    expect(result[2]).toMatchObject({ type: 'session', cardPosition: 'last', selected: false });
    expect(result[4]).toMatchObject({ type: 'session', cardPosition: 'first', selected: true });
    expect(result[6]).toMatchObject({ type: 'session', cardPosition: 'last', selected: false });
    expect(result[7]).toMatchObject({
      type: 'active-sessions',
      selectedSessionId: 'session-3',
    });
  });
});
