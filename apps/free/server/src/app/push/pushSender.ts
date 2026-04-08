import * as ExpoServerSdk from 'expo-server-sdk';
import type { ExpoPushMessage } from 'expo-server-sdk';
import { db } from '@/storage/db';
import { eventRouter } from '@/app/events/eventRouter';
import { randomKeyNaked } from '@/utils/randomKeyNaked';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const log = new Logger('app/push/pushSender');

const COOLDOWN_MS = 60_000;

type ExpoClient = {
  chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][];
  sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<
    Array<{ status: string; message?: string; details?: unknown }>
  >;
};

type ExpoCtor = {
  new (): ExpoClient;
  isExpoPushToken(token: string): boolean;
};

let _expo: ExpoClient | null = null;

function getExpoCtor(): ExpoCtor | null {
  const candidate = (ExpoServerSdk as { Expo?: unknown; default?: unknown }).Expo ??
    (ExpoServerSdk as { Expo?: unknown; default?: unknown }).default;
  if (typeof candidate !== 'function') {
    log.error('[push] expo-server-sdk export shape is unsupported', {
      exportKeys: Object.keys(ExpoServerSdk),
    });
    return null;
  }
  return candidate as ExpoCtor;
}

function getExpo(): { expo: ExpoClient; ExpoClass: ExpoCtor } | null {
  const ExpoClass = getExpoCtor();
  if (!ExpoClass) {
    return null;
  }

  if (!_expo) {
    _expo = new ExpoClass();
  }

  return { expo: _expo, ExpoClass };
}

export async function sendSilentReconnectPush(userId: string): Promise<void> {
  try {
    const existing = await db.reconnectToken.findUnique({ where: { userId } });
    if (existing && existing.expiresAt > new Date()) {
      log.debug('[push] user in cooldown, skipping', { userId });
      return;
    }

    const connections = eventRouter.getConnections(userId);
    if (connections) {
      const userScopedCount = [...connections].filter(
        c => c.connectionType === 'user-scoped'
      ).length;
      if (userScopedCount > 0) {
        log.debug('[push] other user-scoped connections still active, skipping push', {
          userId,
          userScopedCount,
        });
        return;
      }
    }

    let tokens: string[];
    try {
      const rows = await db.accountPushToken.findMany({
        where: { accountId: userId },
        select: { token: true },
      });
      tokens = rows.map(r => r.token);
    } catch (error) {
      log.error('[push] failed to fetch push tokens', { userId, error: String(error) });
      return;
    }

    if (tokens.length === 0) {
      log.debug('[push] no push tokens for user, skipping', { userId });
      return;
    }

    const expoState = getExpo();
    if (!expoState) {
      log.error('[push] reconnect push aborted because Expo client is unavailable', {
        userId,
        tokenCount: tokens.length,
      });
      return;
    }
    const { expo, ExpoClass } = expoState;
    const reconnectToken = randomKeyNaked(32);
    const expiresAt = new Date(Date.now() + COOLDOWN_MS);

    await db.reconnectToken.upsert({
      where: { userId },
      create: { userId, token: reconnectToken, expiresAt },
      update: { token: reconnectToken, expiresAt },
    });

    const messages: ExpoPushMessage[] = tokens
      .filter(token => ExpoClass.isExpoPushToken(token))
      .map(token => ({
        to: token,
        title: undefined,
        body: undefined,
        sound: null,
        _contentAvailable: true,
        data: { type: 'ws-reconnect', reconnectToken },
        priority: 'high' as const,
      }));

    if (messages.length === 0) {
      log.debug('[push] no valid Expo push tokens for user', { userId });
      await db.reconnectToken.delete({ where: { userId } }).catch(() => undefined);
      return;
    }

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          if (ticket.status === 'error') {
            log.warn('[push] push send error', {
              userId,
              message: ticket.message,
              details: ticket.details ? String(ticket.details) : undefined,
            });
          }
        }
      } catch (error) {
        log.error('[push] failed to send chunk', { userId, error: String(error) });
      }
    }

    log.debug('[push] silent reconnect push sent', {
      userId,
      tokenCount: messages.length,
      reconnectToken,
    });
  } catch (error) {
    log.error('[push] unexpected error during silent reconnect push', {
      userId,
      error: String(error),
    });
  }
}

export async function ackReconnectToken(userId: string, token: string): Promise<boolean> {
  const entry = await db.reconnectToken.findUnique({ where: { userId } });
  if (!entry) {
    log.debug('[push] ack: no entry found', { userId });
    return false;
  }
  if (entry.expiresAt <= new Date()) {
    await db.reconnectToken.delete({ where: { userId } }).catch(() => undefined);
    log.debug('[push] ack: entry expired', { userId });
    return false;
  }
  if (entry.token !== token) {
    log.warn('[push] ack: token mismatch', { userId });
    return false;
  }
  await db.reconnectToken.delete({ where: { userId } }).catch(() => undefined);
  log.debug('[push] ack: token valid, entry cleared', { userId });
  return true;
}
