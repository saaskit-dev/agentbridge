import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { Fastify } from '../types';
import { eventRouter, buildUpdateAccountUpdate } from '@/app/events/eventRouter';
import { db } from '@/storage/db';
import { aggregateUsageReports, UNKNOWN_USAGE_FILTER_VALUE } from './usageAggregation';
import { getPublicUrl } from '@/storage/files';
import { allocateUserSeq } from '@/storage/seq';
import { AccountProfile } from '@/types';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { randomKeyNaked } from '@/utils/randomKeyNaked';
import { updateAnalyticsEnabledCache } from '../utils/analyticsSettingsCache';

const log = new Logger('app/api/routes/accountRoutes');
export function accountRoutes(app: Fastify) {
  app.get(
    '/v1/account/profile',
    {
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const user = await db.account.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          lastName: true,
          username: true,
          avatar: true,
          githubUser: true,
        },
      });

      // Account not found - return 401 to trigger client logout
      if (!user) {
        return reply.code(401).send({ error: 'Account not found', code: 'ACCOUNT_NOT_FOUND' });
      }

      const connectedVendors = new Set(
        (await db.serviceAccountToken.findMany({ where: { accountId: userId } })).map(t => t.vendor)
      );
      return reply.send({
        id: userId,
        timestamp: Date.now(),
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        avatar: user.avatar
          ? { ...(user.avatar as any), url: getPublicUrl((user.avatar as any).path) }
          : null,
        github: user.githubUser ? user.githubUser.profile : null,
        connectedServices: Array.from(connectedVendors),
      });
    }
  );

  // Get Account Settings API
  app.get(
    '/v1/account/settings',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: z.object({
            settings: z.string().nullable(),
            settingsVersion: z.number(),
          }),
          401: z.object({
            error: z.string(),
            code: z.string().optional(),
            success: z.boolean().optional(),
          }),
          500: z.object({
            error: z.literal('Failed to get account settings'),
          }),
        },
      },
    },
    async (request, reply) => {
      try {
        const user = await db.account.findUnique({
          where: { id: request.userId },
          select: { settings: true, settingsVersion: true },
        });

        if (!user) {
          return reply.code(401).send({ error: 'Account not found', code: 'ACCOUNT_NOT_FOUND' });
        }

        return reply.send({
          settings: user.settings,
          settingsVersion: user.settingsVersion,
        });
      } catch (error) {
        return reply.code(500).send({ error: 'Failed to get account settings' });
      }
    }
  );

  // Update Account Settings API
  app.post(
    '/v1/account/settings',
    {
      schema: {
        body: z.object({
          settings: z.string().nullable(),
          expectedVersion: z.number().int().min(0),
        }),
        response: {
          200: z.union([
            z.object({
              success: z.literal(true),
              version: z.number(),
            }),
            z.object({
              success: z.literal(false),
              error: z.literal('version-mismatch'),
              currentVersion: z.number(),
              currentSettings: z.string().nullable(),
            }),
          ]),
          401: z.object({
            error: z.string(),
            code: z.string().optional(),
            success: z.boolean().optional(),
          }),
          500: z.object({
            success: z.literal(false),
            error: z.literal('Failed to update account settings'),
          }),
        },
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const { settings, expectedVersion } = request.body;

      try {
        // Get current user data for version check
        const currentUser = await db.account.findUnique({
          where: { id: userId },
          select: { settings: true, settingsVersion: true },
        });

        if (!currentUser) {
          return reply.code(401).send({
            success: false,
            error: 'Account not found',
            code: 'ACCOUNT_NOT_FOUND',
          });
        }

        // Check current version
        if (currentUser.settingsVersion !== expectedVersion) {
          return reply.code(200).send({
            success: false,
            error: 'version-mismatch',
            currentVersion: currentUser.settingsVersion,
            currentSettings: currentUser.settings,
          });
        }

        // Update settings with version check
        const { count } = await db.account.updateMany({
          where: {
            id: userId,
            settingsVersion: expectedVersion,
          },
          data: {
            settings: settings,
            settingsVersion: expectedVersion + 1,
            updatedAt: new Date(),
          },
        });

        // Update analytics cache if settings contain analyticsEnabled
        if (count > 0 && settings) {
          try {
            const parsedSettings = JSON.parse(settings);
            if (typeof parsedSettings.analyticsEnabled === 'boolean') {
              updateAnalyticsEnabledCache(userId, parsedSettings.analyticsEnabled);
              log.debug(
                `Updated analytics cache for user ${userId}: ${parsedSettings.analyticsEnabled}`
              );
            }
          } catch {
            // Invalid JSON, ignore
          }
        }

        if (count === 0) {
          // Re-fetch to get current version
          const account = await db.account.findUnique({
            where: { id: userId },
          });
          return reply.code(200).send({
            success: false,
            error: 'version-mismatch',
            currentVersion: account?.settingsVersion || 0,
            currentSettings: account?.settings || null,
          });
        }

        // Generate update for connected clients
        const updSeq = await allocateUserSeq(userId);
        const settingsUpdate = {
          value: settings,
          version: expectedVersion + 1,
        };

        // Send account update to user-scoped connections only
        const updatePayload = buildUpdateAccountUpdate(
          userId,
          { settings: settingsUpdate },
          updSeq,
          randomKeyNaked(12)
        );
        eventRouter.emitUpdate({
          userId,
          payload: updatePayload,
          recipientFilter: { type: 'user-scoped-only' },
        });

        return reply.send({
          success: true,
          version: expectedVersion + 1,
        });
      } catch (error) {
        log.error(`Failed to update account settings: ${error}`);
        return reply.code(500).send({
          success: false,
          error: 'Failed to update account settings',
        });
      }
    }
  );

  app.post(
    '/v1/usage/query',
    {
      schema: {
        body: z.object({
          sessionId: z.string().nullish(),
          startTime: z.number().int().positive().nullish(),
          endTime: z.number().int().positive().nullish(),
          groupBy: z.enum(['hour', 'day']).nullish(),
          groupDimension: z.enum(['none', 'agent', 'model', 'startedBy']).nullish(),
          agent: z.string().min(1).nullish(),
          model: z.string().min(1).nullish(),
          startedBy: z.union([z.enum(['cli', 'daemon', 'app']), z.literal(UNKNOWN_USAGE_FILTER_VALUE)]).nullish(),
        }),
      },
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.userId;
      const { sessionId, startTime, endTime, groupBy, groupDimension, agent, model, startedBy } =
        request.body;
      const actualGroupBy = groupBy || 'day';
      const actualGroupDimension = groupDimension || 'none';
      const startTimeMs = startTime ? startTime * 1000 : undefined;
      const endTimeMs = endTime ? endTime * 1000 : undefined;

      try {
        // Build query conditions
        const where: {
          accountId: string;
          sessionId?: string | null;
        } = {
          accountId: userId,
        };

        if (sessionId) {
          // Verify session belongs to user
          const session = await db.session.findFirst({
            where: {
              id: sessionId,
              accountId: userId,
            },
          });
          if (!session) {
            return reply.code(404).send({ error: 'Session not found' });
          }
          where.sessionId = sessionId;
        }

        const sqlWhere: Prisma.Sql[] = [Prisma.sql`"accountId" = ${userId}`];
        if (where.sessionId) {
          sqlWhere.push(Prisma.sql`"sessionId" = ${where.sessionId}`);
        }

        const usageTimestampExpr = Prisma.sql`
          CASE
            WHEN jsonb_typeof("data"->'timestamp') = 'number' THEN ("data"->>'timestamp')::bigint
            ELSE FLOOR(EXTRACT(EPOCH FROM "updatedAt") * 1000)::bigint
          END
        `;

        if (startTimeMs !== undefined) {
          sqlWhere.push(Prisma.sql`${usageTimestampExpr} >= ${startTimeMs}`);
        }
        if (endTimeMs !== undefined) {
          sqlWhere.push(Prisma.sql`${usageTimestampExpr} <= ${endTimeMs}`);
        }

        const reports = await db.$queryRaw<
          Array<{
            createdAt: Date;
            updatedAt: Date;
            data: PrismaJson.UsageReportData;
          }>
        >`
          SELECT "createdAt", "updatedAt", "data"
          FROM "UsageReport"
          WHERE ${Prisma.join(sqlWhere, ' AND ')}
          ORDER BY "createdAt" DESC
        `;

        const result = aggregateUsageReports(
          reports,
          {
            startTime: startTime ?? undefined,
            endTime: endTime ?? undefined,
            groupBy: actualGroupBy,
            groupDimension: actualGroupDimension,
            filters: {
              agent: agent && agent !== UNKNOWN_USAGE_FILTER_VALUE ? agent : undefined,
              model: model && model !== UNKNOWN_USAGE_FILTER_VALUE ? model : undefined,
              startedBy:
                startedBy && startedBy !== UNKNOWN_USAGE_FILTER_VALUE ? startedBy : undefined,
              agentUnknown: agent === UNKNOWN_USAGE_FILTER_VALUE,
              modelUnknown: model === UNKNOWN_USAGE_FILTER_VALUE,
              startedByUnknown: startedBy === UNKNOWN_USAGE_FILTER_VALUE,
            },
          }
        );

        return reply.send({
          usage: result,
          groupBy: actualGroupBy,
          groupDimension: actualGroupDimension,
          totalReports: result.reduce((sum, point) => sum + point.reportCount, 0),
        });
      } catch (error) {
        log.error(`Failed to query usage reports: ${error}`);
        return reply.code(500).send({ error: 'Failed to query usage reports' });
      }
    }
  );
}
