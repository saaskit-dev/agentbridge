import { eventRouter, buildDeleteSessionUpdate } from '@/app/events/eventRouter';
import { Context } from '@/context';
import { inTx, afterTx } from '@/storage/inTx';
import { allocateUserSeq } from '@/storage/seq';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { randomKeyNaked } from '@/utils/randomKeyNaked';

const log = new Logger('app/session/sessionDelete');
/**
 * Delete a session and all its related data.
 * Handles:
 * - Deleting all session messages
 * - Deleting all usage reports for the session
 * - Deleting all access keys for the session
 * - Deleting the session itself
 * - Sending socket notification to all connected clients
 *
 * @param ctx - Context with user information
 * @param sessionId - ID of the session to delete
 * @returns true if deletion was successful, false if session not found or not owned by user
 */
export async function sessionDelete(ctx: Context, sessionId: string): Promise<boolean> {
  return await inTx(async tx => {
    // Verify session exists and belongs to the user
    const session = await tx.session.findFirst({
      where: {
        id: sessionId,
        accountId: ctx.uid,
      },
    });

    if (!session) {
      log.info('Session not found or not owned by user', { userId: ctx.uid, sessionId });
      return false;
    }

    // Delete all related data
    // Note: Order matters to avoid foreign key constraint violations

    // 1. Delete session messages
    const deletedMessages = await tx.sessionMessage.deleteMany({
      where: { sessionId },
    });
    log.info(`Deleted ${deletedMessages.count} session messages`, { userId: ctx.uid, sessionId, deletedCount: deletedMessages.count });

    // 2. Delete usage reports
    const deletedReports = await tx.usageReport.deleteMany({
      where: { sessionId },
    });
    log.info(`Deleted ${deletedReports.count} usage reports`, { userId: ctx.uid, sessionId, deletedCount: deletedReports.count });

    // 3. Delete access keys
    const deletedAccessKeys = await tx.accessKey.deleteMany({
      where: { sessionId },
    });
    log.info(`Deleted ${deletedAccessKeys.count} access keys`, { userId: ctx.uid, sessionId, deletedCount: deletedAccessKeys.count });

    // 4. Delete the session itself
    await tx.session.delete({
      where: { id: sessionId },
    });
    log.info('Session deleted successfully', { userId: ctx.uid, sessionId });

    // Send notification after transaction commits
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

    return true;
  });
}
