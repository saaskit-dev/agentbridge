import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resumeIntoManagedSession } from './resumeIntoManagedSession';

const { confirmMock, alertMock, spawnMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  alertMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('@/modal', () => ({
  Modal: {
    confirm: confirmMock,
    alert: alertMock,
  },
}));

vi.mock('@/sync/ops', () => ({
  machineSpawnNewSession: spawnMock,
}));

vi.mock('@/text', () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    if (key === 'machineImport.continueTitle') return 'Continue here?';
    if (key === 'machineImport.continueHere') return 'Continue here';
    if (key === 'common.cancel') return 'Cancel';
    if (key === 'common.create') return 'Create';
    if (key === 'common.error') return 'Error';
    if (key === 'machineImport.resumeFailedTitle') return 'Could not restore session';
    if (key === 'machineImport.directoryMissingTitle') return 'Create directory?';
    if (key === 'machineImport.directoryMissingBody') {
      return `Create ${String(params?.directory)}`;
    }
    if (key === 'machineImport.continueBody') {
      return `Continue ${String(params?.agent)}`;
    }
    if (key === 'machineImport.resumeFailedBody') {
      return `Resume failed for ${String(params?.agent)}`;
    }
    return key;
  },
}));

describe('resumeIntoManagedSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
  });

  it('spawns a managed session for import flows', async () => {
    const navigateToSession = vi.fn();
    spawnMock.mockResolvedValue({ type: 'success', sessionId: 'managed-1' });

    const result = await resumeIntoManagedSession({
      machineId: 'machine-1',
      directory: '/repo',
      agent: 'codex',
      resumeAgentSessionId: 'external-1',
      navigateToSession,
    });

    expect(spawnMock).toHaveBeenCalledWith({
      machineId: 'machine-1',
      directory: '/repo',
      sessionId: undefined,
      restoreSession: false,
      agent: 'codex',
      model: undefined,
      mode: undefined,
      permissionMode: undefined,
      resumeAgentSessionId: 'external-1',
      approvedNewDirectoryCreation: false,
      requireResumeSuccess: true,
      returnStructuredErrors: true,
    });
    expect(navigateToSession).toHaveBeenCalledWith('managed-1');
    expect(result).toBe('managed-1');
  });

  it('marks restoreSession=true when resuming an archived managed session', async () => {
    const navigateToSession = vi.fn();
    spawnMock.mockResolvedValue({ type: 'success', sessionId: 'managed-1' });

    await resumeIntoManagedSession({
      machineId: 'machine-1',
      directory: '/repo',
      agent: 'claude',
      resumeAgentSessionId: 'upstream-1',
      targetSessionId: 'managed-1',
      navigateToSession,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'managed-1',
        restoreSession: true,
        resumeAgentSessionId: 'upstream-1',
      })
    );
  });

  it('handles missing directories by prompting and retrying once', async () => {
    const navigateToSession = vi.fn();
    spawnMock
      .mockResolvedValueOnce({
        type: 'requestToApproveDirectoryCreation',
        directory: '/missing',
      })
      .mockResolvedValueOnce({
        type: 'success',
        sessionId: 'managed-2',
      });

    const result = await resumeIntoManagedSession({
      machineId: 'machine-1',
      directory: '/missing',
      agent: 'cursor',
      resumeAgentSessionId: 'external-2',
      navigateToSession,
    });

    expect(confirmMock).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.stringContaining('/missing'),
      expect.any(Object)
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        directory: '/missing',
        approvedNewDirectoryCreation: true,
      })
    );
    expect(navigateToSession).toHaveBeenCalledWith('managed-2');
    expect(result).toBe('managed-2');
  });

  it('shows the generic error alert for non-resume failures', async () => {
    const navigateToSession = vi.fn();
    spawnMock.mockResolvedValue({
      type: 'error',
      errorMessage: 'RPC unavailable',
    });

    const result = await resumeIntoManagedSession({
      machineId: 'machine-1',
      directory: '/repo',
      agent: 'opencode',
      resumeAgentSessionId: 'external-3',
      navigateToSession,
    });

    expect(alertMock).toHaveBeenCalledWith('Error', 'RPC unavailable');
    expect(navigateToSession).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
