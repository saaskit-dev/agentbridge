import Expo, { ExpoPushMessage } from 'expo-server-sdk';
import { db } from '@/storage/db';
import { eventRouter } from '@/app/events/eventRouter';
import { randomKeyNaked } from '@/utils/randomKeyNaked';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const log = new Logger('app/push/pushSender');

const COOLDOWN_MS = 60_000;

let _expo: Expo | null = null;
function getExpo(): Expo {
  if (!_expo) {
    _expo = new Expo();
  }
  return _expo;
}

export async function sendSilentReconnectPush(userId: string): Promise<void> {
  const existing = await db.reconnectToken.findUnique({ where: { userId } });
  if (existing && existing.expiresAt > new Date()) {
    log.debug('[push] user in cooldown, skipping', { userId });
    return;
  }

  const connections = eventRouter.getConnections(userId);
  if (connections) {
    const userScopedCount = [...connections].filter(c => c.connectionType === 'user-scoped').length;
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

  const expo = getExpo();
  const reconnectToken = randomKeyNaked(32);
  const expiresAt = new Date(Date.now() + COOLDOWN_MS);

  await db.reconnectToken.upsert({
    where: { userId },
    create: { userId, token: reconnectToken, expiresAt },
    update: { token: reconnectToken, expiresAt },
  });

  const messages: ExpoPushMessage[] = tokens
    .filter(token => Expo.isExpoPushToken(token))
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
