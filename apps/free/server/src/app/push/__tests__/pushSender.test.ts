import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reconnectTokenFindUnique: vi.fn(),
  reconnectTokenUpsert: vi.fn(),
  reconnectTokenDelete: vi.fn(),
  accountPushTokenFindMany: vi.fn(),
  getConnections: vi.fn(),
  randomKeyNaked: vi.fn(() => 'reconnect-token'),
  expoCtor: vi.fn(),
  chunkPushNotifications: vi.fn(),
  sendPushNotificationsAsync: vi.fn(),
  isExpoPushToken: vi.fn(),
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  expoExportShape: 'named' as 'named' | 'default' | 'unsupported',
}));

vi.mock('@/storage/db', () => ({
  db: {
    reconnectToken: {
      findUnique: mocks.reconnectTokenFindUnique,
      upsert: mocks.reconnectTokenUpsert,
      delete: mocks.reconnectTokenDelete,
    },
    accountPushToken: {
      findMany: mocks.accountPushTokenFindMany,
    },
  },
}));

vi.mock('@/app/events/eventRouter', () => ({
  eventRouter: {
    getConnections: mocks.getConnections,
  },
}));

vi.mock('@/utils/randomKeyNaked', () => ({
  randomKeyNaked: mocks.randomKeyNaked,
}));

vi.mock('@saaskit-dev/agentbridge/telemetry', () => ({
  Logger: class {
    debug(...args: unknown[]) {
      mocks.loggerDebug(...args);
    }
    info(...args: unknown[]) {
      mocks.loggerInfo(...args);
    }
    warn(...args: unknown[]) {
      mocks.loggerWarn(...args);
    }
    error(...args: unknown[]) {
      mocks.loggerError(...args);
    }
  },
}));

async function loadModule() {
  vi.doMock('expo-server-sdk', () => {
    const ExpoMock = function ExpoMock(this: unknown) {
      mocks.expoCtor();
      return {
        chunkPushNotifications: mocks.chunkPushNotifications,
        sendPushNotificationsAsync: mocks.sendPushNotificationsAsync,
      };
    } as unknown as { new (): unknown; isExpoPushToken(token: string): boolean };

    ExpoMock.isExpoPushToken = mocks.isExpoPushToken;

    if (mocks.expoExportShape === 'default') {
      return { Expo: undefined, default: ExpoMock };
    }

    if (mocks.expoExportShape === 'unsupported') {
      return { Expo: undefined, default: undefined, notExpo: {} };
    }

    return { Expo: ExpoMock, default: undefined };
  });

  return await import('../pushSender');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.expoExportShape = 'named';
  mocks.reconnectTokenFindUnique.mockResolvedValue(null);
  mocks.reconnectTokenUpsert.mockResolvedValue(undefined);
  mocks.reconnectTokenDelete.mockResolvedValue(undefined);
  mocks.accountPushTokenFindMany.mockResolvedValue([{ token: 'ExpoPushToken[valid]' }]);
  mocks.getConnections.mockReturnValue(null);
  mocks.chunkPushNotifications.mockImplementation(messages => [messages]);
  mocks.sendPushNotificationsAsync.mockResolvedValue([{ status: 'ok' }]);
  mocks.isExpoPushToken.mockImplementation(token => token.startsWith('ExpoPushToken['));
});

describe('sendSilentReconnectPush', () => {
  it('sends reconnect push with named Expo export', async () => {
    const { sendSilentReconnectPush } = await loadModule();

    await expect(sendSilentReconnectPush('user-1')).resolves.toBeUndefined();

    expect(mocks.expoCtor).toHaveBeenCalledTimes(1);
    expect(mocks.reconnectTokenUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.sendPushNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('supports default-only Expo export shape', async () => {
    mocks.expoExportShape = 'default';
    const { sendSilentReconnectPush } = await loadModule();

    await expect(sendSilentReconnectPush('user-1')).resolves.toBeUndefined();

    expect(mocks.expoCtor).toHaveBeenCalledTimes(1);
    expect(mocks.sendPushNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('logs and returns when Expo export shape is unsupported', async () => {
    mocks.expoExportShape = 'unsupported';
    const { sendSilentReconnectPush } = await loadModule();

    await expect(sendSilentReconnectPush('user-1')).resolves.toBeUndefined();

    expect(mocks.sendPushNotificationsAsync).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      '[push] expo-server-sdk export shape is unsupported',
      expect.objectContaining({ exportKeys: expect.arrayContaining(['notExpo']) })
    );
  });

  it('swallows unexpected Expo constructor errors', async () => {
    mocks.expoCtor.mockImplementationOnce(() => {
      throw new Error('ctor boom');
    });
    const { sendSilentReconnectPush } = await loadModule();

    await expect(sendSilentReconnectPush('user-1')).resolves.toBeUndefined();

    expect(mocks.loggerError).toHaveBeenCalledWith(
      '[push] unexpected error during silent reconnect push',
      expect.objectContaining({ userId: 'user-1', error: 'Error: ctor boom' })
    );
  });
});
