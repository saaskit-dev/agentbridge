/**
 * attachmentHandler unit tests
 *
 * Tests upload-attachment event handling:
 *   - MIME type validation
 *   - Session ownership check
 *   - Daemon connection lookup
 *   - Successful relay to Daemon
 *   - Error paths (daemon returns ok:false, timeout/disconnect)
 *   - ArrayBuffer → Buffer conversion
 *   - Daemon connections are ignored; user-scoped and session-scoped are allowed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  findDaemonSession: vi.fn(),
  dbFindFirst: vi.fn(),
  randomUUID: vi.fn(() => 'aabbccdd-1122-3344-5566-778899aabbcc'),
}));

vi.mock('@/app/events/eventRouter', () => ({
  eventRouter: { findDaemonSession: mocks.findDaemonSession },
}));

vi.mock('@/storage/db', () => ({
  db: {
    session: { findFirst: mocks.dbFindFirst },
  },
}));

vi.mock('node:crypto', () => ({
  randomUUID: mocks.randomUUID,
}));

vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    warn() {}
    info() {}
    error() {}
    debug() {}
  },
}));

import { attachmentHandler } from '../attachmentHandler';
import type { ClientConnection } from '@/app/events/eventRouter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type UploadPayload = {
  sessionId: string;
  data: Buffer | ArrayBuffer;
  mimeType: string;
  filename?: string;
};

type AckResult = { ok: boolean; attachmentId?: string; error?: string };

type DownloadPayload = {
  sessionId: string;
  attachmentId: string;
  mimeType: string;
};

type DownloadAckResult = { ok: boolean; data?: Buffer; mimeType?: string; error?: string };

/** Create a fake socket that captures event handlers */
function makeSocket() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    /** Trigger the upload-attachment event and return the ack result */
    triggerUpload: async (payload: UploadPayload): Promise<AckResult> => {
      return new Promise(resolve => {
        (handlers['upload-attachment'] as any)?.(payload, resolve);
      });
    },
    /** Trigger the download-attachment event and return the ack result */
    triggerDownload: async (payload: DownloadPayload): Promise<DownloadAckResult> => {
      return new Promise(resolve => {
        (handlers['download-attachment'] as any)?.(payload, resolve);
      });
    },
  };
}

function makeSessionScopedConnection(isDaemon = false): ClientConnection {
  return {
    connectionType: 'session-scoped',
    sessionId: 'sess-123',
    socket: {} as any,
    userId: 'user-1',
    isDaemon,
  };
}

function makeDaemonSocket(emitWithAckResult: { ok: boolean } | Error) {
  const timeoutSocket = {
    emitWithAck: vi.fn(() =>
      emitWithAckResult instanceof Error
        ? Promise.reject(emitWithAckResult)
        : Promise.resolve(emitWithAckResult)
    ),
  };
  return {
    socket: {
      timeout: vi.fn(() => timeoutSocket),
    } as any,
    _timeoutSocket: timeoutSocket,
  };
}

const VALID_PAYLOAD: UploadPayload = {
  sessionId: 'sess-123',
  data: Buffer.from('fake-image-data'),
  mimeType: 'image/jpeg',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('attachmentHandler — connection filtering', () => {
  it('does nothing for daemon connections (isDaemon=true)', () => {
    const socket = makeSocket();
    const connection = makeSessionScopedConnection(true);

    attachmentHandler('user-1', socket as any, connection);

    expect(socket.on).not.toHaveBeenCalled();
  });

  it('registers handler for user-scoped connections (App client)', () => {
    const socket = makeSocket();
    const connection: ClientConnection = { connectionType: 'user-scoped', socket: {} as any, userId: 'user-1' };

    attachmentHandler('user-1', socket as any, connection);

    expect(socket.on).toHaveBeenCalledWith('upload-attachment', expect.any(Function));
  });

  it('registers upload-attachment and download-attachment handlers for non-daemon session-scoped connections', () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

    expect(socket.on).toHaveBeenCalledWith('upload-attachment', expect.any(Function));
    expect(socket.on).toHaveBeenCalledWith('download-attachment', expect.any(Function));
  });
});

describe('attachmentHandler — MIME validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])(
    'accepts %s',
    async mimeType => {
      const socket = makeSocket();
      attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

      mocks.dbFindFirst.mockResolvedValue({ id: 'sess-123' });
      const { socket: daemonSocket } = makeDaemonSocket({ ok: true });
      mocks.findDaemonSession.mockReturnValue({ socket: daemonSocket });

      const result = await socket.triggerUpload({ ...VALID_PAYLOAD, mimeType });

      expect(result.ok).toBe(true);
    }
  );

  it.each(['image/tiff', 'video/mp4', 'application/pdf', 'text/plain'])(
    'rejects unsupported MIME type %s before DB access',
    async mimeType => {
      const socket = makeSocket();
      attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

      const result = await socket.triggerUpload({ ...VALID_PAYLOAD, mimeType });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('unsupported_mime_type');
      expect(mocks.dbFindFirst).not.toHaveBeenCalled();
    }
  );
});

describe('attachmentHandler — session ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns session_not_found when session does not belong to user', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

    mocks.dbFindFirst.mockResolvedValue(null);

    const result = await socket.triggerUpload(VALID_PAYLOAD);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('session_not_found');
    expect(mocks.findDaemonSession).not.toHaveBeenCalled();
  });
});

