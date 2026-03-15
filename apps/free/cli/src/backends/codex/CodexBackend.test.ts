import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexBackend } from './CodexBackend';

const mockConnect = vi.fn();
const mockSetHandler = vi.fn();
const mockSetPermissionHandler = vi.fn();
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockForceCloseSession = vi.fn().mockResolvedValue(undefined);

const mockUpdateSession = vi.fn();
const mockReset = vi.fn();

vi.mock('@/codex/codexMcpClient', () => ({
  CodexMcpClient: vi.fn().mockImplementation(() => ({
    sandboxEnabled: false,
    connect: mockConnect,
    setHandler: mockSetHandler,
    setPermissionHandler: mockSetPermissionHandler,
    disconnect: mockDisconnect,
    forceCloseSession: mockForceCloseSession,
  })),
}));

vi.mock('@/codex/utils/permissionHandler', () => ({
  CodexPermissionHandler: vi.fn().mockImplementation(() => ({
    updateSession: mockUpdateSession,
    reset: mockReset,
  })),
}));

describe('CodexBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a Codex permission handler on start', async () => {
    const backend = new CodexBackend();
    const session = { sessionId: 'sess-1' } as never;

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session,
    });

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockSetPermissionHandler).toHaveBeenCalledTimes(1);
    expect(mockSetHandler).toHaveBeenCalledTimes(1);
  });

  it('updates the permission handler when the session changes', async () => {
    const backend = new CodexBackend();
    const session = { sessionId: 'sess-1' } as never;
    const nextSession = { sessionId: 'sess-2' } as never;

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session,
    });
    backend.onSessionChange(nextSession);

    expect(mockUpdateSession).toHaveBeenCalledWith(nextSession);
  });

  it('resets the permission handler on stop', async () => {
    const backend = new CodexBackend();
    const session = { sessionId: 'sess-1' } as never;

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session,
    });
    await backend.stop();

    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(mockForceCloseSession).toHaveBeenCalledTimes(1);
  });
});
