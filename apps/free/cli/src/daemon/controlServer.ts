/**
 * HTTP control server for daemon management
 * Provides endpoints for listing sessions, stopping sessions, and daemon shutdown
 */

import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SessionSummary } from '@/daemon/sessions/types';
import type {
  SpawnSessionOptions,
  SpawnSessionResult,
} from '@/modules/common/registerCommonHandlers';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { safeStringify } from '@saaskit-dev/agentbridge';
const logger = new Logger('daemon/controlServer');
const AgentTypeSchema = z.enum(['claude', 'codex', 'gemini', 'opencode']);

export function startDaemonControlServer({
  getSessions,
  stopSession,
  spawnSession,
  requestShutdown,
  controlToken,
}: {
  getSessions: () => SessionSummary[];
  stopSession: (sessionId: string) => boolean;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  requestShutdown: () => void;
  controlToken: string;
}): Promise<{ port: number; stop: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const app = fastify({
      logger: false,
      connectionTimeout: 10000,
      keepAliveTimeout: 5000,
      bodyLimit: 1048576,
      forceCloseConnections: true,
    });

    app.setErrorHandler((error, _request, reply) => {
      const errorMessage = safeStringify(error);
      logger.debug(`[CONTROL SERVER] Error handling request: ${errorMessage}`);
      reply.code(500).send({ error: 'Internal server error' });
    });

    // Authenticate all requests with the control token
    app.addHook('onRequest', (request, reply, done) => {
      const authHeader = request.headers.authorization;
      if (authHeader !== `Bearer ${controlToken}`) {
        logger.debug('[CONTROL SERVER] Unauthorized request rejected');
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }
      done();
    });

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>();

    // List all active sessions
    typed.post(
      '/list',
      {
        schema: {
          response: {
            200: z.object({
              sessions: z.array(
                z.object({
                  sessionId: z.string(),
                  agentType: z.string(),
                  cwd: z.string(),
                  state: z.string(),
                  startedAt: z.string(),
                  startedBy: z.string(),
                })
              ),
            }),
          },
        },
      },
      async () => {
        const sessions = getSessions();
        logger.debug(`[CONTROL SERVER] Listing ${sessions.length} sessions`);
        return { sessions };
      }
    );

    // Stop specific session
    typed.post(
      '/stop-session',
      {
        schema: {
          body: z.object({
            sessionId: z.string(),
          }),
          response: {
            200: z.object({
              success: z.boolean(),
            }),
          },
        },
      },
      async request => {
        const { sessionId } = request.body;
        logger.debug(`[CONTROL SERVER] Stop session request: ${sessionId}`);
        const success = stopSession(sessionId);
        return { success };
      }
    );

    // Spawn new session
    typed.post(
      '/spawn-session',
      {
        schema: {
          body: z.object({
            directory: z.string(),
            sessionId: z.string().optional(),
            agent: AgentTypeSchema.optional(),
          }),
          response: {
            200: z.object({
              success: z.boolean(),
              sessionId: z.string().optional(),
              approvedNewDirectoryCreation: z.boolean().optional(),
            }),
            409: z.object({
              success: z.boolean(),
              requiresUserApproval: z.boolean().optional(),
              actionRequired: z.string().optional(),
              directory: z.string().optional(),
            }),
            500: z.object({
              success: z.boolean(),
              error: z.string().optional(),
            }),
          },
        },
      },
      async (request, reply) => {
        const { directory, sessionId, agent } = request.body;
        logger.debug(
          `[CONTROL SERVER] Spawn session request: dir=${directory}, sessionId=${sessionId || 'new'}, agent=${agent || 'default'}`
        );
        const result = await spawnSession({ directory, sessionId, agent });

        switch (result.type) {
          case 'success':
            if (!result.sessionId) {
              reply.code(500);
              return { success: false, error: 'Failed to spawn session: no session ID returned' };
            }
            return {
              success: true,
              sessionId: result.sessionId,
              approvedNewDirectoryCreation: true,
            };

          case 'requestToApproveDirectoryCreation':
            reply.code(409);
            return {
              success: false,
              requiresUserApproval: true,
              actionRequired: 'CREATE_DIRECTORY',
              directory: result.directory,
            };

          case 'error':
            reply.code(500);
            return { success: false, error: result.errorMessage };
        }
      }
    );

    // Stop daemon
    typed.post(
      '/stop',
      {
        schema: {
          response: {
            200: z.object({ status: z.string() }),
          },
        },
      },
      async () => {
        logger.debug('[CONTROL SERVER] Stop daemon request received');
        setTimeout(() => {
          logger.debug('[CONTROL SERVER] Triggering daemon shutdown');
          requestShutdown();
        }, 50);
        return { status: 'stopping' };
      }
    );

    app.listen({ port: 0, host: '127.0.0.1' }, (err, address) => {
      if (err) {
        logger.debug('[CONTROL SERVER] Failed to start:', err);
        reject(err);
        return;
      }
      const port = parseInt(address.split(':').pop()!);
      logger.debug(`[CONTROL SERVER] Started on port ${port}`);
      resolve({
        port,
        stop: async () => {
          logger.debug('[CONTROL SERVER] Stopping server');
          await app.close();
          logger.debug('[CONTROL SERVER] Server stopped');
        },
      });
    });
  });
}
