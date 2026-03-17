import { Fastify } from '../types';
import { auth } from '@/app/auth/auth';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const log = new Logger('app/api/utils/enableAuthentication');

export function enableAuthentication(app: Fastify) {
  app.decorate('authenticate', async function (request: any, reply: any) {
    try {
      const authHeader = request.headers.authorization;
      log.debug(`Auth check - path: ${request.url}, has header: ${!!authHeader}`
      );
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        log.debug(`Auth failed - missing or invalid header`
        );
        return reply.code(401).send({ error: 'Missing authorization header' });
      }

      const token = authHeader.substring(7);
      const verified = await auth.verifyToken(token);
      if (!verified) {
        log.warn('HTTP auth failed — invalid token', { path: request.url, tokenSuffix: token.slice(-12) });
        return reply.code(401).send({ error: 'Invalid token' });
      }

      log.debug(`Auth success - user: ${verified.userId}`);
      request.userId = verified.userId;
    } catch (error) {
      return reply.code(401).send({ error: 'Authentication failed' });
    }
  });
}
