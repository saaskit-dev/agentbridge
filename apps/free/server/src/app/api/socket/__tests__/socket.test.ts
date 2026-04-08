import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class FakeServer {
    static lastInstance: FakeServer | null = null;

    connectionHandler: ((socket: any) => Promise<void> | void) | null = null;
    close = vi.fn().mockResolvedValue(undefined);
    adapter = vi.fn();

    constructor(_server: unknown, _opts: unknown) {
      FakeServer.lastInstance = this;
    }

    on(event: string, handler: (socket: any) => Promise<void> | void) {
      if (event === 'connection') {
        this.connectionHandler = handler;
      }
      return this;
    }
  }

  return {
    FakeServer,
    verifyToken: vi.fn(),
    addConnection: vi.fn(),
    removeConnection: vi.fn(),
    hasMachineConnection: vi.fn(),
    hasSessionConnection: vi.fn(),
    emitEphemeral: vi.fn(),
    machineUpdateMany: vi.fn(),
    sessionUpdateMany: vi.fn(),
    sendSilentReconnectPush: vi.fn(),
    websocketEventsInc: vi.fn(),
    incrementConnection: vi.fn(),
    decrementConnection: vi.fn(),
    loggerInfo: vi.fn(),
    loggerError: vi.fn(),
    loggerWarn: vi.fn(),
    loggerDebug: vi.fn(),
    onShutdown: vi.fn(),
    shouldDrainWebSocketsGracefully: vi.fn(),
    rpcHandler: vi.fn(),
    pingHandler: vi.fn(),
    sessionUpdateHandler: vi.fn(),
    machineUpdateHandler: vi.fn(),
    artifactUpdateHandler: vi.fn(),
    accessKeyHandler: vi.fn(),
    streamingHandler: vi.fn(),
    usageHandler: vi.fn(),
    attachmentHandler: vi.fn(),
    replayMissedMessages: vi.fn(() => Promise.resolve()),
    createAdapter: vi.fn(),
    Pool: vi.fn(),
  };
});

vi.mock('socket.io', () => ({
  Server: mocks.FakeServer,
}));

vi.mock('@socket.io/postgres-adapter', () => ({
  createAdapter: mocks.createAdapter,
}));

vi.mock('pg', () => ({
  Pool: mocks.Pool,
}));

vi.mock('@/app/push/pushSender', () => ({
  sendSilentReconnectPush: mocks.sendSilentReconnectPush,
}));

vi.mock('@/app/auth/auth', () => ({
  auth: {
    verifyToken: mocks.verifyToken,
  },
}));

vi.mock('@/app/events/eventRouter', () => ({
  eventRouter: {
    addConnection: mocks.addConnection,
    removeConnection: mocks.removeConnection,
    hasMachineConnection: mocks.hasMachineConnection,
    hasSessionConnection: mocks.hasSessionConnection,
    emitEphemeral: mocks.emitEphemeral,
  },
  buildMachineActivityEphemeral: vi.fn(() => ({ type: 'machine-activity' })),
  buildSessionActivityEphemeral: vi.fn(() => ({ type: 'session-activity' })),
}));

vi.mock('@/storage/db', () => ({
  db: {
    machine: {
      updateMany: mocks.machineUpdateMany,
    },
    session: {
      updateMany: mocks.sessionUpdateMany,
    },
  },
}));

vi.mock('@/utils/delay', () => ({
  delay: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/utils/forever', () => ({
  forever: vi.fn(),
}));

vi.mock('../rpcHandler', () => ({
  rpcHandler: mocks.rpcHandler,
}));

vi.mock('../pingHandler', () => ({
  pingHandler: mocks.pingHandler,
}));

vi.mock('../sessionUpdateHandler', () => ({
  sessionUpdateHandler: mocks.sessionUpdateHandler,
}));

vi.mock('../machineUpdateHandler', () => ({
  machineUpdateHandler: mocks.machineUpdateHandler,
}));

vi.mock('../artifactUpdateHandler', () => ({
  artifactUpdateHandler: mocks.artifactUpdateHandler,
}));

vi.mock('../accessKeyHandler', () => ({
  accessKeyHandler: mocks.accessKeyHandler,
}));

vi.mock('../streamingHandler', () => ({
  streamingHandler: mocks.streamingHandler,
}));

vi.mock('../usageHandler', () => ({
  usageHandler: mocks.usageHandler,
}));

vi.mock('../attachmentHandler', () => ({
  attachmentHandler: mocks.attachmentHandler,
}));

vi.mock('../replayHandler', () => ({
  replayMissedMessages: mocks.replayMissedMessages,
}));

vi.mock('@/app/monitoring/metrics2', () => ({
  websocketEventsCounter: {
    inc: mocks.websocketEventsInc,
  },
  incrementWebSocketConnection: mocks.incrementConnection,
  decrementWebSocketConnection: mocks.decrementConnection,
}));

vi.mock('../../monitoring/metrics2', () => ({
  websocketEventsCounter: {
    inc: mocks.websocketEventsInc,
  },
  incrementWebSocketConnection: mocks.incrementConnection,
  decrementWebSocketConnection: mocks.decrementConnection,
}));

