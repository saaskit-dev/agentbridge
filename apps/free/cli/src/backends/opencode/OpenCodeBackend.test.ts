import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionCapabilities } from '@/daemon/sessions/capabilities';
import { OpenCodeBackend } from './OpenCodeBackend';

const {
  mockOnMessage,
  mockOnSessionStarted,
  mockOnSessionUpdate,
  mockStartSession,
  mockSendPrompt,
  mockWaitForResponseComplete,
  mockCancel,
  mockDispose,
  mockCreateOpenCodeBackend,
} = vi.hoisted(() => {
  const mockOnMessage = vi.fn();
  const mockOnSessionStarted = vi.fn();
  const mockOnSessionUpdate = vi.fn();
  const mockStartSession = vi.fn().mockResolvedValue({ sessionId: 'acp-session-1' });
  const mockSendPrompt = vi.fn().mockResolvedValue(undefined);
  const mockWaitForResponseComplete = vi.fn().mockResolvedValue(undefined);
  const mockCancel = vi.fn().mockResolvedValue(undefined);
  const mockDispose = vi.fn().mockResolvedValue(undefined);
  const mockCreateOpenCodeBackend = vi.fn().mockImplementation(() => ({
    onMessage: mockOnMessage,
    onSessionStarted: mockOnSessionStarted,
    onSessionUpdate: mockOnSessionUpdate,
    startSession: mockStartSession,
    sendPrompt: mockSendPrompt,
    waitForResponseComplete: mockWaitForResponseComplete,
    cancel: mockCancel,
    dispose: mockDispose,
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
    mockCreateOpenCodeBackend,
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
  createOpenCodeBackend: mockCreateOpenCodeBackend,
}));

describe('OpenCodeBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires the shared ACP permission handler into the core factory', async () => {
    const backend = new OpenCodeBackend();

    await backend.start({
      cwd: '/tmp',
      env: {},
      mcpServerUrl: '',
      session: makeSession(),
      permissionMode: 'accept-edits',
    });

    expect(mockCreateOpenCodeBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionHandler: expect.objectContaining({
          handleToolCall: expect.any(Function),
        }),
      })
    );
  });

  it('publishes capabilities from session start and updates', async () => {
    const backend = new OpenCodeBackend();

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
        availableModels: [{ modelId: 'gpt-4.1', name: 'GPT 4.1' }],
        currentModelId: 'gpt-4.1',
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

    expect(capabilityEvents[0]?.models?.current).toBe('gpt-4.1');
    expect(capabilityEvents[1]?.commands?.[0]?.id).toBe('/compact');
  });
});
