import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@/agent';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';
import { ClaudeAcpBackend } from './ClaudeAcpBackend';

const {
  mockOnMessage,
  mockOnSessionStarted,
  mockOnSessionUpdate,
  mockStartSession,
  mockSendPrompt,
  mockWaitForResponseComplete,
  mockCancel,
  mockDispose,
  mockSetSessionModel,
  mockSetSessionMode,
  mockSetSessionConfigOption,
  mockCreateClaudeAcpBackend,
} = vi.hoisted(() => {
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
  const mockSetSessionConfigOption = vi.fn().mockResolvedValue(undefined);
  const mockCreateClaudeAcpBackend = vi.fn().mockImplementation(() => ({
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
    setSessionConfigOption: mockSetSessionConfigOption,
  }));

  return {
    mockOnMessage,
    mockOnSessionStarted,
    mockOnSessionUpdate,
    mockStartSession,
    mockSendPrompt,
    mockWaitForResponseComplete,
    mockCancel,
    mockDispose,
    mockSetSessionModel,
    mockSetSessionMode,
    mockSetSessionConfigOption,
    mockCreateClaudeAcpBackend,
  };
});
const makeSession = () =>
  ({
    sessionId: 'sess-1',
    rpcHandlerManager: {
      registerHandler: vi.fn(),
    },
    updateAgentState: vi.fn(),
  }) as never;
vi.mock('@saaskit-dev/agentbridge', () => ({
  createClaudeAcpBackend: mockCreateClaudeAcpBackend,
}));

