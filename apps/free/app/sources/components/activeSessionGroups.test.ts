import { describe, expect, it, vi } from 'vitest';
import { buildProjectSessionGroups } from './activeSessionGroups';
import type { Machine, Session } from '@/sync/storageTypes';

vi.mock('@/utils/sessionUtils', () => ({
  getSessionName: (session: Session) => session.metadata?.path.split('/').filter(Boolean).pop() ?? 'unknown',
  getSessionAvatarId: (session: Session) =>
    session.metadata?.machineId && session.metadata?.path
      ? `${session.metadata.machineId}:${session.metadata.path}`
      : session.id,
}));

function createMachine(id: string, displayName: string): Machine {
  return {
    id,
    seq: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    activeAt: 1_000,
    metadata: {
      displayName,
      host: `${displayName.toLowerCase()}.local`,
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

function createSession(
  id: string,
  createdAt: number,
  path: string,
  machineId?: string | null
): Session {
  return {
    id,
    seq: 0,
    createdAt,
    updatedAt: createdAt,
    status: 'active',
    activeAt: createdAt,
    metadata: {
      path,
      host: 'tester.local',
      homeDir: '/Users/tester',
      machineId: machineId ?? undefined,
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

describe('activeSessionGroups', () => {
  it('builds stable project and machine groups without changing ordering semantics', () => {
    const machines = [createMachine('machine-b', 'Beta'), createMachine('machine-a', 'Alpha')];
    const sessions = [
      createSession('s1', 1_000, '/Users/tester/project-z', 'machine-b'),
      createSession('s2', 3_000, '/Users/tester/project-z', 'machine-a'),
      createSession('s3', 2_000, '/Users/tester/project-a', null),
    ];

    const groups = buildProjectSessionGroups(sessions, machines, {
      unknownMachineId: 'unknown',
      unknownMachineDisplayName: '<unknown>',
    });

    expect(groups.map(group => group.displayPath)).toEqual(['~/project-a', '~/project-z']);
    expect(groups[0]).toMatchObject({
      machineLabel: '<unknown>',
      firstSession: { id: 's3' },
      firstSessionAvatarId: 's3',
    });
    expect(groups[1]).toMatchObject({
      machineLabel: '2 machines',
      firstSession: { id: 's1' },
      firstSessionAvatarId: 'machine-b:/Users/tester/project-z',
    });
    expect(groups[1]?.machineGroups.map(group => group.machineName)).toEqual(['Alpha', 'Beta']);
    expect(groups[1]?.machineGroups[0]?.sessions.map(item => item.session.id)).toEqual(['s2']);
    expect(groups[1]?.machineGroups[1]?.sessions.map(item => item.session.id)).toEqual(['s1']);
    expect(groups[1]?.machineGroups[0]?.sessions[0]).toMatchObject({
      sessionName: 'project-z',
      avatarId: 'machine-a:/Users/tester/project-z',
    });
  });
});
