import { Socket } from 'socket.io';
import { ClientConnection } from '@/app/events/eventRouter';
import { db } from '@/storage/db';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const log = new Logger('app/api/socket/replayHandler');

const REPLAY_LIMIT = 100;

/**
 * RFC-010 §3.3: Replay missed messages after reconnection.
 *
 * session-scoped connections send `lastSeq` (single session).
 * user-scoped connections send `lastSeqs` (map of sessionId -> lastSeq).
 */
export async function replayMissedMessages(userId: string, socket: Socket, connection: ClientConnection) {
  if (connection.connectionType === 'session-scoped') {
    const lastSeq = socket.handshake.auth.lastSeq as number | undefined;
    if (lastSeq == null || typeof lastSeq !== 'number' || lastSeq < 0) return;
    const sid = connection.sessionId;
    await replayForSession(userId, socket, sid, lastSeq);
  } else if (connection.connectionType === 'user-scoped') {
    const lastSeqs = socket.handshake.auth.lastSeqs as Record<string, number> | undefined;
    if (!lastSeqs || typeof lastSeqs !== 'object') return;
    for (const [sid, lastSeq] of Object.entries(lastSeqs)) {
      if (typeof lastSeq !== 'number' || lastSeq < 0) continue;
      await replayForSession(userId, socket, sid, lastSeq);
    }
  }
  // machine-scoped connections don't receive session messages — no replay needed
}

async function replayForSession(
  userId: string,
  socket: Socket,
  sessionId: string,
  lastSeq: number
) {
  // Verify session ownership
  const session = await db.session.findFirst({
    where: { id: sessionId, accountId: userId },
    select: { id: true },
  });
  if (!session) return;

  const messages = await db.sessionMessage.findMany({
    where: { sessionId, seq: { gt: lastSeq } },
    orderBy: { seq: 'asc' },
    take: REPLAY_LIMIT + 1,
    select: { id: true, seq: true, content: true, traceId: true, createdAt: true, updatedAt: true },
  });

  if (messages.length === 0) return;

  const hasMore = messages.length > REPLAY_LIMIT;
  const page = hasMore ? messages.slice(0, REPLAY_LIMIT) : messages;

  socket.emit('replay', {
    sessionId,
    messages: page.map(m => ({
      id: m.id,
      seq: m.seq,
      content: m.content,
      ...(m.traceId ? { traceId: m.traceId } : {}),
      createdAt: m.createdAt.getTime(),
      updatedAt: m.updatedAt.getTime(),
    })),
    hasMore,
  });
  log.info('[replay] sent missed messages', {
    userId,
    sessionId,
    lastSeq,
    count: page.length,
    hasMore,
  });
}
