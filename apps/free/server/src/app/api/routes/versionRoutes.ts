import * as semver from 'semver';
import { z } from 'zod';
import { type Fastify } from '../types';
import { ANDROID_UP_TO_DATE, IOS_UP_TO_DATE } from '@/versions';

// Default update URLs (can be overridden via environment variables)
const IOS_UPDATE_URL = process.env.IOS_UPDATE_URL || null;
const ANDROID_UPDATE_URL = process.env.ANDROID_UPDATE_URL || null;

export function versionRoutes(app: Fastify) {
  app.post(
    '/v1/version',
    {
      schema: {
        body: z.object({
          platform: z.string(),
          version: z.string(),
          app_id: z.string(),
        }),
        response: {
          200: z.object({
            updateUrl: z.string().nullable(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { platform, version, app_id } = request.body;

      // Check ios
      if (platform.toLowerCase() === 'ios') {
        if (semver.satisfies(version, IOS_UP_TO_DATE)) {
          reply.send({ updateUrl: null });
        } else {
          reply.send({ updateUrl: IOS_UPDATE_URL });
        }
        return;
      }

      // Check android
      if (platform.toLowerCase() === 'android') {
        if (semver.satisfies(version, ANDROID_UP_TO_DATE)) {
          reply.send({ updateUrl: null });
        } else {
          reply.send({ updateUrl: ANDROID_UPDATE_URL });
        }
        return;
      }

      // Fallback
      reply.send({ updateUrl: null });
    }
  );
}
