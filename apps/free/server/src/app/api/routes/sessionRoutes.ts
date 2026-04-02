import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { type Fastify } from '../types';
import { eventRouter, buildNewSessionUpdate } from '@/app/events/eventRouter';
import { sessionDelete } from '@/app/session/sessionDelete';
import { sessionArchive } from '@/app/session/sessionArchive';
import { activityCache } from '@/app/presence/sessionCache';
import { db } from '@/storage/db';
import { allocateUserSeq } from '@/storage/seq';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { randomKeyNaked } from '@/utils/randomKeyNaked';

const log = new Logger('app/api/routes/sessionRoutes');
export function sessionRoutes(app: Fastify) {
  // Sessions API
  app.get(
    '/v1/sessions',
    {
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;

      const sessions = await db.session.findMany({
        where: { accountId: userId, status: { not: 'deleted' } },
        orderBy: { updatedAt: 'desc' },
        take: 150,
        select: {
          id: true,
          seq: true,
          createdAt: true,
          updatedAt: true,
          metadata: true,
          metadataVersion: true,
          agentState: true,
          agentStateVersion: true,
          capabilities: true,
          capabilitiesVersion: true,
          dataEncryptionKey: true,
          status: true,
          lastActiveAt: true,
        },
      });

      log.debug('[sessions] list', { userId, count: sessions.length });

      return reply.send({
        sessions: sessions.map(v => ({
          id: v.id,
          seq: v.seq,
          createdAt: v.createdAt.getTime(),
          updatedAt: v.updatedAt.getTime(),
          status: v.status,
          activeAt: v.lastActiveAt.getTime(),
          metadata: v.metadata,
          metadataVersion: v.metadataVersion,
          agentState: v.agentState,
          agentStateVersion: v.agentStateVersion,
          capabilities: v.capabilities,
          capabilitiesVersion: v.capabilitiesVersion,
          dataEncryptionKey: v.dataEncryptionKey, // Already base64 string
          lastMessage: null,
        })),
      });
    }
  );

  // V2 Sessions API - Active sessions only
  app.get(
    '/v2/sessions/active',
    {
      preHandler: app.authenticate,
      schema: {
        querystring: z
          .object({
            limit: z.coerce.number().int().min(1).max(500).default(150),
          })
          .optional(),
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const limit = request.query?.limit || 150;

      const sessions = await db.session.findMany({
        where: {
          accountId: userId,
          status: 'active',
          lastActiveAt: { gt: new Date(Date.now() - 1000 * 60 * 15) /* 15 minutes */ },
        },
        orderBy: { lastActiveAt: 'desc' },
        take: limit,
        select: {
          id: true,
          seq: true,
          createdAt: true,
          updatedAt: true,
          metadata: true,
          metadataVersion: true,
          agentState: true,
          agentStateVersion: true,
          capabilities: true,
          capabilitiesVersion: true,
          dataEncryptionKey: true,
          status: true,
          lastActiveAt: true,
        },
      });

      log.debug('[sessions] listActive', { userId, count: sessions.length });

      return reply.send({
        sessions: sessions.map(v => ({
          id: v.id,
          seq: v.seq,
          createdAt: v.createdAt.getTime(),
          updatedAt: v.updatedAt.getTime(),
          status: v.status,
          activeAt: v.lastActiveAt.getTime(),
          metadata: v.metadata,
          metadataVersion: v.metadataVersion,
          agentState: v.agentState,
          agentStateVersion: v.agentStateVersion,
          capabilities: v.capabilities,
          capabilitiesVersion: v.capabilitiesVersion,
          dataEncryptionKey: v.dataEncryptionKey, // Already base64 string
        })),
      });
    }
  );

  // V2 Sessions API - Cursor-based pagination with change tracking
  app.get(
    '/v2/sessions',
    {
      preHandler: app.authenticate,
      schema: {
        querystring: z
          .object({
            cursor: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            changedSince: z.coerce.number().int().positive().optional(),
          })
          .optional(),
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { cursor, limit = 50, changedSince } = request.query || {};

      // Decode cursor - simple ID-based cursor
      let cursorSessionId: string | undefined;
      if (cursor) {
        if (cursor.startsWith('cursor_v1_')) {
          cursorSessionId = cursor.substring(10);
        } else {
          return reply.code(400).send({ error: 'Invalid cursor format' });
        }
      }

      // Build where clause (always exclude soft-deleted sessions)
      const where: Prisma.SessionWhereInput = { accountId: userId, status: { not: 'deleted' } };

      // Add changedSince filter (just a filter, doesn't affect pagination)
      if (changedSince) {
        where.updatedAt = {
          gt: new Date(changedSince),
        };
      }

      // Add cursor pagination - always by ID descending (most recent first)
      if (cursorSessionId) {
        where.id = {
          lt: cursorSessionId, // Get sessions with ID less than cursor (for desc order)
        };
      }

      // Always sort by ID descending for consistent pagination
      const orderBy = { id: 'desc' as const };

      const sessions = await db.session.findMany({
        where,
        orderBy,
        take: limit + 1, // Fetch one extra to determine if there are more
        select: {
          id: true,
          seq: true,
          createdAt: true,
          updatedAt: true,
          metadata: true,
          metadataVersion: true,
          agentState: true,
          agentStateVersion: true,
          capabilities: true,
          capabilitiesVersion: true,
          dataEncryptionKey: true,
          status: true,
          lastActiveAt: true,
        },
      });

      // Check if there are more results
      const hasNext = sessions.length > limit;
      const resultSessions = hasNext ? sessions.slice(0, limit) : sessions;

      log.debug('[sessions] listPaginated', { userId, count: resultSessions.length, hasNext });

      // Generate next cursor - simple ID-based cursor
      let nextCursor: string | null = null;
      if (hasNext && resultSessions.length > 0) {
        const lastSession = resultSessions[resultSessions.length - 1];
        nextCursor = `cursor_v1_${lastSession.id}`;
      }

      return reply.send({
        sessions: resultSessions.map(v => ({
          id: v.id,
          seq: v.seq,
          createdAt: v.createdAt.getTime(),
          updatedAt: v.updatedAt.getTime(),
          status: v.status,
          activeAt: v.lastActiveAt.getTime(),
          metadata: v.metadata,
          metadataVersion: v.metadataVersion,
          agentState: v.agentState,
          agentStateVersion: v.agentStateVersion,
          capabilities: v.capabilities,
          capabilitiesVersion: v.capabilitiesVersion,
          dataEncryptionKey: v.dataEncryptionKey, // Already base64 string
        })),
        nextCursor,
        hasNext,
      });
    }
  );

  // Get or create session by client-generated ID.
  // The daemon generates a UUID and uses it as both the lookup key and the primary key.
  app.post(
    '/v1/sessions',
    {
      schema: {
        body: z.object({
          id: z.string(),
          metadata: z.string(),
          agentState: z.string().nullish(),
          dataEncryptionKey: z.string().nullish(),
          machineId: z.string().nullish(),
        }),
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const { id, metadata, dataEncryptionKey, machineId } = request.body;
      const traceId = request.headers['x-trace-id'] as string | undefined;

      // Look up existing active/offline session by client-provided ID
      const session = await db.session.findUnique({ where: { id } });
      if (
        session &&
        session.accountId === userId &&
        (session.status === 'active' || session.status === 'offline')
      ) {
        log.info(`Resuming existing session: ${session.id}`, {
          sessionId: session.id,
          userId,
          traceId,
        });

        // Re-activate offline sessions on daemon restart/crash recovery.
        let activeSession = session;
        if (session.status === 'offline') {
          log.info(`Re-activating offline session on daemon recovery: ${session.id}`, {
            sessionId: session.id,
            userId,
            traceId,
          });
          activeSession = await db.session.update({
            where: { id: session.id },
            data: {
              status: 'active',
              lastActiveAt: new Date(),
              // Track which machine is now owning this session (may differ from original creator
              // if the user moved to a different machine, or after daemon crash recovery).
              ...(machineId ? { machineId } : {}),
              // Clear agentState to remove stale pending requests from previous daemon instance.
              // The new daemon will rebuild fresh state. This prevents UI showing old permission
              // requests that the new daemon's memory doesn't know about.
              agentState: null,
            },
          });
          activityCache.evictSession(session.id);
        }

        return reply.send({
          session: {
            id: activeSession.id,
            seq: activeSession.seq,
            metadata: activeSession.metadata,
            metadataVersion: activeSession.metadataVersion,
            agentState: activeSession.agentState,
            agentStateVersion: activeSession.agentStateVersion,
            capabilities: activeSession.capabilities,
            capabilitiesVersion: activeSession.capabilitiesVersion,
            dataEncryptionKey: activeSession.dataEncryptionKey,
            status: activeSession.status,
            activeAt: activeSession.lastActiveAt.getTime(),
            createdAt: activeSession.createdAt.getTime(),
            updatedAt: activeSession.updatedAt.getTime(),
            lastMessage: null,
          },
        });
      }

      // ID exists but belongs to another user, or is archived/deleted — tell client to retry
      if (session) {
        log.info(`Session ID conflict: ${id} exists but not resumable`, {
          userId,
          traceId,
          existingStatus: session.status,
        });
        reply.code(409);
        return { error: 'session_id_conflict' };
      }

      // Create new session with client-provided ID
      const updSeq = await allocateUserSeq(userId);
      log.info(`Creating new session ${id} for user ${userId}`, { userId, sessionId: id, traceId });
      let newSession;
      try {
        newSession = await db.session.create({
          data: {
            id,
            accountId: userId,
            metadata: metadata,
            dataEncryptionKey: dataEncryptionKey || undefined,
            machineId: machineId || undefined,
          },
        });
      } catch (err: unknown) {
        // P2002: concurrent race — another request created a session with this ID
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          log.info(`Concurrent create race on session ID ${id}`, { userId, traceId });
          reply.code(409);
          return { error: 'session_id_conflict' };
        }
        throw err;
      }
      log.info(`Session created: ${newSession.id}`, { sessionId: newSession.id, userId, traceId });

      // Emit new session update
      const updatePayload = buildNewSessionUpdate(newSession, updSeq, randomKeyNaked(12));
      eventRouter.emitUpdate({
        userId,
        payload: updatePayload,
        recipientFilter: { type: 'user-scoped-only' },
      });

      return reply.send({
        session: {
          id: newSession.id,
          seq: newSession.seq,
          metadata: newSession.metadata,
          metadataVersion: newSession.metadataVersion,
          agentState: newSession.agentState,
          agentStateVersion: newSession.agentStateVersion,
          capabilities: newSession.capabilities,
          capabilitiesVersion: newSession.capabilitiesVersion,
          dataEncryptionKey: newSession.dataEncryptionKey,
          status: newSession.status,
          activeAt: newSession.lastActiveAt.getTime(),
          createdAt: newSession.createdAt.getTime(),
          updatedAt: newSession.updatedAt.getTime(),
          lastMessage: null,
        },
      });
    }
  );

  /**
   * Single-session metadata (including dataEncryptionKey) for clients whose session is not in
   * the first page of GET /v1/sessions (take 150).
   */
  app.get(
    '/v1/sessions/:sessionId',
    {
      preHandler: app.authenticate,
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { sessionId } = request.params;

      const session = await db.session.findFirst({
        where: {
          id: sessionId,
          accountId: userId,
          status: { not: 'deleted' },
        },
        select: {
          id: true,
          seq: true,
          createdAt: true,
          updatedAt: true,
          metadata: true,
          metadataVersion: true,
          agentState: true,
          agentStateVersion: true,
          capabilities: true,
          capabilitiesVersion: true,
          dataEncryptionKey: true,
          status: true,
          lastActiveAt: true,
        },
      });

      if (!session) {
        log.debug('[sessions] get one: not found', { userId, sessionId });
        return reply.code(404).send({ error: 'Session not found' });
      }

      return reply.send({
        session: {
          id: session.id,
          seq: session.seq,
          createdAt: session.createdAt.getTime(),
          updatedAt: session.updatedAt.getTime(),
          status: session.status,
          activeAt: session.lastActiveAt.getTime(),
          metadata: session.metadata,
          metadataVersion: session.metadataVersion,
          agentState: session.agentState,
          agentStateVersion: session.agentStateVersion,
          capabilities: session.capabilities,
          capabilitiesVersion: session.capabilitiesVersion,
          dataEncryptionKey: session.dataEncryptionKey,
          lastMessage: null,
        },
      });
    }
  );

  app.get(
    '/v1/sessions/:sessionId/messages',
    {
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const { sessionId } = request.params;

      // Verify session belongs to user
      const session = await db.session.findFirst({
        where: {
          id: sessionId,
          accountId: userId,
        },
      });

      if (!session) {
        log.debug('[sessions] messages: session not found', { userId, sessionId });
        return reply.code(404).send({ error: 'Session not found' });
      }

      const messages = await db.sessionMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        take: 150,
        select: {
          id: true,
          seq: true,
          content: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      log.debug('[sessions] messages fetched', { userId, sessionId, count: messages.length });

      return reply.send({
        messages: messages.map(v => ({
          id: v.id,
          seq: v.seq,
          content: v.content,
          createdAt: v.createdAt.getTime(),
          updatedAt: v.updatedAt.getTime(),
        })),
      });
    }
  );

  // Archive session (HTTP path, used when daemon is unavailable e.g. recovery_failed)
  app.patch(
    '/v1/sessions/:sessionId/archive',
    {
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const { sessionId } = request.params;

      log.debug('[sessions] archive requested', { userId, sessionId });

      const archived = await sessionArchive({ uid: userId }, sessionId);

      if (!archived) {
        log.debug('[sessions] archive: not found or already archived', { userId, sessionId });
        return reply.code(404).send({ error: 'Session not found or already archived' });
      }

      return reply.send({ success: true });
    }
  );

  // Delete session (physical delete)
  app.delete(
    '/v1/sessions/:sessionId',
    {
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const { sessionId } = request.params;

      log.debug('[sessions] delete requested', { userId, sessionId });

      const deleted = await sessionDelete({ uid: userId }, sessionId);

      if (!deleted) {
        log.debug('[sessions] delete: not found', { userId, sessionId });
        return reply.code(404).send({ error: 'Session not found or not owned by user' });
      }

      return reply.send({ success: true });
    }
  );
}
