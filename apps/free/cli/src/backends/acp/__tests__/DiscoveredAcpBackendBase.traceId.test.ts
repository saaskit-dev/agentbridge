/**
 * DiscoveredAcpBackendBase per-turn traceId tests
 *
 * Verifies that ACP backends inject a per-turn traceId into every
 * NormalizedMessage, enabling the App reducer to correctly separate
 * text blocks across turns.
 *
 *   - All messages within one turn share the same traceId
 *   - Each sendMessage() call generates a new traceId
 *   - Existing traceId on a message is not overwritten
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock heavy deps
// ---------------------------------------------------------------------------

vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    debug() {}
    info() {}
    warn() {}
    error() {}
  },
}));

vi.mock('@saaskit-dev/agentbridge', () => ({
  safeStringify: (v: unknown) => String(v),
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

vi.mock('@/telemetry', () => ({
  setAcpSessionId: vi.fn(),
}));

vi.mock('@/backends/acp/mapAcpSessionCapabilities', () => ({
  applyCapabilitySelection: vi.fn(),
  getModeConfigOptionId: vi.fn(() => null),
  getModelConfigOptionId: vi.fn(() => null),
  mapAcpSessionCapabilities: vi.fn(() => ({})),
  mergeAcpSessionCapabilities: vi.fn(() => ({})),
  CAPABILITY_UPDATE_TYPES: new Set(),
}));

vi.mock('@/backends/acp/createFreeMcpServerConfig', () => ({
  createFreeMcpServerConfig: vi.fn(() => ({ command: 'node', args: [] })),
}));

vi.mock('@/backends/acp/modelSelection', () => ({
  getDefaultDiscoveredModelId: vi.fn(() => null),
  hasDiscoveredModel: vi.fn(() => false),
}));

vi.mock('@/backends/acp/AcpPermissionHandler', () => ({
  AcpPermissionHandler: class {
    constructor() {}
    setRequestedPermissionMode() {}
  },
}));

vi.mock('@/backends/acp/permissionModeMapping', () => ({
  getAgentModeForPermission: vi.fn(() => null),
  getPermissionModeForAgentMode: vi.fn(() => 'read-only'),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { DiscoveredAcpBackendBase } from '../DiscoveredAcpBackendBase';
import type { AgentBackend as IAgentBackend, AgentMessage } from '@/agent';
import type { NormalizedMessage } from '@/daemon/sessions/types';
import type { AgentStartOpts } from '@/daemon/sessions/AgentBackend';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush microtask queue so async iterable consumers can process pushed values. */
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

type MessageHandler = (msg: AgentMessage) => void;

/** Minimal mock ACP backend that lets us push messages via onMessage. */
function createMockAcpBackend() {
  let handler: MessageHandler | null = null;

  return {
    onMessage(h: MessageHandler) {
      handler = h;
    },
    onSessionStarted(_h: (response: unknown) => void) {},
    onSessionUpdate(_h: (update: unknown) => void) {},
    supportsLoadSession: () => false,
    startSession: vi.fn(async () => ({ sessionId: 'test-session-id' })),
    sendPrompt: vi.fn(async () => {}),
    waitForResponseComplete: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    /** Push a message as if the ACP child process emitted it */
    push(msg: AgentMessage) {
      handler?.(msg);
    },
  };
}

/** Concrete subclass for testing */
class TestAcpBackend extends DiscoveredAcpBackendBase {
  readonly agentType = 'codex' as const;
  mockBackend = createMockAcpBackend();

  protected createAcpBackend(): IAgentBackend {
    return this.mockBackend as unknown as IAgentBackend;
  }

  protected mapRawMessage(msg: AgentMessage): NormalizedMessage | null {
    if (msg.type === 'model-output') {
      return {
        id: Math.random().toString(36).slice(2),
        createdAt: Date.now(),
        isSidechain: false,
        role: 'agent',
        content: [{ type: 'text', text: msg.textDelta ?? '', uuid: 'u', parentUUID: null }],
      };
    }
    if (msg.type === 'tool-call') {
      return {
        id: Math.random().toString(36).slice(2),
        createdAt: Date.now(),
        isSidechain: false,
        role: 'agent',
        content: [
          {
            type: 'tool-call',
            id: msg.callId,
            name: msg.toolName,
            input: msg.args,
            description: null,
            uuid: 'u',
            parentUUID: null,
          },
        ],
      };
    }
    return null; // status, etc.
  }
}

