import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@/sync/storageTypes';
import { buildSessionHistoryItems } from './sessionHistoryItems';

vi.mock('@/text', () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    if (key === 'sessionHistory.today') return 'Today';
    if (key === 'sessionHistory.yesterday') return 'Yesterday';
    if (key === 'sessionHistory.daysAgo') return `${params?.count} days ago`;
    if (key === 'status.unknown') return 'unknown';
    return key;
  },
}));

vi.mock('@/utils/sessionUtils', () => ({
  getSessionName: (session: Session) => session.metadata?.path.split('/').filter(Boolean).pop() ?? 'unknown',
  getSessionSubtitle: (session: Session) => session.metadata?.path.replace('/Users/tester', '~') ?? 'unknown',
  getSessionAvatarId: (session: Session) => `avatar:${session.id}`,
}));

function createSession(id: string, updatedAt: number, path: string): Session {
  return {
    id,
    seq: 0,
    createdAt: updatedAt,
    updatedAt,
    status: 'active',
    activeAt: updatedAt,
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

describe('sessionHistoryItems', () => {
  it('builds stable history rows with precomputed card positions', () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + 10_000;
    const yesterday = today - 24 * 60 * 60 * 1000;

    const items = buildSessionHistoryItems([
      createSession('today-1', today, '/Users/tester/project-a'),
      createSession('today-2', today - 1_000, '/Users/tester/project-b'),
      createSession('yesterday-1', yesterday, '/Users/tester/project-c'),
    ]);

    expect(items.map(item => item.type)).toEqual([
      'date-header',
      'session',
      'session',
      'date-header',
      'session',
    ]);
    expect(items[0]).toMatchObject({ type: 'date-header', date: 'Today', key: expect.any(String) });
    expect(items[1]).toMatchObject({
      type: 'session',
      key: 'session-today-1',
      sessionName: 'project-a',
      sessionSubtitle: '~/project-a',
      cardPosition: 'first',
    });
    expect(items[2]).toMatchObject({
      type: 'session',
      key: 'session-today-2',
      cardPosition: 'last',
    });
    expect(items[3]).toMatchObject({ type: 'date-header', date: 'Yesterday' });
    expect(items[4]).toMatchObject({
      type: 'session',
      key: 'session-yesterday-1',
      cardPosition: 'single',
    });
  });
});