describe('ClaudeAcpBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires the shared ACP permission handler into the backend factory', async () => {
    const backend = new ClaudeAcpBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session: makeSession(),
      permissionMode: 'accept-edits',
    });

    expect(mockCreateClaudeAcpBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionHandler: expect.objectContaining({
          handleToolCall: expect.any(Function),
        }),
      })
    );
  });

  it('publishes capabilities from session start and updates', async () => {
    const backend = new ClaudeAcpBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session: makeSession(),
    });

    const capabilityEvents: SessionCapabilities[] = [];
    const iterator = backend.capabilities[Symbol.asyncIterator]();
    const firstRead = iterator.next().then((result) => {
      if (!result.done) {
        capabilityEvents.push(result.value);
      }
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as ((value: unknown) => void);
    startedHandler({
      sessionId: 'acp-session-1',
      models: {
        availableModels: [{ modelId: 'claude-sonnet', name: 'Claude Sonnet' }],
        currentModelId: 'claude-sonnet',
      },
      modes: {
        availableModes: [{ id: 'default', name: 'Default' }],
        currentModeId: 'default',
      },
      configOptions: [],
    });
    await firstRead;

    const secondRead = iterator.next().then((result) => {
      if (!result.done) {
        capabilityEvents.push(result.value);
      }
    });
    const updateHandler = mockOnSessionUpdate.mock.calls[0]?.[0] as ((value: unknown) => void);
    updateHandler({
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: '/compact', description: 'Compact context' }],
    });
    await secondRead;

    expect(capabilityEvents[0]?.models?.current).toBe('claude-sonnet');
    expect(capabilityEvents[1]?.commands?.[0]?.id).toBe('/compact');
  });

  it('forwards model selection through ACP', async () => {
    const backend = new ClaudeAcpBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session: makeSession(),
    });
    await backend.sendMessage('hello');
    await backend.setModel('claude-opus');

    expect(mockSetSessionModel).toHaveBeenCalledWith('acp-session-1', 'claude-opus');
  });

  it('applies the initial model before sending the first prompt', async () => {
    const backend = new ClaudeAcpBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      model: 'claude-opus',
      mcpServerUrl: '',
      session: makeSession(),
    });
    await backend.sendMessage('hello');

    expect(mockStartSession).toHaveBeenCalledWith();
    expect(mockSetSessionModel).toHaveBeenCalledWith('acp-session-1', 'claude-opus');
    expect(mockSendPrompt).toHaveBeenCalledWith(
      'acp-session-1',
      expect.stringContaining('hello')
    );
    expect(mockSetSessionModel.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendPrompt.mock.invocationCallOrder[0]
    );
  });

  it('applies the initial mode before sending the first prompt', async () => {
    const backend = new ClaudeAcpBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mode: 'plan',
      mcpServerUrl: '',
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as ((value: unknown) => void);
    startedHandler({
      sessionId: 'acp-session-1',
      modes: {
        availableModes: [
          { id: 'default', name: 'Default' },
          { id: 'plan', name: 'Plan' },
        ],
        currentModeId: 'default',
      },
      configOptions: [
        {
          id: 'workflow_mode',
          name: 'Mode',
          category: 'mode',
          type: 'select',
          currentValue: 'default',
          options: [
            { value: 'default', name: 'Default' },
            { value: 'plan', name: 'Plan' },
          ],
        },
      ],
    });

    await backend.sendMessage('hello');

    expect(mockSetSessionConfigOption).toHaveBeenCalledWith('acp-session-1', 'workflow_mode', 'plan');
    expect(mockSetSessionMode).toHaveBeenCalledWith('acp-session-1', 'plan');
    expect(mockSetSessionConfigOption.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetSessionMode.mock.invocationCallOrder[0]
    );
    expect(mockSetSessionMode.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendPrompt.mock.invocationCallOrder[0]
    );
  });

  it('replays deferred mode selection through both configOption and session mode before the first prompt', async () => {
    const backend = new ClaudeAcpBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as ((value: unknown) => void);
    startedHandler({
      sessionId: 'acp-session-1',
      modes: {
        availableModes: [
          { id: 'default', name: 'Default' },
          { id: 'plan', name: 'Plan' },
        ],
        currentModeId: 'default',
      },
      configOptions: [
        {
          id: 'workflow_mode',
          name: 'Mode',
          category: 'mode',
          type: 'select',
          currentValue: 'default',
          options: [
            { value: 'default', name: 'Default' },
            { value: 'plan', name: 'Plan' },
          ],
        },
      ],
    });

    await backend.setMode('plan');
    await backend.sendMessage('hello');

    expect(mockSetSessionConfigOption).toHaveBeenCalledWith('acp-session-1', 'workflow_mode', 'plan');
    expect(mockSetSessionMode).toHaveBeenCalledWith('acp-session-1', 'plan');
    expect(mockSetSessionConfigOption.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetSessionMode.mock.invocationCallOrder[0]
    );
    expect(mockSetSessionMode.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendPrompt.mock.invocationCallOrder[0]
    );
  });

  it('applies runtime mode changes through both configOption and session mode', async () => {
    const backend = new ClaudeAcpBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as ((value: unknown) => void);
    startedHandler({
      sessionId: 'acp-session-1',
      modes: {
        availableModes: [
          { id: 'default', name: 'Default' },
          { id: 'plan', name: 'Plan' },
        ],
        currentModeId: 'default',
      },
      configOptions: [
        {
          id: 'workflow_mode',
          name: 'Mode',
          category: 'mode',
          type: 'select',
          currentValue: 'default',
          options: [
            { value: 'default', name: 'Default' },
            { value: 'plan', name: 'Plan' },
          ],
        },
      ],
    });

    await backend.sendMessage('hello');
    mockSetSessionMode.mockClear();
    mockSetSessionConfigOption.mockClear();

    await backend.setMode('plan');

    expect(mockSetSessionConfigOption).toHaveBeenCalledWith('acp-session-1', 'workflow_mode', 'plan');
    expect(mockSetSessionMode).toHaveBeenCalledWith('acp-session-1', 'plan');
  });

  it('forwards model selection through config options when model is configurable', async () => {
    const backend = new ClaudeAcpBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as ((value: unknown) => void);
    startedHandler({
      sessionId: 'acp-session-1',
      models: {
        availableModels: [
          { modelId: 'claude-sonnet', name: 'Claude Sonnet' },
          { modelId: 'claude-opus', name: 'Claude Opus' },
        ],
        currentModelId: 'claude-sonnet',
      },
      configOptions: [
        {
          id: 'model_picker',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'claude-sonnet',
          options: [
            { value: 'claude-sonnet', name: 'Claude Sonnet' },
            { value: 'claude-opus', name: 'Claude Opus' },
          ],
        },
      ],
    });

    await backend.sendMessage('hello');
    mockSetSessionModel.mockClear();
    mockSetSessionConfigOption.mockClear();

    await backend.setModel('claude-opus');

    expect(mockSetSessionConfigOption).toHaveBeenCalledWith(
      'acp-session-1',
      'model_picker',
      'claude-opus'
    );
    expect(mockSetSessionModel).not.toHaveBeenCalled();
  });

  it('replays deferred config selections before the first prompt', async () => {
    const backend = new ClaudeAcpBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as ((value: unknown) => void);
    startedHandler({
      sessionId: 'acp-session-1',
      configOptions: [
        {
          id: 'approval_policy',
          name: 'Approval Policy',
          category: 'approval',
          type: 'select',
          currentValue: 'default',
          options: [
            { value: 'default', name: 'Default' },
            { value: 'never', name: 'Never Ask' },
          ],
        },
      ],
    });

    await backend.setConfig?.('approval_policy', 'never');
    await backend.sendMessage('hello');

    expect(mockSetSessionConfigOption).toHaveBeenCalledWith(
      'acp-session-1',
      'approval_policy',
      'never'
    );
    expect(mockSetSessionConfigOption.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendPrompt.mock.invocationCallOrder[0]
    );
  });

  it('runs capability commands through ACP prompts', async () => {
    const backend = new ClaudeAcpBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session: makeSession(),
    });
    await backend.sendMessage('hello');
    await backend.runCommand?.('/compact');

    expect(mockSendPrompt).toHaveBeenLastCalledWith('acp-session-1', '/compact');
  });

  it('maps agent messages onto output', async () => {
    const backend = new ClaudeAcpBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session: makeSession(),
    });

    const iterator = backend.output[Symbol.asyncIterator]();
    const nextOutput = iterator.next();
    const onMessageHandler = mockOnMessage.mock.calls[0]?.[0] as ((msg: AgentMessage) => void);
    onMessageHandler({ type: 'model-output', textDelta: 'hello' } as AgentMessage);

    const result = await nextOutput;
    expect(result.done).toBe(false);
    expect(result.value?.role).toBe('agent');
  });
});
