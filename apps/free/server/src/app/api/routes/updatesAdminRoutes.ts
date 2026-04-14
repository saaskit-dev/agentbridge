import { z } from 'zod';
import { type Fastify } from '../types';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import {
  listOtaReleases,
  promoteOtaRelease,
  readLatestOtaRelease,
  saveOtaRelease,
} from '@/app/updates/releaseStore';

const logger = new Logger('app/api/routes/updatesAdminRoutes');

const otaReleaseSchema = z.object({
  id: z.string().min(1),
  channel: z.string().min(1),
  message: z.string().min(1),
  source: z.literal('self-hosted'),
  gitCommit: z.string().nullable(),
  createdAt: z.string().min(1),
  actor: z.string().nullable(),
  raw: z.unknown(),
  platforms: z.array(
    z.object({
      platform: z.enum(['ios', 'android']),
      runtimeVersion: z.string().nullable(),
      launchAssetUrl: z.string().nullable().optional(),
      manifestPermalink: z.string().nullable().optional(),
      manifest: z
        .object({
          id: z.string().min(1),
          createdAt: z.string().min(1),
          runtimeVersion: z.string().min(1),
          launchAsset: z.object({
            key: z.string().min(1),
            url: z.string().min(1),
            contentType: z.string().min(1),
            hash: z.string().min(1),
            fileExtension: z.string().optional(),
          }),
          assets: z.array(
            z.object({
              key: z.string().min(1),
              url: z.string().min(1),
              contentType: z.string().min(1),
              hash: z.string().min(1),
              fileExtension: z.string().optional(),
            })
          ),
          metadata: z.record(z.string(), z.string()),
          extra: z.record(z.string(), z.unknown()),
        })
        .nullable()
        .optional(),
    })
  ),
});

const otaPromoteSchema = z.object({
  releaseId: z.string().min(1),
});

function requireAdminToken(request: any, reply: any): boolean {
  const expected = process.env.EXPO_UPDATES_ADMIN_TOKEN;
  if (!expected) {
    reply.code(503).send({ error: 'updates_admin_unconfigured' });
    return false;
  }
  const actual = request.headers.authorization;
  if (actual !== `Bearer ${expected}`) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

export function updatesAdminRoutes(app: Fastify) {
  app.post(
    '/updates/admin/releases',
    {
      schema: {
        body: otaReleaseSchema,
      },
    },
    async (request, reply) => {
      if (!requireAdminToken(request, reply)) return;
      await saveOtaRelease(request.body);
      logger.info('Stored OTA release metadata', {
        releaseId: request.body.id,
        channel: request.body.channel,
        platforms: request.body.platforms.map(item => item.platform).join(','),
      });
      return reply.send({ ok: true });
    }
  );

  app.get('/updates/admin/releases', async (request, reply) => {
    if (!requireAdminToken(request, reply)) return;
    return reply.send({ releases: await listOtaReleases() });
  });

  app.post(
    '/updates/admin/promote',
    {
      schema: {
        body: otaPromoteSchema,
      },
    },
    async (request, reply) => {
      if (!requireAdminToken(request, reply)) return;
      const release = await promoteOtaRelease(request.body.releaseId);
      if (!release) {
        return reply.code(404).send({ error: 'release_not_found' });
      }
      logger.info('Promoted OTA release', {
        releaseId: release.id,
        channel: release.channel,
        platforms: release.platforms.map(item => item.platform).join(','),
      });
      return reply.send({ ok: true, release });
    }
  );

  app.get(
    '/updates/admin/latest',
    {
      schema: {
        querystring: z.object({
          channel: z.string().min(1),
          platform: z.enum(['ios', 'android']),
          runtimeVersion: z.string().min(1),
        }),
      },
    },
    async (request, reply) => {
      if (!requireAdminToken(request, reply)) return;
      const latest = await readLatestOtaRelease(
        request.query.channel,
        request.query.platform,
        request.query.runtimeVersion
      );
      return reply.send({ release: latest });
    }
  );
}
