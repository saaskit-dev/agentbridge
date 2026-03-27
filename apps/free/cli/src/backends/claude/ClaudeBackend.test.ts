import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@/agent';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';
import { ClaudeBackend } from './ClaudeBackend';

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
  mockCreateClaudeBackend,
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
  const mockCreateClaudeBackend = vi.fn().mockImplementation(() => ({
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
    mockCreateClaudeBackend,
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
  createClaudeBackend: mockCreateClaudeBackend,
}));

describe('ClaudeBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires the shared ACP permission handler into the backend factory', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
      permissionMode: 'accept-edits',
    });

    expect(mockCreateClaudeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionHandler: expect.objectContaining({
          handleToolCall: expect.any(Function),
        }),
      })
    );
  });

  it('publishes capabilities from session start and updates', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });

    const capabilityEvents: SessionCapabilities[] = [];
    const iterator = backend.capabilities[Symbol.asyncIterator]();
    const firstRead = iterator.next().then(result => {
      if (!result.done) {
        capabilityEvents.push(result.value);
      }
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as (value: unknown) => void;
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

    const secondRead = iterator.next().then(result => {
      if (!result.done) {
        capabilityEvents.push(result.value);
      }
    });
    const updateHandler = mockOnSessionUpdate.mock.calls[0]?.[0] as (value: unknown) => void;
    updateHandler({
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: '/compact', description: 'Compact context' }],
    });
    await secondRead;

    expect(capabilityEvents[0]?.models?.current).toBe('claude-sonnet');
    expect(capabilityEvents[1]?.commands?.[0]?.id).toBe('/compact');
  });

  // ─── Model selection ────────────────────────────────────────────────────────

  it('forwards model selection through ACP set_model API', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });
    await backend.sendMessage('hello');
    await backend.setModel('claude-opus');

    expect(mockSetSessionModel).toHaveBeenCalledWith('acp-session-1', 'claude-opus');
  });

  it('applies the initial model before sending the first prompt', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      model: 'claude-opus',
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });
    await backend.sendMessage('hello');

    expect(mockStartSession).toHaveBeenCalledWith();
    expect(mockSetSessionModel).toHaveBeenCalledWith('acp-session-1', 'claude-opus');
    expect(mockSendPrompt).toHaveBeenCalledWith('acp-session-1', expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('hello') }),
    ]));
    expect(mockSetSessionModel.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendPrompt.mock.invocationCallOrder[0]
    );
  });

  it('uses set_model API first when model config option is present, skips set_config_option on success', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as (value: unknown) => void;
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

    expect(mockSetSessionModel).toHaveBeenCalledWith('acp-session-1', 'claude-opus');
    expect(mockSetSessionConfigOption).not.toHaveBeenCalled();
  });

  it('falls back to set_config_option for model when set_model fails', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as (value: unknown) => void;
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
    mockSetSessionModel.mockRejectedValueOnce(
      new Error('ACP unstable_setSessionModel is not supported by this SDK connection')
    );

    await backend.setModel('claude-opus');

    expect(mockSetSessionModel).toHaveBeenCalledWith('acp-session-1', 'claude-opus');
    expect(mockSetSessionConfigOption).toHaveBeenCalledWith(
      'acp-session-1',
      'model_picker',
      'claude-opus'
    );
  });

  it('routes setConfig model option changes through set_model API', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as (value: unknown) => void;
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

    // App sends set-config RPC with the model option ID — should route through set_model
    await backend.setConfig?.('model_picker', 'claude-opus');

    expect(mockSetSessionModel).toHaveBeenCalledWith('acp-session-1', 'claude-opus');
    expect(mockSetSessionConfigOption).not.toHaveBeenCalledWith(
      'acp-session-1',
      'model_picker',
      'claude-opus'
    );
  });

  it('does not apply model when set_model unavailable and no model config option', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });

    // Session with models but no model config option
    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as (value: unknown) => void;
    startedHandler({
      sessionId: 'acp-session-1',
      models: {
        availableModels: [
          { modelId: 'claude-sonnet', name: 'Claude Sonnet' },
          { modelId: 'claude-opus', name: 'Claude Opus' },
        ],
        currentModelId: 'claude-sonnet',
      },
      configOptions: [],
    });

    await backend.sendMessage('hello');
    mockSetSessionModel.mockClear();
    mockSetSessionConfigOption.mockClear();
    mockSetSessionModel.mockRejectedValueOnce(new Error('not supported'));

    await backend.setModel('claude-opus');

    expect(mockSetSessionModel).toHaveBeenCalledWith('acp-session-1', 'claude-opus');
    // No model config option to fall back to — set_config_option must not be called
    expect(mockSetSessionConfigOption).not.toHaveBeenCalled();
  });

  // ─── Mode selection ─────────────────────────────────────────────────────────

  it('applies the initial mode via set_mode API before sending the first prompt', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mode: 'plan',
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as (value: unknown) => void;
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

    expect(mockSetSessionMode).toHaveBeenCalledWith('acp-session-1', 'plan');
    expect(mockSetSessionConfigOption).not.toHaveBeenCalled();
    expect(mockSetSessionMode.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendPrompt.mock.invocationCallOrder[0]
    );
  });

  it('replays deferred mode selection via set_mode API before the first prompt', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as (value: unknown) => void;
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

    expect(mockSetSessionMode).toHaveBeenCalledWith('acp-session-1', 'plan');
    expect(mockSetSessionConfigOption).not.toHaveBeenCalled();
    expect(mockSetSessionMode.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendPrompt.mock.invocationCallOrder[0]
    );
  });

  it('applies runtime mode changes via set_mode API', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as (value: unknown) => void;
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

    expect(mockSetSessionMode).toHaveBeenCalledWith('acp-session-1', 'plan');
    expect(mockSetSessionConfigOption).not.toHaveBeenCalled();
  });

  it('falls back to set_config_option for mode when set_mode fails', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as (value: unknown) => void;
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
    mockSetSessionMode.mockRejectedValueOnce(new Error('set_mode not supported'));

    await backend.setMode('plan');

    expect(mockSetSessionMode).toHaveBeenCalledWith('acp-session-1', 'plan');
    expect(mockSetSessionConfigOption).toHaveBeenCalledWith(
      'acp-session-1',
      'workflow_mode',
      'plan'
    );
  });

  // ─── Config selections ───────────────────────────────────────────────────────

  it('replays deferred config selections before the first prompt', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });

    const startedHandler = mockOnSessionStarted.mock.calls[0]?.[0] as (value: unknown) => void;
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

  // ─── Commands / output ───────────────────────────────────────────────────────

  it('runs capability commands through ACP prompts', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });
    await backend.sendMessage('hello');
    await backend.runCommand?.('/compact');

    expect(mockSendPrompt).toHaveBeenLastCalledWith('acp-session-1', [{ type: 'text', text: '/compact' }]);
  });

  it('maps agent messages onto output', async () => {
    const backend = new ClaudeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      freeMcpToolNames: [],
      session: makeSession(),
    });

    const iterator = backend.output[Symbol.asyncIterator]();
    const nextOutput = iterator.next();
    const onMessageHandler = mockOnMessage.mock.calls[0]?.[0] as (msg: AgentMessage) => void;
    onMessageHandler({ type: 'model-output', textDelta: 'hello' } as AgentMessage);

    const result = await nextOutput;
    expect(result.done).toBe(false);
    expect(result.value?.role).toBe('agent');
  });
});
