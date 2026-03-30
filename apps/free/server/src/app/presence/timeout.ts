import {
  buildMachineActivityEphemeral,
  buildSessionActivityEphemeral,
  eventRouter,
} from '@/app/events/eventRouter';
import { sessionDeleteById } from '@/app/session/sessionDelete';
import { db } from '@/storage/db';
import { delay } from '@/utils/delay';
import { forever } from '@/utils/forever';
import { shutdownSignal } from '@/utils/shutdown';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('server/presence/timeout');

const AUTO_DELETE_DAYS = parseInt(process.env.SESSION_AUTO_DELETE_DAYS ?? '30', 10);

export function startTimeout() {
  // Auto-delete archived sessions older than SESSION_AUTO_DELETE_DAYS days (default: 30)
  forever('session-auto-delete', async () => {
    while (!shutdownSignal.aborted) {
      const cutoff = new Date(Date.now() - AUTO_DELETE_DAYS * 24 * 60 * 60 * 1000);
      // Use archivedAt if set, fall back to lastActiveAt for sessions archived before this field existed
      const sessions = await db.session.findMany({
        where: {
          status: 'archived',
          OR: [
            { archivedAt: { lte: cutoff } },
            { archivedAt: null, lastActiveAt: { lte: cutoff } },
          ],
        },
        select: { id: true, accountId: true },
        take: 50,
      });

      if (sessions.length > 0) {
        logger.info('auto-deleting expired archived sessions', {
          count: sessions.length,
          autoDeleteDays: AUTO_DELETE_DAYS,
        });
      }

      for (const session of sessions) {
        if (shutdownSignal.aborted) break;
        try {
          await sessionDeleteById(session.id, session.accountId);
        } catch (error) {
          logger.error('failed to auto-delete session', undefined, {
            sessionId: session.id,
            accountId: session.accountId,
            error: String(error),
          });
        }
      }

      // If we hit the batch limit there may be more to process — loop immediately
      // instead of waiting an hour, so backlogs can be cleared without delay.
      if (sessions.length === 50 && !shutdownSignal.aborted) {
        continue;
      }

      // Batch was smaller than the limit — nothing left, wait an hour before re-checking
      await delay(1000 * 60 * 60, shutdownSignal);
    }
  });

  forever('session-timeout', async () => {
    while (!shutdownSignal.aborted) {
      // Find timed out sessions
      const sessions = await db.session.findMany({
        where: {
          status: 'active',
          lastActiveAt: {
            lte: new Date(Date.now() - 1000 * 60 * 3), // 3 minutes
          },
        },
      });
      if (sessions.length > 0) {
        logger.info('timed out sessions found', { count: sessions.length });
      }
      for (const session of sessions) {
        const updated = await db.session.updateManyAndReturn({
          where: { id: session.id, status: 'active' },
          data: { status: 'offline' },
        });
        if (updated.length === 0) {
          continue;
        }
        logger.debug('session marked offline', {
          sessionId: session.id,
          accountId: session.accountId,
        });
        eventRouter.emitEphemeral({
          userId: session.accountId,
          payload: buildSessionActivityEphemeral(
            session.id,
            false,
            updated[0].lastActiveAt.getTime(),
            false
          ),
          recipientFilter: { type: 'user-scoped-only' },
        });
      }

      // Find timed out machines
      const machines = await db.machine.findMany({
        where: {
          active: true,
          lastActiveAt: {
            lte: new Date(Date.now() - 1000 * 60 * 3), // 3 minutes
          },
        },
      });
      if (machines.length > 0) {
        logger.info('timed out machines found', { count: machines.length });
      }
      for (const machine of machines) {
        const updated = await db.machine.updateManyAndReturn({
          where: { id: machine.id, active: true },
          data: { active: false },
        });
        if (updated.length === 0) {
          continue;
        }
        logger.debug('machine marked inactive', {
          machineId: machine.id,
          accountId: machine.accountId,
        });
        eventRouter.emitEphemeral({
          userId: machine.accountId,
          payload: buildMachineActivityEphemeral(
            machine.id,
            false,
            updated[0].lastActiveAt.getTime()
          ),
          recipientFilter: { type: 'user-scoped-only' },
        });
      }

      // Wait for 1 minute
      await delay(1000 * 60, shutdownSignal);
    }
  });
}