function makeBackend(): TestAcpBackend {
  return new TestAcpBackend(new Logger('test'));
}

function makeStartOpts(): AgentStartOpts {
  return {
    cwd: '/tmp',
    env: {},
    mcpServerUrl: '',
    freeMcpToolNames: [],
    startingMode: 'remote',
    session: { sessionId: 'sid', updateAgentState: vi.fn() } as any,
  };
}

/** Start backend and begin collecting output messages. */
async function startCollecting(backend: TestAcpBackend): Promise<NormalizedMessage[]> {
  const collected: NormalizedMessage[] = [];
  // Start draining output in background
  (async () => {
    for await (const msg of backend.output) {
      collected.push(msg);
    }
  })();
  await backend.start(makeStartOpts());
  return collected;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiscoveredAcpBackendBase per-turn traceId', () => {
  let backend: TestAcpBackend;
  let collected: NormalizedMessage[];

  beforeEach(async () => {
    backend = makeBackend();
    collected = await startCollecting(backend);
  });

  it('injects traceId into messages emitted during a turn', async () => {
    backend.mockBackend.push({ type: 'model-output', textDelta: 'Hello' });
    backend.mockBackend.push({ type: 'model-output', textDelta: ' world' });
    await tick();

    expect(collected).toHaveLength(2);
    expect(collected[0].traceId).toBeDefined();
    expect(collected[1].traceId).toBeDefined();
    expect(collected[0].traceId).toBe(collected[1].traceId);
  });

  it('all messages within one turn share the same traceId', async () => {
    backend.mockBackend.push({ type: 'model-output', textDelta: 'text' });
    backend.mockBackend.push({
      type: 'tool-call',
      toolName: 'Read',
      args: {},
      callId: 'call_1',
    });
    backend.mockBackend.push({ type: 'model-output', textDelta: 'more text' });
    await tick();

    expect(collected).toHaveLength(3);
    const traceIds = new Set(collected.map(m => m.traceId));
    expect(traceIds.size).toBe(1);
  });

  it('generates a new traceId for each sendMessage call', async () => {
    // First turn
    backend.mockBackend.push({ type: 'model-output', textDelta: 'turn 1' });
    await tick();
    const turn1TraceId = collected[0].traceId;

    // Simulate new user message (new turn)
    await backend.sendMessage('next question');
    await tick(); // flush the 'ready' event emitted at turn end

    // Second turn
    backend.mockBackend.push({ type: 'model-output', textDelta: 'turn 2' });
    await tick();

    // Find the turn 2 model-output (skip any 'ready' events from sendMessage)
    const turn2Msg = collected.find(
      (m, i) =>
        i > 0 &&
        m.role === 'agent' &&
        Array.isArray(m.content) &&
        m.content.some((c: any) => c.type === 'text' && c.text === 'turn 2')
    );
    const turn2TraceId = turn2Msg?.traceId;

    expect(turn1TraceId).toBeDefined();
    expect(turn2TraceId).toBeDefined();
    expect(turn1TraceId).not.toBe(turn2TraceId);
  });

  it('does not overwrite existing traceId on a message', async () => {
    class PresetTraceBackend extends TestAcpBackend {
      protected mapRawMessage(msg: AgentMessage): NormalizedMessage | null {
        const base = super.mapRawMessage(msg);
        if (base) {
          base.traceId = 'preset-trace';
        }
        return base;
      }
    }

    const presetBackend = new PresetTraceBackend(new Logger('test'));
    const presetCollected = await startCollecting(presetBackend);

    presetBackend.mockBackend.push({ type: 'model-output', textDelta: 'hello' });
    await tick();

    expect(presetCollected).toHaveLength(1);
    expect(presetCollected[0].traceId).toBe('preset-trace');
  });

  it('status messages are not emitted (null from mapper)', async () => {
    backend.mockBackend.push({ type: 'status', status: 'running' });
    backend.mockBackend.push({ type: 'model-output', textDelta: 'text' });
    backend.mockBackend.push({ type: 'status', status: 'idle' });
    await tick();

    // Only the text message should be collected
    expect(collected).toHaveLength(1);
    expect(collected[0].traceId).toBeDefined();
  });
});
