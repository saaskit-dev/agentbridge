import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionReactivate } from '../sessionReactivate';

const {
  mockFindFirst,
  mockUpdate,
  mockEvictSession,
  mockEmitEphemeral,
  mockEmitUpdate,
  mockAllocateUserSeq,
  mockBuildSessionActivityEphemeral,
  mockBuildUpdateSessionUpdate,
  mockRandomKeyNaked,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
  mockEvictSession: vi.fn(),
  mockEmitEphemeral: vi.fn(),
  mockEmitUpdate: vi.fn(),
  mockAllocateUserSeq: vi.fn(),
  mockBuildSessionActivityEphemeral: vi.fn(),
  mockBuildUpdateSessionUpdate: vi.fn(),
  mockRandomKeyNaked: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
  db: {
    session: {
      findFirst: mockFindFirst,
      update: mockUpdate,
    },
  },
}));

vi.mock('@/app/presence/sessionCache', () => ({
  activityCache: {
    evictSession: mockEvictSession,
  },
}));

vi.mock('@/storage/seq', () => ({
  allocateUserSeq: mockAllocateUserSeq,
}));

vi.mock('@/utils/randomKeyNaked', () => ({
  randomKeyNaked: mockRandomKeyNaked,
}));

vi.mock('@/app/events/eventRouter', () => ({
  eventRouter: {
    emitEphemeral: mockEmitEphemeral,
    emitUpdate: mockEmitUpdate,
  },
  buildSessionActivityEphemeral: mockBuildSessionActivityEphemeral,
  buildUpdateSessionUpdate: mockBuildUpdateSessionUpdate,
}));

describe('sessionReactivate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAllocateUserSeq.mockResolvedValue(101);
    mockRandomKeyNaked.mockReturnValue('rand-key');
    mockBuildSessionActivityEphemeral.mockReturnValue({ type: 'ephemeral' });
    mockBuildUpdateSessionUpdate.mockReturnValue({ type: 'update' });
  });

  it('re-activates an existing session without rewriting metadata or encryption key', async () => {
    const existingSession = {
      id: 'sess-1',
      accountId: 'user-1',
      status: 'offline',
      seq: 42,
      metadata: 'encrypted-old-metadata',
      metadataVersion: 7,
      dataEncryptionKey: 'old-dek',
      machineId: 'machine-1',
      agentState: '{"pending":true}',
      agentStateVersion: 3,
      capabilities: 'enc-cap',
      capabilitiesVersion: 2,
      lastActiveAt: new Date('2026-04-01T00:00:00.000Z'),
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:01.000Z'),
      archivedAt: null,
    };

    mockFindFirst.mockResolvedValue(existingSession);
    mockUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...existingSession,
      ...data,
      updatedAt: new Date('2026-04-11T00:00:00.000Z'),
    }));

    const restored = await sessionReactivate(
      { uid: 'user-1' },
      { sessionId: 'sess-1', machineId: 'machine-2' }
    );

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: {
        status: 'active',
        lastActiveAt: expect.any(Date),
        machineId: 'machine-2',
        agentState: null,
        agentStateVersion: 4,
      },
    });
    expect(restored).toMatchObject({
      id: 'sess-1',
      status: 'active',
      metadata: 'encrypted-old-metadata',
      metadataVersion: 7,
      dataEncryptionKey: 'old-dek',
      machineId: 'machine-2',
      agentState: null,
      agentStateVersion: 4,
    });
    expect(mockBuildUpdateSessionUpdate).toHaveBeenCalledWith(
      'sess-1',
      101,
      'rand-key',
      undefined,
      { value: null, version: 4 },
      undefined,
      undefined,
      'active',
      expect.any(Number)
    );
  });
});
