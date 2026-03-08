import { Fastify } from '../types';
import { httpRequestsCounter, httpRequestDurationHistogram } from '@/app/monitoring/metrics2';
import { db } from '@/storage/db';
import { Logger, continueTrace } from '@agentbridge/core/telemetry';
const log = new Logger('app/api/utils/enableMonitoring');

export function enableMonitoring(app: Fastify) {
  // Add metrics hooks
  app.addHook('onRequest', async (request, reply) => {
    request.startTime = Date.now();

    // RFC §7.2: extract trace context from HTTP headers
    const traceId = request.headers['x-trace-id'] as string | undefined;
    const spanId = request.headers['x-span-id'] as string | undefined;
    if (traceId && spanId) {
      request.traceCtx = continueTrace({ traceId, spanId });
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const duration = (Date.now() - (request.startTime || Date.now())) / 1000;
    const method = request.method;
    // Use routeOptions.url for the route template, fallback to parsed URL path
    const route = request.routeOptions?.url || request.url.split('?')[0] || 'unknown';
    const status = reply.statusCode.toString();

    // Increment request counter
    httpRequestsCounter.inc({ method, route, status });

    // Record request duration
    httpRequestDurationHistogram.observe({ method, route, status }, duration);
  });

  app.get('/health', async (request, reply) => {
    try {
      // Test database connectivity
      await db.$queryRaw`SELECT 1`;
      reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'free-server',
      });
    } catch (error) {
      log.error(`Health check failed: ${error}`);
      reply.code(503).send({
        status: 'error',
        timestamp: new Date().toISOString(),
        service: 'free-server',
        error: 'Database connectivity failed',
      });
    }
  });
}
