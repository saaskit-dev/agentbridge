import { Socket } from 'socket.io';
import {
  buildNewMessageUpdate,
  buildSessionActivityEphemeral,
  buildUpdateSessionUpdate,
  ClientConnection,
  eventRouter,
} from '@/app/events/eventRouter';
import { sessionAliveEventsCounter, websocketEventsCounter } from '@/app/monitoring/metrics2';
import { activityCache } from '@/app/presence/sessionCache';
import { db } from '@/storage/db';
import { allocateSessionSeq, allocateUserSeq } from '@/storage/seq';
import { AsyncLock } from '@/utils/lock';
import { safeStringify } from '@saaskit-dev/agentbridge';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import type { WireTrace } from '@saaskit-dev/agentbridge/telemetry';
import { randomKeyNaked } from '@/utils/randomKeyNaked';

function extractWireTrace(data: any): WireTrace | undefined {
  if (data && typeof data._trace === 'object' && typeof data._trace.tid === 'string') {
    return data._trace as WireTrace;
  }
  return undefined;
}

const log = new Logger('app/api/socket/sessionUpdateHandler');
export function sessionUpdateHandler(userId: string, socket: Socket, connection: ClientConnection) {
  socket.on('update-metadata', async (data: any, callback: (response: any) => void) => {
    try {
      const { sid, metadata, expectedVersion } = data;
      const trace = extractWireTrace(data);

      // Validate input
      if (!sid || typeof metadata !== 'string' || typeof expectedVersion !== 'number') {
        if (callback) {
          callback({ result: 'error' });
        }
        return;
      }

      // Resolve session
      const session = await db.session.findUnique({
        where: { id: sid, accountId: userId },
      });
      if (!session) {
        log.debug('[update-metadata] session not found', { userId, sid });
        if (callback) {
          callback({ result: 'error' });
        }
        return;
      }

      // Check version
      if (session.metadataVersion !== expectedVersion) {
        log.debug('[update-metadata] version mismatch', { userId, sid, expected: expectedVersion, actual: session.metadataVersion });
        callback({
          result: 'version-mismatch',
          version: session.metadataVersion,
          metadata: session.metadata,
        });
        return null;
      }

      // Update metadata (accountId in WHERE prevents cross-account writes)
      const { count } = await db.session.updateMany({
        where: { id: sid, accountId: userId, metadataVersion: expectedVersion },
        data: {
          metadata: metadata,
          metadataVersion: expectedVersion + 1,
        },
      });
      if (count === 0) {
        // Re-fetch latest to return accurate version after concurrent update
        const current = await db.session.findFirst({
          where: { id: sid, accountId: userId },
          select: { metadataVersion: true, metadata: true },
        });
        if (!current) {
          if (callback) callback({ result: 'error' });
          return;
        }
        callback({
          result: 'version-mismatch',
          version: current.metadataVersion,
          metadata: current.metadata,
        });
        return;
      }

      // Generate session metadata update
      const updSeq = await allocateUserSeq(userId);
      const metadataUpdate = {
        value: metadata,
        version: expectedVersion + 1,
      };
      const updatePayload = buildUpdateSessionUpdate(
        sid,
        updSeq,
        randomKeyNaked(12),
        metadataUpdate,
        undefined,
        trace
      );
      eventRouter.emitUpdate({
        userId,
        payload: updatePayload,
        recipientFilter: { type: 'all-interested-in-session', sessionId: sid },
      });

      // Send success response with new version via callback
      callback({ result: 'success', version: expectedVersion + 1, metadata: metadata });
      log.debug('[update-metadata] success', { userId, sid, version: expectedVersion + 1 });
    } catch (error) {
      log.error('Error in update-metadata', undefined, { userId, sid: data?.sid, error: safeStringify(error) });
      if (callback) {
        callback({ result: 'error' });
      }
    }
  });

  socket.on('update-state', async (data: any, callback: (response: any) => void) => {
    try {
      const { sid, agentState, expectedVersion } = data;
      const trace = extractWireTrace(data);

      // Validate input
      if (
        !sid ||
        (typeof agentState !== 'string' && agentState !== null) ||
        typeof expectedVersion !== 'number'
      ) {
        if (callback) {
          callback({ result: 'error' });
        }
        return;
      }

      // Resolve session
      const session = await db.session.findUnique({
        where: {
          id: sid,
          accountId: userId,
        },
      });
      if (!session) {
        log.debug('[update-state] session not found', { userId, sid });
        callback({ result: 'error' });
        return null;
      }

      // Check version
      if (session.agentStateVersion !== expectedVersion) {
        log.debug('[update-state] version mismatch', { userId, sid, expected: expectedVersion, actual: session.agentStateVersion });
        callback({
          result: 'version-mismatch',
          version: session.agentStateVersion,
          agentState: session.agentState,
        });
        return null;
      }

      // Update agent state (accountId in WHERE prevents cross-account writes)
      const { count } = await db.session.updateMany({
        where: { id: sid, accountId: userId, agentStateVersion: expectedVersion },
        data: {
          agentState: agentState,
          agentStateVersion: expectedVersion + 1,
        },
      });
      if (count === 0) {
        // Re-fetch latest to return accurate version after concurrent update
        const current = await db.session.findFirst({
          where: { id: sid, accountId: userId },
          select: { agentStateVersion: true, agentState: true },
        });
        if (!current) {
          if (callback) callback({ result: 'error' });
          return;
        }
        callback({
          result: 'version-mismatch',
          version: current.agentStateVersion,
          agentState: current.agentState,
        });
        return;
      }

      // Generate session agent state update
      const updSeq = await allocateUserSeq(userId);
      const agentStateUpdate = {
        value: agentState,
        version: expectedVersion + 1,
      };
      const updatePayload = buildUpdateSessionUpdate(
        sid,
        updSeq,
        randomKeyNaked(12),
        undefined,
        agentStateUpdate,
        trace
      );
      eventRouter.emitUpdate({
        userId,
        payload: updatePayload,
        recipientFilter: { type: 'all-interested-in-session', sessionId: sid },
      });

      // Send success response with new version via callback
      callback({ result: 'success', version: expectedVersion + 1, agentState: agentState });
      log.debug('[update-state] success', { userId, sid, version: expectedVersion + 1 });
    } catch (error) {
      log.error('Error in update-state', undefined, { userId, sid: data?.sid, error: safeStringify(error) });
      if (callback) {
        callback({ result: 'error' });
      }
    }
  });

  socket.on('update-capabilities', async (data: any, callback: (response: any) => void) => {
    try {
      const { sid, capabilities, expectedVersion } = data;
      const trace = extractWireTrace(data);

      if (
        !sid ||
        (typeof capabilities !== 'string' && capabilities !== null) ||
        typeof expectedVersion !== 'number'
      ) {
        callback({ result: 'error' });
        return;
      }

      const session = await db.session.findUnique({
        where: { id: sid, accountId: userId },
      });
      if (!session) {
        log.debug('[update-capabilities] session not found', { userId, sid });
        callback({ result: 'error' });
        return;
      }

      if (session.capabilitiesVersion !== expectedVersion) {
        log.debug('[update-capabilities] version mismatch', {
          userId,
          sid,
          expected: expectedVersion,
          actual: session.capabilitiesVersion,
        });
        callback({
          result: 'version-mismatch',
          version: session.capabilitiesVersion,
          capabilities: session.capabilities,
        });
        return;
      }

      const { count } = await db.session.updateMany({
        where: { id: sid, accountId: userId, capabilitiesVersion: expectedVersion },
        data: {
          capabilities,
          capabilitiesVersion: expectedVersion + 1,
        },
      });
      if (count === 0) {
        // Re-fetch latest to return accurate version after concurrent update
        const current = await db.session.findFirst({
          where: { id: sid, accountId: userId },
          select: { capabilitiesVersion: true, capabilities: true },
        });
        if (!current) {
          callback({ result: 'error' });
          return;
        }
        callback({
          result: 'version-mismatch',
          version: current.capabilitiesVersion,
          capabilities: current.capabilities,
        });
        return;
      }

      const updSeq = await allocateUserSeq(userId);
      const capabilitiesUpdate = {
        value: capabilities,
        version: expectedVersion + 1,
      };
      const updatePayload = buildUpdateSessionUpdate(
        sid,
        updSeq,
        randomKeyNaked(12),
        undefined,
        undefined,
        trace,
        capabilitiesUpdate
      );
      eventRouter.emitUpdate({
        userId,
        payload: updatePayload,
        recipientFilter: { type: 'all-interested-in-session', sessionId: sid },
      });

      callback({
        result: 'success',
        version: expectedVersion + 1,
        capabilities,
      });
      log.debug('[update-capabilities] success', { userId, sid, version: expectedVersion + 1 });
    } catch (error) {
      log.error('Error in update-capabilities', undefined, {
        userId,
        sid: data?.sid,
        error: safeStringify(error),
      });
      callback({ result: 'error' });
    }
  });
  socket.on('session-alive', async (data: { sid: string; time: number; thinking?: boolean }) => {
    try {
      // Track metrics
      websocketEventsCounter.inc({ event_type: 'session-alive' });
      sessionAliveEventsCounter.inc();

      // Basic validation
      if (!data || typeof data.time !== 'number' || !data.sid) {
        return;
      }
      log.debug('[session-alive] received', { userId, sid: data.sid, thinking: data.thinking ?? false });

      let t = data.time;
      if (t > Date.now()) {
        t = Date.now();
      }
      if (t < Date.now() - 1000 * 60 * 3) {
        return;
      }

      const { sid, thinking } = data;

      // Check session validity using cache (now returns 'valid' | 'archived' | 'invalid')
      const validity = await activityCache.isSessionValid(sid, userId);
      if (validity === 'archived') {
        // DB says session is archived — tell the daemon to shut down
        log.info('[session-alive] session archived in DB, notifying daemon', { userId, sid });
        socket.emit('session-archived', { sid });
        return;
      }
      if (validity !== 'valid') {
        return;
      }

      // Queue database update (will only update if time difference is significant)
      activityCache.queueSessionUpdate(sid, t);

      // Emit session activity update
      const sessionActivity = buildSessionActivityEphemeral(sid, true, t, thinking || false);
      eventRouter.emitEphemeral({
        userId,
        payload: sessionActivity,
        recipientFilter: { type: 'user-scoped-only' },
      });
      log.debug('[session-alive] activity ephemeral emitted', { userId, sid, thinking: thinking || false });
    } catch (error) {
      log.error('Error in session-alive', undefined, { userId, sid: data?.sid, error: safeStringify(error) });
    }
  });

  const receiveMessageLock = new AsyncLock();
  socket.on('message', async (data: any) => {
    await receiveMessageLock.inLock(async () => {
      try {
        websocketEventsCounter.inc({ event_type: 'message' });
        const { sid, message, id } = data;
        const trace = extractWireTrace(data);

        // Validate message size (1MB limit prevents OOM from malicious payloads)
        if (typeof message !== 'string' || message.length > 1_000_000) {
          log.warn('[message] invalid or oversized message rejected', { userId, sid, size: typeof message === 'string' ? message.length : 0 });
          return;
        }
        if (typeof id !== 'string' || !id) {
          log.warn('[message] missing message id', { userId, sid });
          return;
        }

        log.info('Received message', { userId, sid, messageLength: message.length, connectionType: connection.connectionType });

        // Resolve session
        const session = await db.session.findUnique({
          where: { id: sid, accountId: userId },
        });
        if (!session) {
          log.debug('[message] session not found', { userId, sid });
          return;
        }

        // Create encrypted message
        const msgContent: PrismaJson.SessionMessageContent = {
          t: 'encrypted',
          c: message,
        };

        // Resolve seq
        const updSeq = await allocateUserSeq(userId);
        const msgSeq = await allocateSessionSeq(sid);

        // Check if message already exists (dedup by client-provided id)
        const existing = await db.sessionMessage.findUnique({
          where: { id },
        });
        if (existing) {
          log.debug('[message] duplicate skipped', { userId, sid, id });
          return;
        }

        // Create message
        const msg = await db.sessionMessage.create({
          data: {
            id,
            sessionId: sid,
            seq: msgSeq,
            content: msgContent,
            traceId: trace?.tid ?? null,
          },
        });

        // Emit new message update to relevant clients (forward _trace for cross-layer correlation)
        const updatePayload = buildNewMessageUpdate(msg, sid, updSeq, randomKeyNaked(12), trace);
        eventRouter.emitUpdate({
          userId,
          payload: updatePayload,
          recipientFilter: { type: 'all-interested-in-session', sessionId: sid },
          skipSenderConnection: connection,
        });
      } catch (error) {
        log.error('Error in message handler', undefined, { userId, sid: data?.sid, error: safeStringify(error) });
      }
    });
  });

  socket.on('session-end', async (data: { sid: string; time: number }) => {
    try {
      const { sid, time } = data;
      log.info('[session-end] received', { userId, sid });
      let t = time;
      if (typeof t !== 'number') {
        return;
      }
      if (t > Date.now()) {
        t = Date.now();
      }
      if (t < Date.now() - 1000 * 60 * 3) {
        // Ignore if time is in the past 3 minutes
        return;
      }

      // Resolve session
      const session = await db.session.findUnique({
        where: { id: sid, accountId: userId },
      });
      if (!session) {
        log.debug('[session-end] session not found', { userId, sid });
        return;
      }

      // Update last active at (use updateMany with accountId to prevent cross-account writes)
      await db.session.updateMany({
        where: { id: sid, accountId: userId },
        data: { lastActiveAt: new Date(t), active: false },
      });

      // Evict from activity cache so subsequent session-alive checks see the archived state
      activityCache.evictSession(sid);

      // Emit session activity update
      const sessionActivity = buildSessionActivityEphemeral(sid, false, t, false);
      eventRouter.emitEphemeral({
        userId,
        payload: sessionActivity,
        recipientFilter: { type: 'user-scoped-only' },
      });
      log.info('[session-end] session archived (active=false)', { userId, sid });
    } catch (error) {
      log.error('Error in session-end', undefined, { userId, sid: data?.sid, error: safeStringify(error) });
    }
  });
}
