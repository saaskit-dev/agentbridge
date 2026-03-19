import { eventRouter, buildDeleteSessionUpdate } from '@/app/events/eventRouter';
import { Context } from '@/context';
import { inTx, afterTx } from '@/storage/inTx';
import { allocateUserSeq } from '@/storage/seq';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { randomKeyNaked } from '@/utils/randomKeyNaked';

const log = new Logger('app/session/sessionDelete');
/**
 * Soft-delete a session by setting status='deleted' and releasing the tag.
 * The session record and all related data are retained for audit purposes.
 * Deleted sessions are hidden from all API list endpoints.
 * Sends a delete notification to all connected clients after the transaction commits.
 *
 * @param ctx - Context with user information
 * @param sessionId - ID of the session to delete
 * @returns true if deletion was successful, false if session not found or not owned by user
 */
export async function sessionDelete(ctx: Context, sessionId: string): Promise<boolean> {
  let found = false;

  await inTx(async tx => {
    const session = await tx.session.findFirst({
      where: { id: sessionId, accountId: ctx.uid },
    });

    if (!session) {
      log.info('Session not found or not owned by user', { userId: ctx.uid, sessionId });
      return;
    }

    // Soft-delete: set status='deleted'
    await tx.session.update({
      where: { id: sessionId },
      data: { status: 'deleted' },
    });
    found = true;
    log.info('Session soft-deleted', { userId: ctx.uid, sessionId });

    // Emit notification after transaction commits — guarantees client sees the delete
    afterTx(tx, async () => {
      const updSeq = await allocateUserSeq(ctx.uid);
      const updatePayload = buildDeleteSessionUpdate(sessionId, updSeq, randomKeyNaked(12));
      log.info('Emitting delete-session update to user-scoped connections', { userId: ctx.uid, sessionId });
      eventRouter.emitUpdate({
        userId: ctx.uid,
        payload: updatePayload,
        recipientFilter: { type: 'user-scoped-only' },
      });
    });
  });

  return found;
}