describe('attachmentHandler — daemon relay', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns daemon_offline when daemon is not connected', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

    mocks.dbFindFirst.mockResolvedValue({ id: 'sess-123' });
    mocks.findDaemonSession.mockReturnValue(null);

    const result = await socket.triggerUpload(VALID_PAYLOAD);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('daemon_offline');
  });

  it('forwards to daemon and returns attachmentId on success', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

    mocks.dbFindFirst.mockResolvedValue({ id: 'sess-123' });
    const { socket: daemonSocket, _timeoutSocket } = makeDaemonSocket({ ok: true });
    mocks.findDaemonSession.mockReturnValue({ socket: daemonSocket });

    const result = await socket.triggerUpload(VALID_PAYLOAD);

    expect(result.ok).toBe(true);
    // UUID 'aabbccdd-1122-3344-5566-778899aabbcc' with dashes removed
    expect(result.attachmentId).toBe('aabbccdd112233445566778899aabbcc');
    expect(_timeoutSocket.emitWithAck).toHaveBeenCalledWith(
      'file-transfer',
      expect.objectContaining({
        mimeType: 'image/jpeg',
        sessionId: 'sess-123',
        data: expect.any(Buffer),
      })
    );
  });

  it('returns daemon_error when daemon replies with ok:false', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

    mocks.dbFindFirst.mockResolvedValue({ id: 'sess-123' });
    const { socket: daemonSocket } = makeDaemonSocket({ ok: false });
    mocks.findDaemonSession.mockReturnValue({ socket: daemonSocket });

    const result = await socket.triggerUpload(VALID_PAYLOAD);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('daemon_error');
  });

  it('returns daemon_offline on timeout / emitWithAck rejection', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

    mocks.dbFindFirst.mockResolvedValue({ id: 'sess-123' });
    const { socket: daemonSocket } = makeDaemonSocket(new Error('operation timed out'));
    mocks.findDaemonSession.mockReturnValue({ socket: daemonSocket });

    const result = await socket.triggerUpload(VALID_PAYLOAD);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('daemon_offline');
  });

  it('converts ArrayBuffer payload to Buffer before forwarding', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

    mocks.dbFindFirst.mockResolvedValue({ id: 'sess-123' });
    const { socket: daemonSocket, _timeoutSocket } = makeDaemonSocket({ ok: true });
    mocks.findDaemonSession.mockReturnValue({ socket: daemonSocket });

    const ab = new ArrayBuffer(4);
    new Uint8Array(ab).set([1, 2, 3, 4]);

    await socket.triggerUpload({ ...VALID_PAYLOAD, data: ab });

    const firstCall = _timeoutSocket.emitWithAck.mock.calls[0] as unknown as [
      string,
      { data: Buffer },
    ];
    expect(firstCall).toBeDefined();
    const forwarded = firstCall[1];
    expect(Buffer.isBuffer(forwarded.data)).toBe(true);
    expect(Array.from(forwarded.data)).toEqual([1, 2, 3, 4]);
  });
});

// ---------------------------------------------------------------------------
// Tests — download-attachment
// ---------------------------------------------------------------------------

const VALID_DOWNLOAD: DownloadPayload = {
  sessionId: 'sess-123',
  attachmentId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  mimeType: 'image/jpeg',
};

describe('attachmentHandler — download MIME validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects unsupported MIME type', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

    const result = await socket.triggerDownload({ ...VALID_DOWNLOAD, mimeType: 'image/tiff' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('unsupported_mime_type');
  });

  it('rejects invalid attachment id', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

    const result = await socket.triggerDownload({ ...VALID_DOWNLOAD, attachmentId: 'bad-id' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_attachment_id');
  });
});

describe('attachmentHandler — download session ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns session_not_found when session does not belong to user', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());
    mocks.dbFindFirst.mockResolvedValue(null);

    const result = await socket.triggerDownload(VALID_DOWNLOAD);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('session_not_found');
  });
});

describe('attachmentHandler — download daemon relay', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns daemon_offline when daemon is not connected', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());
    mocks.dbFindFirst.mockResolvedValue({ id: 'sess-123' });
    mocks.findDaemonSession.mockReturnValue(null);

    const result = await socket.triggerDownload(VALID_DOWNLOAD);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('daemon_offline');
  });

  it('forwards fetch-attachment to daemon and relays data back', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

    mocks.dbFindFirst.mockResolvedValue({ id: 'sess-123' });
    const fileData = Buffer.from('image-bytes');
    const daemonResult = { ok: true, data: fileData, mimeType: 'image/jpeg' };
    const { socket: daemonSocket, _timeoutSocket } = makeDaemonSocket(daemonResult as any);
    mocks.findDaemonSession.mockReturnValue({ socket: daemonSocket });

    const result = await socket.triggerDownload(VALID_DOWNLOAD);

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(fileData);
    expect(_timeoutSocket.emitWithAck).toHaveBeenCalledWith(
      'fetch-attachment',
      { id: VALID_DOWNLOAD.attachmentId, mimeType: 'image/jpeg' }
    );
  });

  it('returns daemon_error when daemon replies with ok:false', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

    mocks.dbFindFirst.mockResolvedValue({ id: 'sess-123' });
    const { socket: daemonSocket } = makeDaemonSocket({ ok: false } as any);
    mocks.findDaemonSession.mockReturnValue({ socket: daemonSocket });

    const result = await socket.triggerDownload(VALID_DOWNLOAD);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('daemon_error');
  });

  it('returns daemon_offline on timeout', async () => {
    const socket = makeSocket();
    attachmentHandler('user-1', socket as any, makeSessionScopedConnection());

    mocks.dbFindFirst.mockResolvedValue({ id: 'sess-123' });
    const { socket: daemonSocket } = makeDaemonSocket(new Error('timed out'));
    mocks.findDaemonSession.mockReturnValue({ socket: daemonSocket });

    const result = await socket.triggerDownload(VALID_DOWNLOAD);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('daemon_offline');
  });
});
