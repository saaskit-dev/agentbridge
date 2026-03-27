import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexBackend } from './CodexBackend';

const mockOnMessage = vi.fn();
const mockOnSessionStarted = vi.fn();
const mockOnSessionUpdate = vi.fn();
const mockStartSession = vi.fn().mockResolvedValue({ sessionId: 'acp-session-1' });
const mockSendPrompt = vi.fn().mockResolvedValue(undefined);
const mockWaitForResponseComplete = vi.fn().mockResolvedValue(undefined);
const mockCancel = vi.fn().mockResolvedValue(undefined);
const mockDispose = vi.fn().mockResolvedValue(undefined);
const mockSetSessionModel = vi.fn().mockResolvedValue(undefined);
const mockSetSessionMode = vi.fn().mockResolvedValue(undefined);

vi.mock('@saaskit-dev/agentbridge', () => ({
  createCodexBackend: vi.fn().mockImplementation(() => ({
    onMessage: mockOnMessage,
    onSessionStarted: mockOnSessionStarted,
    onSessionUpdate: mockOnSessionUpdate,
    startSession: mockStartSession,
    sendPrompt: mockSendPrompt,
    waitForResponseComplete: mockWaitForResponseComplete,
    cancel: mockCancel,
    dispose: mockDispose,
    setSessionModel: mockSetSessionModel,
    setSessionMode: mockSetSessionMode,
  })),
}));

describe('CodexBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes capabilities from session start', async () => {
    const backend = new CodexBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: { sessionId: 'sess-1', rpcHandlerManager: { registerHandler: vi.fn() }, updateAgentState: vi.fn() } as never,
    });

    const iterator = backend.capabilities[Symbol.asyncIterator]();
    const nextCapability = iterator.next();
    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as (value: unknown) => void;
    startedHandler({
      sessionId: 'acp-session-1',
      models: {
        availableModels: [{ modelId: 'o3', name: 'OpenAI o3' }],
        currentModelId: 'o3',
      },
      configOptions: [],
    });

    const result = await nextCapability;
    expect(result.done).toBe(false);
    expect(result.value?.models?.current).toBe('o3');
  });

  it('forwards mode selection through ACP', async () => {
    const backend = new CodexBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: { sessionId: 'sess-1', rpcHandlerManager: { registerHandler: vi.fn() }, updateAgentState: vi.fn() } as never,
    });
    await backend.sendMessage('hello');
    await backend.setMode('full-auto');

    expect(mockSetSessionMode).toHaveBeenCalledWith('acp-session-1', 'full-auto');
  });

  it('applies the initial model before sending the first prompt', async () => {
    const backend = new CodexBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      model: 'gpt-5-codex-medium',
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: { sessionId: 'sess-1', rpcHandlerManager: { registerHandler: vi.fn() }, updateAgentState: vi.fn() } as never,
    });
    await backend.sendMessage('hello');

    expect(mockStartSession).toHaveBeenCalledWith();
    expect(mockSetSessionModel).toHaveBeenCalledWith('acp-session-1', 'gpt-5-codex-medium');
    expect(mockSendPrompt).toHaveBeenCalledWith('acp-session-1', expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('hello') }),
    ]));
    expect(mockSetSessionModel.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendPrompt.mock.invocationCallOrder[0]
    );
  });

  it('applies the initial mode before sending the first prompt', async () => {
    const backend = new CodexBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mode: 'full-auto',
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: { sessionId: 'sess-1', rpcHandlerManager: { registerHandler: vi.fn() }, updateAgentState: vi.fn() } as never,
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as (value: unknown) => void;
    startedHandler({
      sessionId: 'acp-session-1',
      modes: {
        availableModes: [
          { id: 'default', name: 'Default' },
          { id: 'full-auto', name: 'Full Auto' },
        ],
        currentModeId: 'default',
      },
      configOptions: [],
    });

    await backend.sendMessage('hello');

    expect(mockSetSessionMode).toHaveBeenCalledWith('acp-session-1', 'full-auto');
    expect(mockSetSessionMode.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendPrompt.mock.invocationCallOrder[0]
    );
  });

  it('runs capability commands through ACP prompts', async () => {
    const backend = new CodexBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: { sessionId: 'sess-1', rpcHandlerManager: { registerHandler: vi.fn() }, updateAgentState: vi.fn() } as never,
    });
    await backend.sendMessage('hello');
    await backend.runCommand?.('/plan');

    expect(mockSendPrompt).toHaveBeenLastCalledWith('acp-session-1', [{ type: 'text', text: '/plan' }]);
  });
});
