import * as fs from 'fs';
import * as path from 'path';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { accessKeysRoutes } from './routes/accessKeysRoutes';
import { accountRoutes } from './routes/accountRoutes';
import { artifactsRoutes } from './routes/artifactsRoutes';
import { authRoutes } from './routes/authRoutes';
import { connectRoutes } from './routes/connectRoutes';
import { pushRoutes } from './routes/pushRoutes';
import { Fastify } from './types';
import { sessionRoutes } from './routes/sessionRoutes';
import { startSocket } from './socket';
import { machinesRoutes } from './routes/machinesRoutes';

import { versionRoutes } from './routes/versionRoutes';
import { voiceRoutes } from './routes/voiceRoutes';
import { enableAuthentication } from './utils/enableAuthentication';
import { enableErrorHandlers } from './utils/enableErrorHandlers';
import { enableMonitoring } from './utils/enableMonitoring';
import { getAnalyticsEnabled } from './utils/analyticsSettingsCache';
import { userRoutes } from './routes/userRoutes';
import { feedRoutes } from './routes/feedRoutes';
import { kvRoutes } from './routes/kvRoutes';
import { capabilitiesRoutes } from './routes/capabilitiesRoutes';
import { telemetryRoutes } from './routes/telemetryRoutes';
import { register } from '@/app/monitoring/metrics2';
import { db } from '@/storage/db';
import { isLocalStorage, getLocalFilesDir } from '@/storage/files';
import { Logger, resumeTrace } from '@saaskit-dev/agentbridge/telemetry';
import { createFastifyLogger } from '@/utils/fastifyLogger';
import { runWithTrace } from '@/utils/requestTrace';
import { onShutdown, SHUTDOWN_PHASE } from '@/utils/shutdown';

const log = new Logger('app/api/api');
export async function startApi() {
  // Configure
  log.info('Starting API...');

  // Start API
  const app = fastify({
    loggerInstance: createFastifyLogger(),
    bodyLimit: 1024 * 1024 * 100, // 100MB
  });
  app.register(import('@fastify/cors'), {
    origin:
      process.env.APP_ENV === 'development'
        ? true
        : [
            'https://free.saaskit.app',
            'https://free-server.saaskit.app',
            'https://app.happy.engineering',
          ],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id', 'X-Socket-Id'],
    methods: ['GET', 'POST', 'DELETE'],
  });
  app.get('/', function (request, reply) {
    const referer = request.headers.referer || request.headers.referrer || '';
    const userAgent = request.headers['user-agent'] || '';
    // Return Happy format for Happy app requests (by referer or user-agent)
    if (referer.includes('app.happy.engineering') || userAgent.includes('Happy')) {
      reply.send('Welcome to Happy Server!');
    } else {
      reply.send('Welcome to Free Server!');
    }
  });

  // Create typed provider
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;

  // Enable features
  enableMonitoring(typed);
  enableErrorHandlers(typed);
  enableAuthentication(typed);

  // Extract trace context from HTTP headers and propagate via AsyncLocalStorage.
  // Must be registered AFTER authentication so it runs early in the request lifecycle.
  app.addHook('onRequest', (request, _reply, done) => {
    const traceId = request.headers['x-trace-id'] as string | undefined;
    if (traceId) {
      runWithTrace(resumeTrace(traceId), done);
    } else {
      done();
    }
  });

  // Add X-Analytics-Enabled header to all authenticated responses
  // This allows CLI to sync analytics setting without extra polling
  app.addHook('onResponse', async (request, reply) => {
    const userId = (request as any).userId;
    if (userId) {
      try {
        const analyticsEnabled = await getAnalyticsEnabled(userId);
        reply.header('X-Analytics-Enabled', analyticsEnabled ? 'true' : 'false');
      } catch (error) {
        // Don't fail the request if this fails
        log.debug('Failed to add X-Analytics-Enabled header', error);
      }
    }
  });

  // Serve local files when using local storage
  if (isLocalStorage()) {
    app.get('/files/*', function (request, reply) {
      const filePath = (request.params as any)['*'];
      const baseDir = path.resolve(getLocalFilesDir());
      const fullPath = path.resolve(baseDir, filePath);
      if (!fullPath.startsWith(baseDir + path.sep)) {
        reply.code(403).send('Forbidden');
        return;
      }
      if (!fs.existsSync(fullPath)) {
        reply.code(404).send('Not found');
        return;
      }
      const stream = fs.createReadStream(fullPath);
      reply.send(stream);
    });
  }

  // Routes
  authRoutes(typed);
  pushRoutes(typed);
  sessionRoutes(typed);
  accountRoutes(typed);
  connectRoutes(typed);
  machinesRoutes(typed);
  artifactsRoutes(typed);
  accessKeysRoutes(typed);
  versionRoutes(typed);
  voiceRoutes(typed);
  userRoutes(typed);
  feedRoutes(typed);
  kvRoutes(typed);
  capabilitiesRoutes(typed);
  telemetryRoutes(typed);

  // Metrics endpoint (integrated into main server)
  app.get('/metrics', async (_request, reply) => {
    try {
      let prismaMetrics = '';
      try {
        prismaMetrics = (await (db as any).$metrics?.prometheus?.()) ?? '';
      } catch {
        // Prisma metrics require the "metrics" preview feature — skip silently if unavailable
      }
      const appMetrics = await register.metrics();
      const combinedMetrics = prismaMetrics + '\n' + appMetrics;
      reply.type('text/plain; version=0.0.4; charset=utf-8');
      reply.send(combinedMetrics);
    } catch (error) {
      log.error(`Error generating metrics: ${error}`);
      reply.code(500).send('Internal Server Error');
    }
  });

  // Start HTTP
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen({ port, host: '0.0.0.0' });
  onShutdown(
    'http',
    async () => {
      log.info('[shutdown] http close: start');
      await app.close();
      log.info('[shutdown] http close: done');
    },
    SHUTDOWN_PHASE.NETWORK
  );

  // Start Socket
  await startSocket(typed);

  // End
  log.info('API ready on port http://localhost:' + port);
}
