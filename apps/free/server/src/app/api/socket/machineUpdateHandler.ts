import { Socket } from 'socket.io';
import {
  buildMachineActivityEphemeral,
  buildUpdateMachineUpdate,
  buildUpdateSessionUpdate,
  buildSessionActivityEphemeral,
  eventRouter,
} from '@/app/events/eventRouter';
import { machineAliveEventsCounter, websocketEventsCounter } from '@/app/monitoring/metrics2';
import { activityCache } from '@/app/presence/sessionCache';
import { db } from '@/storage/db';
import { allocateUserSeq } from '@/storage/seq';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { randomKeyNaked } from '@/utils/randomKeyNaked';
import { activityBroadcaster } from '@/app/api/socket/activityBroadcaster';
import { shouldDrainWebSocketsGracefully } from '@/utils/shutdown';

const log = new Logger('app/api/socket/machineUpdateHandler');

function rejectWhileDraining(
  callback: ((response: any) => void) | undefined,
  payload: Record<string, unknown>
): boolean {
  if (!shouldDrainWebSocketsGracefully()) {
    return false;
  }
  callback?.(payload);
  return true;
}

export function machineUpdateHandler(userId: string, socket: Socket) {
  socket.on('machine-alive', async (data: { machineId: string; time: number }) => {
    try {
      // Track metrics
      websocketEventsCounter.inc({ event_type: 'machine-alive' });
      machineAliveEventsCounter.inc();

      // Basic validation
      if (!data || typeof data.time !== 'number' || !data.machineId) {
        return;
      }

      let t = data.time;
      if (t > Date.now()) {
        t = Date.now();
      }
      if (t < Date.now() - 1000 * 60 * 3) {
        return;
      }

      // Check machine validity using cache
      const isValid = await activityCache.isMachineValid(data.machineId, userId);
      if (!isValid) {
        return;
      }

      // Queue database update (will only update if time difference is significant)
      activityCache.queueMachineUpdate(data.machineId, t);

      const machineActivity = buildMachineActivityEphemeral(data.machineId, true, t);
      eventRouter.emitEphemeral({
        userId,
        payload: machineActivity,
        recipientFilter: { type: 'user-scoped-only' },
      });
    } catch (error) {
      log.error('Error in machine-alive', undefined, {
        userId,
        machineId: data?.machineId,
        error: safeStringify(error),
      });
    }
  });

  // Machine metadata update with optimistic concurrency control
  socket.on('machine-update-metadata', async (data: any, callback: (response: any) => void) => {
    try {
      const { machineId, metadata, expectedVersion } = data;

      if (rejectWhileDraining(callback, { result: 'error', message: 'Server draining' })) {
        return;
      }

      // Validate input
      if (!machineId || typeof metadata !== 'string' || typeof expectedVersion !== 'number') {
        if (callback) {
          callback({ result: 'error', message: 'Invalid parameters' });
        }
        return;
      }

      // Resolve machine
      const machine = await db.machine.findFirst({
        where: {
          accountId: userId,
          id: machineId,
        },
      });
      if (!machine) {
        if (callback) {
          callback({ result: 'error', message: 'Machine not found' });
        }
        return;
      }

      // Check version
      if (machine.metadataVersion !== expectedVersion) {
        callback({
          result: 'version-mismatch',
          version: machine.metadataVersion,
          metadata: machine.metadata,
        });
        return;
      }

      // Update metadata with atomic version check
      const { count } = await db.machine.updateMany({
        where: {
          accountId: userId,
          id: machineId,
          metadataVersion: expectedVersion, // Atomic CAS
        },
        data: {
          metadata: metadata,
          metadataVersion: expectedVersion + 1,
          // NOT updating active or lastActiveAt here
        },
      });

      if (count === 0) {
        // Re-fetch current version
        const current = await db.machine.findFirst({
          where: {
            accountId: userId,
            id: machineId,
          },
        });
        callback({
          result: 'version-mismatch',
          version: current?.metadataVersion || 0,
          metadata: current?.metadata,
        });
        return;
      }

      // Generate machine metadata update
      const updSeq = await allocateUserSeq(userId);
      const metadataUpdate = {
        value: metadata,
        version: expectedVersion + 1,
      };
      const updatePayload = buildUpdateMachineUpdate(
        machineId,
        updSeq,
        randomKeyNaked(12),
        metadataUpdate
      );
      eventRouter.emitUpdate({
        userId,
        payload: updatePayload,
        recipientFilter: { type: 'machine-scoped-only', machineId },
      });

      // Send success response with new version
      callback({
        result: 'success',
        version: expectedVersion + 1,
        metadata: metadata,
      });
    } catch (error) {
      log.error('Error in machine-update-metadata', undefined, {
        userId,
        machineId: data?.machineId,
        error: safeStringify(error),
      });
      if (callback) {
        callback({ result: 'error', message: 'Internal error' });
      }
    }
  });

  /**
   * Daemon sends this after its recovery scan completes.
   * Server archives any session for this machine that is still 'offline' but was NOT recovered —
   * these are orphaned sessions (no persistence file remained after crash) that would otherwise
   * stay offline forever.
   */
  socket.on(
    'machine-recovery-done',
    async (data: { machineId: string; recoveredSessionIds: string[] }) => {
      try {
        const { machineId: mid, recoveredSessionIds } = data;
        if (!mid || !Array.isArray(recoveredSessionIds)) return;

        // Find offline sessions for this machine not in the recovered set
        const orphaned = await db.session.findMany({
          where: {
            accountId: userId,
            machineId: mid,
            status: 'offline',
            id: { notIn: recoveredSessionIds },
          },
          select: { id: true },
        });

        if (orphaned.length === 0) return;

        const now = Date.now();
        log.info('[machine-recovery-done] archiving orphaned sessions', {
          userId,
          machineId: mid,
          orphanedCount: orphaned.length,
          orphanedIds: orphaned.map(s => s.id),
        });

        const archivedAt = new Date(now);
        await db.session.updateMany({
          where: {
            accountId: userId,
            id: { in: orphaned.map(s => s.id) },
            status: 'offline', // guard: only touch offline sessions
          },
          data: { status: 'archived', archivedAt, lastActiveAt: archivedAt },
        });

        // Broadcast status updates so App reflects archived state immediately
        for (const { id: sid } of orphaned) {
          activityBroadcaster.remove(userId, sid);
          const activityUpdate = buildSessionActivityEphemeral(sid, false, now, false);
          eventRouter.emitEphemeral({
            userId,
            payload: activityUpdate,
            recipientFilter: { type: 'user-scoped-only' },
          });
          const updateSeq = await allocateUserSeq(userId);
          const updatePayload = buildUpdateSessionUpdate(
            sid,
            updateSeq,
            randomKeyNaked(12),
            undefined,
            undefined,
            undefined,
            undefined,
            'archived',
            now
          );
          eventRouter.emitUpdate({
            userId,
            payload: updatePayload,
            recipientFilter: { type: 'all-interested-in-session', sessionId: sid },
          });
        }
      } catch (error) {
        log.error('Error in machine-recovery-done', undefined, {
          userId,
          error: safeStringify(error),
        });
      }
    }
  );

  // Machine daemon state update with optimistic concurrency control
  socket.on('machine-update-state', async (data: any, callback: (response: any) => void) => {
    try {
      const { machineId, daemonState, expectedVersion } = data;

      if (rejectWhileDraining(callback, { result: 'error', message: 'Server draining' })) {
        return;
      }

      // Validate input
      if (!machineId || typeof daemonState !== 'string' || typeof expectedVersion !== 'number') {
        if (callback) {
          callback({ result: 'error', message: 'Invalid parameters' });
        }
        return;
      }

      // Resolve machine
      const machine = await db.machine.findFirst({
        where: {
          accountId: userId,
          id: machineId,
        },
      });
      if (!machine) {
        if (callback) {
          callback({ result: 'error', message: 'Machine not found' });
        }
        return;
      }

      // Check version
      if (machine.daemonStateVersion !== expectedVersion) {
        callback({
          result: 'version-mismatch',
          version: machine.daemonStateVersion,
          daemonState: machine.daemonState,
        });
        return;
      }

      // Update daemon state with atomic version check
      const { count } = await db.machine.updateMany({
        where: {
          accountId: userId,
          id: machineId,
          daemonStateVersion: expectedVersion, // Atomic CAS
        },
        data: {
          daemonState: daemonState,
          daemonStateVersion: expectedVersion + 1,
          active: true,
          lastActiveAt: new Date(),
        },
      });

      if (count === 0) {
        // Re-fetch current version
        const current = await db.machine.findFirst({
          where: {
            accountId: userId,
            id: machineId,
          },
        });
        callback({
          result: 'version-mismatch',
          version: current?.daemonStateVersion || 0,
          daemonState: current?.daemonState,
        });
        return;
      }

      // Generate machine daemon state update
      const updSeq = await allocateUserSeq(userId);
      const daemonStateUpdate = {
        value: daemonState,
        version: expectedVersion + 1,
      };
      const updatePayload = buildUpdateMachineUpdate(
        machineId,
        updSeq,
        randomKeyNaked(12),
        undefined,
        daemonStateUpdate
      );
      eventRouter.emitUpdate({
        userId,
        payload: updatePayload,
        recipientFilter: { type: 'machine-scoped-only', machineId },
      });

      // Send success response with new version
      callback({
        result: 'success',
        version: expectedVersion + 1,
        daemonState: daemonState,
      });
    } catch (error) {
      log.error('Error in machine-update-state', undefined, {
        userId,
        machineId: data?.machineId,
        error: safeStringify(error),
      });
      if (callback) {
        callback({ result: 'error', message: 'Internal error' });
      }
    }
  });
}
