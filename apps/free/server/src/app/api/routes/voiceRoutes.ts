import { z } from 'zod';
import { type Fastify } from '../types';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const log = new Logger('app/api/routes/voiceRoutes');

export function voiceRoutes(app: Fastify) {
  app.post(
    '/v1/voice/token',
    {
      preHandler: app.authenticate,
      schema: {
        body: z.object({
          agentId: z.string(),
          revenueCatPublicKey: z.string().optional(),
        }),
        response: {
          200: z.object({
            allowed: z.boolean(),
            token: z.string().optional(),
            agentId: z.string().optional(),
          }),
          400: z.object({
            allowed: z.boolean(),
            error: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId; // CUID from JWT
      const { agentId, revenueCatPublicKey } = request.body;

      log.info(`Voice token request from user ${userId}`);

      const isDevelopment = process.env.NODE_ENV === 'development' || process.env.ENV === 'dev';
      const skipBillingCheck = process.env.SKIP_BILLING_CHECK === 'true';

      if (!isDevelopment && !skipBillingCheck) {
        // Production requires RevenueCat key
        if (!revenueCatPublicKey) {
          log.info('Production environment requires RevenueCat public key');
          return reply.code(400).send({
            allowed: false,
            error: 'RevenueCat public key required',
          });
        }

        // Check subscription
        const rcResponse = await fetch(`https://api.revenuecat.com/v1/subscribers/${userId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${revenueCatPublicKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (!rcResponse.ok) {
          log.info(`RevenueCat check failed for user ${userId}: ${rcResponse.status}`);
          return reply.send({ allowed: false, agentId });
        }

        const rcData = (await rcResponse.json()) as any;
        const proEntitlement = rcData.subscriber?.entitlements?.active?.pro;

        if (!proEntitlement) {
          log.info(`User ${userId} does not have active subscription`);
          return reply.send({ allowed: false, agentId });
        }
      }

      // Check if 11Labs API key is configured
      const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
      if (!elevenLabsApiKey) {
        log.info('Missing 11Labs API key');
        return reply
          .code(400)
          .send({ allowed: false, error: 'Missing 11Labs API key on the server' });
      }

      // Get 11Labs conversation token
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
        {
          method: 'GET',
          headers: {
            'xi-api-key': elevenLabsApiKey,
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        log.info(`Failed to get 11Labs token for user ${userId}`);
        return reply.code(400).send({
          allowed: false,
          error: `Failed to get 11Labs token for user ${userId}`,
        });
      }

      const data = (await response.json()) as any;
      const token = data.token;

      log.info(`Voice token issued for user ${userId}`);
      return reply.send({
        allowed: true,
        token,
        agentId,
      });
    }
  );
}
