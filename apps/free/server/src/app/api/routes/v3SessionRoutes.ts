import { z } from 'zod';
import { type Fastify } from '../types';
import { buildNewMessageUpdate, eventRouter } from '@/app/events/eventRouter';
import { db } from '@/storage/db';
import { allocateSessionSeqBatch, allocateUserSeq } from '@/storage/seq';
import { randomKeyNaked } from '@/utils/randomKeyNaked';
import { Logger, type WireTrace } from '@saaskit-dev/agentbridge/telemetry';

const log = new Logger('app/api/routes/v3Sessions');

const getMessagesQuerySchema = z.object({
  after_seq: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// The server forwards _trace to CLI subscribers; the CLI owns the authoritative
// schema. @see apps/free/cli/src/api/types.ts WireTraceSchema for the full definition.
// We only verify the required fields (tid/sid) are strings to prevent bad payloads.
const WireTracePassthroughSchema = z
  .record(z.unknown())
  .refine(
    v => typeof v['tid'] === 'string' && typeof v['sid'] === 'string',
    { message: '_trace must have string tid and sid' }
  );

/** Per-message content character limit. Zod .max() counts characters, not bytes. Override via MESSAGE_CONTENT_MAX_CHARS env var. Default: 10M chars. */
const MESSAGE_CONTENT_MAX_CHARS = parseInt(process.env.MESSAGE_CONTENT_MAX_CHARS ?? '10000000', 10);

const sendMessagesBodySchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().min(1),
        content: z.string().max(MESSAGE_CONTENT_MAX_CHARS),
        _trace: WireTracePassthroughSchema.optional(),
      })
    )
    .min(1)
    .max(100),
});

