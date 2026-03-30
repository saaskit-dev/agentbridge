import { eventRouter, buildDeleteSessionUpdate } from '@/app/events/eventRouter';
import { Context } from '@/context';
import { db } from '@/storage/db';
import { allocateUserSeq } from '@/storage/seq';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { randomKeyNaked } from '@/utils/randomKeyNaked';

const log = new Logger('app/session/sessionDelete');

/**
 * Physically delete a session and all related data.
 * Deletes SessionMessage, UsageReport, AccessKey records, then the Session itself.
 * Sends a delete-session notification to all connected clients after deletion.
 *
 * @returns true if deleted, false if not found or not owned by user
 */
export async function sessionDelete(ctx: Context, sessionId: string): Promise<boolean> {
  const session = await db.session.findFirst({
    where: { id: sessionId, accountId: ctx.uid },
  });

  if (!session) {
    log.info('Session not found or not owned by user', { userId: ctx.uid, sessionId });
    return false;
  }

  // Delete all related records, then the session itself
  await db.$transaction([
    db.sessionMessage.deleteMany({ where: { sessionId } }),
    db.usageReport.deleteMany({ where: { sessionId } }),
    db.accessKey.deleteMany({ where: { sessionId } }),
    db.session.delete({ where: { id: sessionId } }),
  ]);

  log.info('Session hard-deleted', { userId: ctx.uid, sessionId });

  // Notify clients after deletion. Errors here do not affect the delete result —
  // the session is already gone — but we log them so stale UI can be diagnosed.
  try {
    const updSeq = await allocateUserSeq(ctx.uid);
    const updatePayload = buildDeleteSessionUpdate(sessionId, updSeq, randomKeyNaked(12));
    eventRouter.emitUpdate({
      userId: ctx.uid,
      payload: updatePayload,
      recipientFilter: { type: 'user-scoped-only' },
    });
  } catch (error) {
    log.error('Failed to notify clients after session delete', undefined, {
      userId: ctx.uid,
      sessionId,
      error: String(error),
    });
  }

  return true;
}

/**
 * Physically delete a session without user context (used by auto-delete job).
 * Skips ownership check — caller must ensure session belongs to correct account.
 */
export async function sessionDeleteById(sessionId: string, accountId: string): Promise<void> {
  await db.$transaction([
    db.sessionMessage.deleteMany({ where: { sessionId } }),
    db.usageReport.deleteMany({ where: { sessionId } }),
    db.accessKey.deleteMany({ where: { sessionId } }),
    db.session.delete({ where: { id: sessionId } }),
  ]);

  log.info('Session auto-deleted', { accountId, sessionId });

  try {
    const updSeq = await allocateUserSeq(accountId);
    const updatePayload = buildDeleteSessionUpdate(sessionId, updSeq, randomKeyNaked(12));
    eventRouter.emitUpdate({
      userId: accountId,
      payload: updatePayload,
      recipientFilter: { type: 'user-scoped-only' },
    });
  } catch (error) {
    log.error('Failed to notify clients after session auto-delete', undefined, {
      accountId,
      sessionId,
      error: String(error),
    });
  }
}
