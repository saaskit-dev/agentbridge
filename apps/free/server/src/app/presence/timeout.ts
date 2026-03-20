import {
  buildMachineActivityEphemeral,
  buildSessionActivityEphemeral,
  eventRouter,
} from '@/app/events/eventRouter';
import { db } from '@/storage/db';
import { delay } from '@/utils/delay';
import { forever } from '@/utils/forever';
import { shutdownSignal } from '@/utils/shutdown';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('server/presence/timeout');

export function startTimeout() {
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
        logger.debug('session marked offline', { sessionId: session.id, accountId: session.accountId });
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
        logger.debug('machine marked inactive', { machineId: machine.id, accountId: machine.accountId });
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
