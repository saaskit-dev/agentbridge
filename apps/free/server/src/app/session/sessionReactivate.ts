import {
  buildSessionActivityEphemeral,
  buildUpdateSessionUpdate,
  eventRouter,
} from '@/app/events/eventRouter';
import { activityCache } from '@/app/presence/sessionCache';
import { Context } from '@/context';
import { db } from '@/storage/db';
import { allocateUserSeq } from '@/storage/seq';
import { randomKeyNaked } from '@/utils/randomKeyNaked';

export async function sessionReactivate(
  ctx: Context,
  opts: {
    sessionId: string;
    metadata?: string;
    machineId?: string;
  }
) {
  const session = await db.session.findFirst({
    where: {
      id: opts.sessionId,
      accountId: ctx.uid,
      status: { not: 'deleted' },
    },
  });
  if (!session) {
    return null;
  }

  if (session.status === 'active') {
    return session;
  }

  const now = new Date();
  const nextMetadataVersion =
    opts.metadata !== undefined ? session.metadataVersion + 1 : session.metadataVersion;
  const nextAgentStateVersion = session.agentStateVersion + 1;

  const activeSession = await db.session.update({
    where: { id: session.id },
    data: {
      status: 'active',
      lastActiveAt: now,
      ...(session.status === 'archived' ? { archivedAt: null } : {}),
      ...(opts.metadata !== undefined
        ? {
            metadata: opts.metadata,
            metadataVersion: nextMetadataVersion,
          }
        : {}),
      ...(opts.machineId ? { machineId: opts.machineId } : {}),
      // Reset pending requests from the previous daemon instance or archived snapshot.
      agentState: null,
      agentStateVersion: nextAgentStateVersion,
    },
  });

  activityCache.evictSession(session.id);

  eventRouter.emitEphemeral({
    userId: ctx.uid,
    payload: buildSessionActivityEphemeral(session.id, true, now.getTime(), false),
    recipientFilter: { type: 'user-scoped-only' },
  });
  const updateSeq = await allocateUserSeq(ctx.uid);
  const updatePayload = buildUpdateSessionUpdate(
    session.id,
    updateSeq,
    randomKeyNaked(12),
    opts.metadata !== undefined ? { value: opts.metadata, version: nextMetadataVersion } : undefined,
    { value: null, version: nextAgentStateVersion },
    undefined,
    undefined,
    'active',
    now.getTime()
  );
  eventRouter.emitUpdate({
    userId: ctx.uid,
    payload: updatePayload,
    recipientFilter: { type: 'all-interested-in-session', sessionId: session.id },
  });

  return activeSession;
}