vi.mock('@/utils/shutdown', () => ({
  onShutdown: mocks.onShutdown,
  shouldDrainWebSocketsGracefully: mocks.shouldDrainWebSocketsGracefully,
  SHUTDOWN_PHASE: {
    NETWORK: 0,
    APP: 1,
    STORAGE: 2,
  },
}));

vi.mock('@/utils/requestTrace', () => ({
  runWithTrace: (_ctx: unknown, next: () => void) => next(),
}));

vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    info(...args: unknown[]) {
      mocks.loggerInfo(...args);
    }
    error(...args: unknown[]) {
      mocks.loggerError(...args);
    }
    warn(...args: unknown[]) {
      mocks.loggerWarn(...args);
    }
    debug(...args: unknown[]) {
      mocks.loggerDebug(...args);
    }
  },
  continueTrace: vi.fn(() => ({})),
  createTrace: vi.fn(() => ({})),
}));

import { startSocket } from '../../socket';

function makeSocket(auth: Record<string, unknown>, socketId = 'socket-1') {
  const handlers: Record<string, (...args: any[]) => any> = {};

  return {
    id: socketId,
    handshake: { auth },
    on: vi.fn((event: string, handler: (...args: any[]) => any) => {
      handlers[event] = handler;
    }),
    use: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    async triggerDisconnect(reason: string) {
      handlers.disconnect?.(reason);
      await new Promise(resolve => setTimeout(resolve, 0));
    },
  };
}

async function connectSocket(auth: Record<string, unknown>, socketId?: string) {
  mocks.verifyToken.mockResolvedValue({ userId: 'user-1' });
  const app = { server: {} } as any;
  await startSocket(app);

  const io = mocks.FakeServer.lastInstance;
  if (!io?.connectionHandler) {
    throw new Error('connection handler not registered');
  }

  const socket = makeSocket({ token: 'token-1', ...auth }, socketId);
  await io.connectionHandler(socket);
  return socket;
}

describe('startSocket disconnect guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.FakeServer.lastInstance = null;
    mocks.verifyToken.mockResolvedValue({ userId: 'user-1' });
    mocks.hasMachineConnection.mockReturnValue(false);
    mocks.hasSessionConnection.mockReturnValue(false);
    mocks.shouldDrainWebSocketsGracefully.mockReturnValue(false);
    mocks.machineUpdateMany.mockResolvedValue({ count: 1 });
    mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.sendSilentReconnectPush.mockResolvedValue(undefined);
  });

  it('keeps machine active when another connection for the same machine remains', async () => {
    mocks.hasMachineConnection.mockReturnValue(true);

    const socket = await connectSocket({
      clientType: 'machine-scoped',
      machineId: 'machine-1',
    });

    await socket.triggerDisconnect('transport close');

    expect(mocks.machineUpdateMany).not.toHaveBeenCalled();
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      '[disconnect] machine still connected elsewhere, skipping inactive transition',
      expect.objectContaining({
        machineId: 'machine-1',
        socketId: 'socket-1',
        reason: 'transport close',
      })
    );
  });

  it('keeps session active when another connection for the same session remains', async () => {
    mocks.hasSessionConnection.mockReturnValue(true);

    const socket = await connectSocket({
      clientType: 'session-scoped',
      sessionId: 'session-1',
    });

    await socket.triggerDisconnect('transport close');

    expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      '[disconnect] session still connected elsewhere, skipping offline transition',
      expect.objectContaining({
        sessionId: 'session-1',
        socketId: 'socket-1',
        reason: 'transport close',
      })
    );
  });

  it('swallows reconnect push failures inside the disconnect worker', async () => {
    mocks.sendSilentReconnectPush.mockRejectedValue(new Error('push failed'));

    const socket = await connectSocket({
      clientType: 'user-scoped',
    });

    await socket.triggerDisconnect('transport close');

    expect(mocks.sendSilentReconnectPush).toHaveBeenCalledWith('user-1');
    expect(mocks.loggerError).toHaveBeenCalledWith(
      '[disconnect] unexpected async error',
      expect.objectContaining({
        userId: 'user-1',
        connectionType: 'user-scoped',
        error: 'Error: push failed',
      })
    );
  });

  it('skips offline transitions and reconnect push during graceful server drain', async () => {
    mocks.shouldDrainWebSocketsGracefully.mockReturnValue(true);

    const sessionSocket = await connectSocket({
      clientType: 'session-scoped',
      sessionId: 'session-1',
    });
    const userSocket = await connectSocket({
      clientType: 'user-scoped',
    }, 'socket-2');

    await sessionSocket.triggerDisconnect('transport close');
    await userSocket.triggerDisconnect('transport close');

    expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.machineUpdateMany).not.toHaveBeenCalled();
    expect(mocks.sendSilentReconnectPush).not.toHaveBeenCalled();
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      '[disconnect] server draining, skipping disconnect side-effects',
      expect.objectContaining({
        connectionType: 'session-scoped',
        sessionId: 'session-1',
        reason: 'transport close',
      })
    );
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      '[disconnect] server draining, skipping disconnect side-effects',
      expect.objectContaining({
        connectionType: 'user-scoped',
        reason: 'transport close',
      })
    );
  });
});
