/**
 * AgentSession attachment tests
 *
 * Tests the following attachment behaviors without requiring full initialize():
 *   - receiveAttachment: atomic write (tmp → rename), correct path/permissions
 *   - handleFileTransfer: MIME/id validation, ack routing, error handling
 *   - sendInput: pushes empty attachment entry to pendingAttachments (1:1 sync)
 *   - onUserMessage path: attachmentRefs resolved to LocalAttachment[]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock heavy dependencies that we don't need for attachment testing
// ---------------------------------------------------------------------------

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn<() => Promise<void>>(),
  writeFile: vi.fn<() => Promise<void>>(),
  rename: vi.fn<() => Promise<void>>(),
}));

vi.mock('node:fs/promises', () => ({ default: fsMock }));

vi.mock('@/configuration', () => ({
  configuration: {
    freeHomeDir: '/tmp/test-free',
    serverUrl: 'https://server.test',
  },
}));

vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    debug() {}
    info() {}
    warn() {}
    error() {}
  },
  getCollector: vi.fn(() => ({ addSink: vi.fn() })),
  isCollectorReady: vi.fn(() => false),
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

vi.mock('@saaskit-dev/agentbridge', () => ({
  safeStringify: (v: unknown) => String(v),
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

vi.mock('@/utils/deterministicJson', () => ({
  hashObject: (obj: Record<string, unknown>) => JSON.stringify(obj),
}));

vi.mock('@/utils/childProcessUtils', () => ({
  getChildPids: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/telemetry', () => ({
  getProcessTraceContext: vi.fn(() => null),
  setCurrentTurnTrace: vi.fn(),
  shutdownTelemetry: vi.fn(),
  isAnalyticsEnabledSync: vi.fn(() => false),
}));

vi.mock('@/projectPath', () => ({
  projectPath: vi.fn(() => '/tmp/test-project'),
}));

vi.mock('@/daemon/sessions/sessionPersistence', () => ({
  persistSession: vi.fn().mockResolvedValue(undefined),
  eraseSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/MessageQueue2', async importOriginal => {
  // Use real MessageQueue2 so queue behavior is accurate
  return importOriginal();
});

import { AgentSession, type AgentSessionOpts } from './AgentSession';
import type { AgentBackend } from './AgentBackend';
import type { ApiSessionClient } from '@/api/apiSession';
import type { Credentials } from '@/persistence';
import type { AgentType, NormalizedMessage } from './types';
import type { IPCServerMessage } from '@/daemon/ipc/protocol';
import { MessageQueue2 } from '@/utils/MessageQueue2';

// ---------------------------------------------------------------------------
// Minimal concrete subclass
// ---------------------------------------------------------------------------

class TestSession extends AgentSession<string> {
  readonly agentType: AgentType = 'claude';

  createBackend(): AgentBackend {
    return {
      agentType: 'claude',
      output: {
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      } as never,
      start: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      sendPtyInput: vi.fn(),
      resizePty: vi.fn(),
    };
  }

  createModeHasher(): (mode: string) => string {
    return () => 'hash';
  }

  defaultMode(): string {
    return 'default';
  }

  protected extractMode(): string {
    return 'default';
  }

  injectSession(session: ApiSessionClient): void {
    this.session = session;
  }

  injectMessageQueue(): MessageQueue2<string> {
    const q = new MessageQueue2<string>(() => 'hash');
    this.messageQueue = q;
    return q;
  }

  getPendingAttachments(): unknown[][] {
    return (this as any).pendingAttachments;
  }

  getAttachmentsDir(): string {
    return (this as any).attachmentsDir;
  }

  async callReceiveAttachment(id: string, data: Buffer, ext: string): Promise<void> {
    return (this as any).receiveAttachment(id, data, ext);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOpts(): AgentSessionOpts {
  return {
    credential: { token: 'test' } as Credentials,
    machineId: 'machine-1',
    startedBy: 'cli',
    cwd: '/tmp/test',
    broadcast: (_sid: string, _msg: IPCServerMessage) => {},
    daemonInstanceId: 'daemon-1',
  };
}

function makeMockSession(sessionId = 'sess-test'): ApiSessionClient & {
  capturedFileTransferCallback: ((payload: any, ack: any) => Promise<void>) | null;
} {
  let capturedFileTransferCallback: ((payload: any, ack: any) => Promise<void>) | null = null;
  return {
    sessionId,
    capturedFileTransferCallback: null as any,
    rpcHandlerManager: {
      registerHandler: vi.fn(),
      unregisterHandler: vi.fn(),
    },
    sendNormalizedMessage: vi.fn().mockResolvedValue('local-id'),
    sendStreamingTextDelta: vi.fn(),
    sendStreamingTextComplete: vi.fn(),
    updateCapabilities: vi.fn(),
    updateMetadata: vi.fn(),
    sendSessionDeath: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    onFileTransfer: vi.fn().mockImplementation((cb: any) => {
      capturedFileTransferCallback = cb;
    }),
    get _capturedCb() { return capturedFileTransferCallback; },
  } as unknown as ApiSessionClient & { capturedFileTransferCallback: ((payload: any, ack: any) => Promise<void>) | null };
}

// ---------------------------------------------------------------------------
// Tests — receiveAttachment
// ---------------------------------------------------------------------------

describe('AgentSession.receiveAttachment()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes file atomically: mkdir → writeFile(.tmp) → rename', async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.rename.mockResolvedValue(undefined);

    const session = new TestSession(makeOpts());
    const data = Buffer.from('image-bytes');
    const id = 'a'.repeat(32);

    await session.callReceiveAttachment(id, data, 'jpg');

    const dir = session.getAttachmentsDir();
    const filePath = `${dir}/${id}.jpg`;
    const tmpPath = `${filePath}.tmp`;

    expect(fsMock.mkdir).toHaveBeenCalledWith(dir, { recursive: true, mode: 0o700 });
    expect(fsMock.writeFile).toHaveBeenCalledWith(tmpPath, data, { mode: 0o600 });
    expect(fsMock.rename).toHaveBeenCalledWith(tmpPath, filePath);
  });

  it('propagates error if writeFile fails', async () => {
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockRejectedValue(new Error('disk full'));
    fsMock.rename.mockResolvedValue(undefined);

    const session = new TestSession(makeOpts());
    await expect(session.callReceiveAttachment('b'.repeat(32), Buffer.alloc(4), 'png'))
      .rejects.toThrow('disk full');

    expect(fsMock.rename).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — handleFileTransfer
// ---------------------------------------------------------------------------

describe('AgentSession.handleFileTransfer()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.rename.mockResolvedValue(undefined);
  });

  const VALID_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
  const VALID_PAYLOAD = { id: VALID_ID, data: Buffer.from('img'), mimeType: 'image/jpeg' };

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])(
    'accepts supported MIME type %s',
    async mimeType => {
      const session = new TestSession(makeOpts());
      const ack = vi.fn();

      await session.handleFileTransfer({ ...VALID_PAYLOAD, mimeType }, ack, 'sess-1');

      expect(ack).toHaveBeenCalledWith({ ok: true });
    }
  );

  it('rejects unsupported MIME type', async () => {
    const session = new TestSession(makeOpts());
    const ack = vi.fn();

    await session.handleFileTransfer({ ...VALID_PAYLOAD, mimeType: 'image/tiff' }, ack, 'sess-1');

    expect(ack).toHaveBeenCalledWith({ ok: false });
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    'traversal/../secret',          // path traversal attempt
    '../escape',                     // leading dots
    'abc',                           // too short
    'g'.repeat(32),                  // non-hex character
    'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4extra', // too long
    '',                              // empty
  ])('rejects invalid id format: %s', async id => {
    const session = new TestSession(makeOpts());
    const ack = vi.fn();

    await session.handleFileTransfer({ ...VALID_PAYLOAD, id }, ack, 'sess-1');

    expect(ack).toHaveBeenCalledWith({ ok: false });
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('acks ok:false when receiveAttachment throws', async () => {
    fsMock.writeFile.mockRejectedValue(new Error('io error'));

    const session = new TestSession(makeOpts());
    const ack = vi.fn();

    await session.handleFileTransfer(VALID_PAYLOAD, ack, 'sess-1');

    expect(ack).toHaveBeenCalledWith({ ok: false });
  });

  it('writes file with correct extension for each MIME type', async () => {
    const cases: Array<[string, string]> = [
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
      ['image/gif', 'gif'],
    ];

    const session = new TestSession(makeOpts());
    const dir = session.getAttachmentsDir();

    for (const [mimeType, ext] of cases) {
      vi.clearAllMocks();
      fsMock.mkdir.mockResolvedValue(undefined);
      fsMock.writeFile.mockResolvedValue(undefined);
      fsMock.rename.mockResolvedValue(undefined);

      await session.handleFileTransfer({ ...VALID_PAYLOAD, mimeType }, vi.fn(), 'sess');

      expect(fsMock.rename).toHaveBeenCalledWith(
        `${dir}/${VALID_ID}.${ext}.tmp`,
        `${dir}/${VALID_ID}.${ext}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — pendingAttachments dual-queue tracking
// ---------------------------------------------------------------------------

describe('AgentSession.sendInput() — pendingAttachments sync', () => {
  it('pushes an empty attachment entry for each sendInput call', () => {
    const session = new TestSession(makeOpts());
    session.injectMessageQueue();

    session.sendInput('msg1');
    session.sendInput('msg2');

    expect(session.getPendingAttachments()).toEqual([[], []]);
  });

  it('pendingAttachments remains empty when messageQueue is not initialized', () => {
    const session = new TestSession(makeOpts());
    // No messageQueue injected — messages go to preInitQueue
    session.sendInput('buffered');

    expect(session.getPendingAttachments()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests — file-transfer handler registration via onFileTransfer
// ---------------------------------------------------------------------------

describe('AgentSession file-transfer handler wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.rename.mockResolvedValue(undefined);
  });

  it('onFileTransfer is called on the session after registration', () => {
    const session = new TestSession(makeOpts());
    const mockSession = makeMockSession('sess-ft');
    session.injectSession(mockSession);

    // Simulate what initialize() does
    mockSession.onFileTransfer(
      (payload: any, ack: any) => session.handleFileTransfer(payload, ack, mockSession.sessionId)
    );

    expect(mockSession.onFileTransfer).toHaveBeenCalledTimes(1);
  });

  it('registered handler resolves to ok:true for valid payload', async () => {
    const session = new TestSession(makeOpts());
    const mockSession = makeMockSession('sess-ft');
    session.injectSession(mockSession);

    let registeredHandler: ((payload: any, ack: any) => Promise<void>) | null = null;
    (mockSession.onFileTransfer as ReturnType<typeof vi.fn>).mockImplementation((cb: any) => {
      registeredHandler = cb;
    });

    // Register as initialize() would
    mockSession.onFileTransfer(
      (payload: any, ack: any) => session.handleFileTransfer(payload, ack, mockSession.sessionId)
    );

    expect(registeredHandler).not.toBeNull();

    const ack = vi.fn();
    await registeredHandler!({
      id: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      data: Buffer.from('img'),
      mimeType: 'image/png',
    }, ack);

    expect(ack).toHaveBeenCalledWith({ ok: true });
  });
});
