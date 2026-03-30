import {
  buildSessionActivityEphemeral,
  buildUpdateSessionUpdate,
  eventRouter,
} from '@/app/events/eventRouter';
import { activityBroadcaster } from '@/app/api/socket/activityBroadcaster';
import { activityCache } from '@/app/presence/sessionCache';
import { Context } from '@/context';
import { db } from '@/storage/db';
import { allocateUserSeq } from '@/storage/seq';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { randomKeyNaked } from '@/utils/randomKeyNaked';

const log = new Logger('app/session/sessionArchive');

/**
 * Archive a session by setting status='archived' and recording archivedAt.
 * Used for HTTP-based archiving (e.g. recovery_failed sessions where daemon is unavailable).
 * Does not send session-end RPC — this path is taken when the daemon cannot be reached.
 */
export async function sessionArchive(ctx: Context, sessionId: string): Promise<boolean> {
  const now = new Date();

  const result = await db.session.updateMany({
    where: {
      id: sessionId,
      accountId: ctx.uid,
      status: { notIn: ['archived', 'deleted'] },
    },
    data: { status: 'archived', archivedAt: now },
  });

  if (result.count === 0) {
    log.info('Session not found or already archived/deleted', { userId: ctx.uid, sessionId });
    return false;
  }

  activityCache.evictSession(sessionId);
  activityBroadcaster.remove(ctx.uid, sessionId);

  eventRouter.emitEphemeral({
    userId: ctx.uid,
    payload: buildSessionActivityEphemeral(sessionId, false, now.getTime(), false),
    recipientFilter: { type: 'user-scoped-only' },
  });

  const updateSeq = await allocateUserSeq(ctx.uid);
  const updatePayload = buildUpdateSessionUpdate(
    sessionId,
    updateSeq,
    randomKeyNaked(12),
    undefined,
    undefined,
    undefined,
    undefined,
    'archived',
    now.getTime()
  );
  eventRouter.emitUpdate({
    userId: ctx.uid,
    payload: updatePayload,
    recipientFilter: { type: 'all-interested-in-session', sessionId },
  });

  log.info('Session archived via HTTP', { userId: ctx.uid, sessionId });
  return true;
}
