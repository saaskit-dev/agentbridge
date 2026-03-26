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
import { activityBroadcaster } from '@/app/api/socket/activityBroadcaster';
import { db } from '@/storage/db';
import { allocateSessionSeq, allocateSessionSeqBatch, allocateUserSeq } from '@/storage/seq';
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
        log.debug('[update-metadata] session not found', { userId, sessionId: sid });
        if (callback) {
          callback({ result: 'error' });
        }
        return;
      }

      // Check version
      if (session.metadataVersion !== expectedVersion) {
        log.debug('[update-metadata] version mismatch', {
          userId,
          sessionId: sid,
          expected: expectedVersion,
          actual: session.metadataVersion,
        });
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
      log.debug('[update-metadata] success', {
        userId,
        sessionId: sid,
        version: expectedVersion + 1,
      });
    } catch (error) {
      log.error('Error in update-metadata', undefined, {
        userId,
        sessionId: data?.sid,
        error: safeStringify(error),
      });
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
        log.debug('[update-state] session not found', { userId, sessionId: sid });
        callback({ result: 'error' });
        return null;
      }

      // Check version
      if (session.agentStateVersion !== expectedVersion) {
        log.debug('[update-state] version mismatch', {
          userId,
          sessionId: sid,
          expected: expectedVersion,
          actual: session.agentStateVersion,
        });
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
      log.debug('[update-state] success', { userId, sessionId: sid, version: expectedVersion + 1 });
    } catch (error) {
      log.error('Error in update-state', undefined, {
        userId,
        sessionId: data?.sid,
        error: safeStringify(error),
      });
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
        log.debug('[update-capabilities] session not found', { userId, sessionId: sid });
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
      log.debug('[update-capabilities] success', {
        userId,
        sessionId: sid,
        version: expectedVersion + 1,
      });
    } catch (error) {
      log.error('Error in update-capabilities', undefined, {
        userId,
        sessionId: data?.sid,
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
      log.debug('[session-alive] received', {
        userId,
        sessionId: data.sid,
        thinking: data.thinking ?? false,
      });

      let t = data.time;
      if (t > Date.now()) {
        t = Date.now();
      }
      if (t < Date.now() - 1000 * 60 * 3) {
        return;
      }

      const { sid, thinking } = data;

      // Check session validity using cache
      const validity = await activityCache.isSessionValid(sid, userId);
      if (validity === 'archived' || validity === 'deleted') {
        // Session was intentionally ended — tell the daemon to shut down
        log.info('[session-alive] session archived/deleted in DB, notifying daemon', {
          userId,
          sessionId: sid,
        });
        activityBroadcaster.remove(userId, sid);
        socket.emit('session-archived', { sid });
        return;
      }
      if (validity === 'invalid') {
        activityBroadcaster.remove(userId, sid);
        return;
      }
      if (validity === 'offline') {
        // Daemon reconnected while session was offline — re-activate
        // DB is updated directly here; skip queueSessionUpdate (no cache entry after evict)
        await db.session.updateMany({
          where: { id: sid, accountId: userId, status: 'offline' },
          data: { status: 'active', lastActiveAt: new Date(t) },
        });
        activityCache.evictSession(sid);
        log.info('[session-alive] re-activated offline session', { userId, sessionId: sid });
      } else {
        // Queue database update (will only update if time difference is significant)
        activityCache.queueSessionUpdate(sid, t);
      }

      // Queue activity for batched broadcast (flushes every 3s; thinking changes emit immediately)
      activityBroadcaster.queue(userId, sid, true, t, thinking || false);
      log.debug('[session-alive] activity queued', {
        userId,
        sessionId: sid,
        thinking: thinking || false,
      });
    } catch (error) {
      log.error('Error in session-alive', undefined, {
        userId,
        sessionId: data?.sid,
        error: safeStringify(error),
      });
    }
  });

  /** Per-message content character limit. Default: 10M chars. */
  const MESSAGE_CONTENT_MAX_CHARS = parseInt(
    process.env.MESSAGE_CONTENT_MAX_CHARS ?? '10000000',
    10
  );

  const sendMessagesLock = new AsyncLock();
  socket.on('send-messages', async (data: any, callback: (response: any) => void) => {
    await sendMessagesLock.inLock(async () => {
      const requestStart = Date.now();
      try {
        websocketEventsCounter.inc({ event_type: 'send-messages' });
        const { sessionId: sid, messages } = data ?? {};

        // Validate input
        if (!sid || typeof sid !== 'string') {
          callback({ ok: false, error: 'Missing sessionId' });
          return;
        }
        if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) {
          callback({ ok: false, error: 'messages must be an array of 1-100 items' });
          return;
        }

        // Validate each message
        for (const msg of messages) {
          if (typeof msg.id !== 'string' || !msg.id) {
            callback({ ok: false, error: 'Each message must have a string id' });
            return;
          }
          if (typeof msg.content !== 'string' || msg.content.length > MESSAGE_CONTENT_MAX_CHARS) {
            callback({ ok: false, error: `Message content too large or invalid (id: ${msg.id})` });
            return;
          }
        }

        log.debug('[send-messages] received', {
          sid,
          userId,
          messageCount: messages.length,
          ids: messages.map((m: any) => m.id),
        });

        // Resolve session
        const session = await db.session.findFirst({
          where: { id: sid, accountId: userId },
          select: { id: true },
        });
        if (!session) {
          log.debug('[send-messages] session not found', { sessionId: sid, userId });
          callback({ ok: false, error: 'Session not found' });
          return;
        }

        // Deduplicate within the batch by id
        const firstMessageById = new Map<string, { id: string; content: string; _trace?: any }>();
        for (const message of messages) {
          if (!firstMessageById.has(message.id)) {
            firstMessageById.set(message.id, message);
          }
        }

        const uniqueMessages = Array.from(firstMessageById.values());
        const contentById = new Map(uniqueMessages.map(m => [m.id, m.content]));
        const traceById = new Map<string, WireTrace>(
          uniqueMessages
            .filter(
              m => m._trace && typeof m._trace === 'object' && typeof m._trace.tid === 'string'
            )
            .map(m => [m.id, m._trace as WireTrace])
        );

        const txResult = await db.$transaction(async tx => {
          const ids = uniqueMessages.map(m => m.id);
          const existing = await tx.sessionMessage.findMany({
            where: { sessionId: sid, id: { in: ids } },
            select: { id: true, seq: true, traceId: true, createdAt: true, updatedAt: true },
          });

          const existingIds = new Set(existing.map(m => m.id));
          const newMessages = uniqueMessages.filter(m => !existingIds.has(m.id));
          const seqs = await allocateSessionSeqBatch(sid, newMessages.length, tx);

          const createdMessages: Array<{
            id: string;
            seq: number;
            traceId: string | null;
            createdAt: Date;
            updatedAt: Date;
          }> = [];
          for (let i = 0; i < newMessages.length; i++) {
            const message = newMessages[i];
            const trace = traceById.get(message.id);
            const created = await tx.sessionMessage.create({
              data: {
                id: message.id,
                sessionId: sid,
                seq: seqs[i],
                content: { t: 'encrypted', c: message.content },
                traceId: trace?.tid ?? null,
              },
              select: {
                id: true,
                seq: true,
                content: true,
                traceId: true,
                createdAt: true,
                updatedAt: true,
              },
            });
            createdMessages.push(created);
          }

          return {
            responseMessages: [...existing, ...createdMessages].sort((a, b) => a.seq - b.seq),
            createdMessages,
          };
        });

        log.debug('[send-messages] stored', {
          sid,
          userId,
          newCount: txResult.createdMessages.length,
          seqs: txResult.createdMessages.map(m => m.seq),
          elapsed: Date.now() - requestStart,
        });

        // Broadcast new messages to other connected clients (skip sender to prevent self-echo)
        for (const message of txResult.createdMessages) {
          const content = contentById.get(message.id);
          if (!content) continue;
          const updSeq = await allocateUserSeq(userId);
          const trace = traceById.get(message.id);
          const updatePayload = buildNewMessageUpdate(
            { ...message, content: { t: 'encrypted', c: content } },
            sid,
            updSeq,
            randomKeyNaked(12),
            trace
          );
          eventRouter.emitUpdate({
            userId,
            payload: updatePayload,
            recipientFilter: { type: 'all-interested-in-session', sessionId: sid },
            skipSenderConnection: connection,
          });
        }

        callback({
          ok: true,
          messages: txResult.responseMessages.map(m => ({
            id: m.id,
            seq: m.seq,
            ...(m.traceId ? { traceId: m.traceId } : {}),
            createdAt: m.createdAt.getTime(),
            updatedAt: m.updatedAt.getTime(),
          })),
        });

        log.info('[send-messages] complete', {
          sid,
          userId,
          requestedCount: messages.length,
          createdCount: txResult.createdMessages.length,
          elapsed: Date.now() - requestStart,
        });

        activityBroadcaster.recordContent(sid);
      } catch (error) {
        log.error('Error in send-messages', undefined, {
          userId,
          sessionId: data?.sessionId,
          error: safeStringify(error),
        });
        if (callback) callback({ ok: false, error: 'Internal error' });
      }
    });
  });

  socket.on('fetch-messages', async (data: any, callback: (response: any) => void) => {
    try {
      websocketEventsCounter.inc({ event_type: 'fetch-messages' });
      const { sessionId: sid, after_seq, before_seq, limit: rawLimit } = data ?? {};

      if (!sid || typeof sid !== 'string') {
        callback({ ok: false, error: 'Missing sessionId' });
        return;
      }
      const limit =
        typeof rawLimit === 'number' && rawLimit >= 1 && rawLimit <= 1000
          ? Math.floor(rawLimit)
          : 1000;

      const session = await db.session.findFirst({
        where: { id: sid, accountId: userId },
        select: { id: true },
      });
      if (!session) {
        callback({ ok: false, error: 'Session not found' });
        return;
      }

      // Reverse pagination: fetch older messages (seq < before_seq, DESC then reversed to ASC)
      if (typeof before_seq === 'number' && before_seq > 0) {
        const beforeSeq = Math.floor(before_seq);
        const messages = await db.sessionMessage.findMany({
          where: { sessionId: sid, seq: { lt: beforeSeq } },
          orderBy: { seq: 'desc' },
          take: limit + 1,
          select: {
            id: true,
            seq: true,
            content: true,
            traceId: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        const hasOlderMessages = messages.length > limit;
        const page = hasOlderMessages ? messages.slice(0, limit) : messages;
        page.reverse(); // Back to ASC order

        log.debug('[fetch-messages] older', {
          sessionId: sid,
          userId,
          beforeSeq,
          count: page.length,
          hasOlderMessages,
        });

        callback({
          ok: true,
          messages: page.map(m => ({
            id: m.id,
            seq: m.seq,
            content: m.content,
            ...(m.traceId ? { traceId: m.traceId } : {}),
            createdAt: m.createdAt.getTime(),
            updatedAt: m.updatedAt.getTime(),
          })),
          hasMore: false,
          hasOlderMessages,
        });
        return;
      }

      // Forward pagination: fetch newer messages (seq > after_seq, ASC)
      const afterSeq = typeof after_seq === 'number' && after_seq >= 0 ? Math.floor(after_seq) : 0;

      const messages = await db.sessionMessage.findMany({
        where: { sessionId: sid, seq: { gt: afterSeq } },
        orderBy: { seq: 'asc' },
        take: limit + 1,
        select: {
          id: true,
          seq: true,
          content: true,
          traceId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const hasMore = messages.length > limit;
      const page = hasMore ? messages.slice(0, limit) : messages;

      log.debug('[fetch-messages]', {
        sessionId: sid,
        userId,
        afterSeq,
        count: page.length,
        hasMore,
      });

      callback({
        ok: true,
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
    } catch (error) {
      log.error('Error in fetch-messages', undefined, {
        userId,
        sessionId: data?.sessionId,
        error: safeStringify(error),
      });
      if (callback) callback({ ok: false, error: 'Internal error' });
    }
  });

  socket.on('session-end', async (data: { sid: string; time: number }) => {
    try {
      const { sid, time } = data;
      log.info('[session-end] received', { userId, sessionId: sid });
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
        log.debug('[session-end] session not found', { userId, sessionId: sid });
        return;
      }

      // Mark session archived
      await db.session.updateMany({
        where: { id: sid, accountId: userId },
        data: { lastActiveAt: new Date(t), status: 'archived' },
      });

      // Evict from activity cache so subsequent session-alive checks see the archived state
      activityCache.evictSession(sid);
      // Remove from batched broadcaster to avoid stale active=true emission
      activityBroadcaster.remove(userId, sid);

      // Emit session activity update
      const sessionActivity = buildSessionActivityEphemeral(sid, false, t, false);
      eventRouter.emitEphemeral({
        userId,
        payload: sessionActivity,
        recipientFilter: { type: 'user-scoped-only' },
      });
      log.info('[session-end] session archived', { userId, sessionId: sid });
    } catch (error) {
      log.error('Error in session-end', undefined, {
        userId,
        sessionId: data?.sid,
        error: safeStringify(error),
      });
    }
  });
}