type SelectedMessage = {
  id: string;
  seq: number;
  content: unknown;
  traceId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toResponseMessage(message: SelectedMessage) {
  return {
    id: message.id,
    seq: message.seq,
    content: message.content,
    ...(message.traceId ? { traceId: message.traceId } : {}),
    createdAt: message.createdAt.getTime(),
    updatedAt: message.updatedAt.getTime(),
  };
}

function toSendResponseMessage(message: Omit<SelectedMessage, 'content'>) {
  return {
    id: message.id,
    seq: message.seq,
    ...(message.traceId ? { traceId: message.traceId } : {}),
    createdAt: message.createdAt.getTime(),
    updatedAt: message.updatedAt.getTime(),
  };
}

export function v3SessionRoutes(app: Fastify) {
  app.get(
    '/v3/sessions/:sessionId/messages',
    {
      preHandler: app.authenticate,
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
        querystring: getMessagesQuerySchema,
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const { sessionId } = request.params;
      const { after_seq, limit } = request.query;

      const session = await db.session.findFirst({
        where: {
          id: sessionId,
          accountId: userId,
        },
        select: { id: true },
      });

      if (!session) {
        log.debug('[v3] messages: session not found', { sessionId, userId });
        return reply.code(404).send({ error: 'Session not found' });
      }

      const messages = await db.sessionMessage.findMany({
        where: {
          sessionId,
          seq: { gt: after_seq },
        },
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

      log.debug('[v3] messages fetched', { sessionId, userId, after_seq, count: page.length, hasMore });

      return reply.send({
        messages: page.map(toResponseMessage),
        hasMore,
      });
    }
  );

  app.post(
    '/v3/sessions/:sessionId/messages',
    {
      preHandler: app.authenticate,
      schema: {
        params: z.object({
          sessionId: z.string(),
        }),
        body: sendMessagesBodySchema,
      },
    },
    async (request, reply) => {
      const requestStart = Date.now();
      const userId = request.userId;
      const { sessionId } = request.params;
      const { messages } = request.body;

      log.debug('[v3] received messages', {
        sessionId,
        userId,
        messageCount: messages.length,
        ids: messages.map(m => m.id),
        traceIds: messages.map(m => (m._trace as { tid?: string } | undefined)?.tid).filter(Boolean),
      });

      const session = await db.session.findFirst({
        where: {
          id: sessionId,
          accountId: userId,
        },
        select: { id: true },
      });

      if (!session) {
        log.debug('[v3] send: session not found', { sessionId, userId });
        return reply.code(404).send({ error: 'Session not found' });
      }

      // Deduplicate within the batch by id
      const firstMessageById = new Map<
        string,
        { id: string; content: string; _trace?: Record<string, unknown> }
      >();
      for (const message of messages) {
        if (!firstMessageById.has(message.id)) {
          firstMessageById.set(message.id, message);
        }
      }

      const uniqueMessages = Array.from(firstMessageById.values());
      const contentById = new Map(
        uniqueMessages.map(message => [message.id, message.content])
      );
      const traceById = new Map<string, WireTrace>(
        uniqueMessages
          .filter(m => m._trace)
          .map(m => [m.id, m._trace as unknown as WireTrace])
      );

      const txResult = await db.$transaction(async tx => {
        const ids = uniqueMessages.map(message => message.id);
        const existing = await tx.sessionMessage.findMany({
          where: {
            sessionId,
            id: { in: ids },
          },
          select: {
            id: true,
            seq: true,
            traceId: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        const existingIds = new Set(existing.map(m => m.id));

        const newMessages = uniqueMessages.filter(
          message => !existingIds.has(message.id)
        );
        const seqs = await allocateSessionSeqBatch(sessionId, newMessages.length, tx);

        const createdMessages: Omit<SelectedMessage, 'content'>[] = [];
        for (let i = 0; i < newMessages.length; i += 1) {
          const message = newMessages[i];
          const trace = traceById.get(message.id);
          const createdMessage = await tx.sessionMessage.create({
            data: {
              id: message.id,
              sessionId,
              seq: seqs[i],
              content: {
                t: 'encrypted',
                c: message.content,
              },
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
          createdMessages.push(createdMessage);
        }

        const responseMessages = [...existing, ...createdMessages].sort((a, b) => a.seq - b.seq);

        return {
          responseMessages,
          createdMessages,
        };
      });

      log.debug('[v3] stored messages', {
        sessionId,
        userId,
        newCount: txResult.createdMessages.length,
        ids: txResult.createdMessages.map(m => m.id),
        seqs: txResult.createdMessages.map(m => m.seq),
        traceIds: txResult.createdMessages.map(m => m.traceId).filter(Boolean),
        elapsed: Date.now() - requestStart,
      });

      // Skip broadcasting back to the sender's socket connection to prevent self-echo.
      // The CLI sends its socket ID via X-Socket-Id header so we can look up the connection.
      const senderSocketId = request.headers['x-socket-id'] as string | undefined;
      const skipConnection = senderSocketId
        ? eventRouter.findConnectionBySocketId(userId, senderSocketId)
        : undefined;

      for (const message of txResult.createdMessages) {
        const content = contentById.get(message.id);
        if (!content) {
          continue;
        }
        const updSeq = await allocateUserSeq(userId);
        const trace = traceById.get(message.id);
        const updatePayload = buildNewMessageUpdate(
          {
            ...message,
            content: {
              t: 'encrypted',
              c: content,
            },
          },
          sessionId,
          updSeq,
          randomKeyNaked(12),
          trace
        );

        eventRouter.emitUpdate({
          userId,
          payload: updatePayload,
          recipientFilter: { type: 'all-interested-in-session', sessionId },
          skipSenderConnection: skipConnection,
        });
        log.debug('[v3] published event', {
          sessionId,
          userId,
          messageId: message.id,
          seq: message.seq,
          traceId: trace?.tid,
          elapsed: Date.now() - requestStart,
        });
      }

      log.info('[v3] send messages complete', {
        sessionId,
        userId,
        requestedCount: messages.length,
        createdCount: txResult.createdMessages.length,
        elapsed: Date.now() - requestStart,
      });

      return reply.send({
        messages: txResult.responseMessages.map(toSendResponseMessage),
      });
    }
  );
}
