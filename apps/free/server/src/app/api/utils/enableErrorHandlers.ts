import { FastifyError } from 'fastify';
import { Fastify } from '../types';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const log = new Logger('app/api/utils/enableErrorHandlers');

export function enableErrorHandlers(app: Fastify) {
  // Global error handler
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const method = request.method;
    const url = request.url;
    const userAgent = request.headers['user-agent'] || 'unknown';
    const ip = request.ip || 'unknown';

    // Log the error with comprehensive context
    log.error(`Unhandled error: ${error.message}`
    );

    // Return appropriate error response
    const statusCode = error.statusCode || 500;
    // Include traceId so users can share a reference for support (RFC §17.11 Option A)
    const traceId = request.headers['x-trace-id'] as string | undefined;

    if (statusCode >= 500) {
      // Internal server errors - don't expose details
      return reply.code(statusCode).send({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        statusCode,
        ...(traceId ? { traceId } : {}),
      });
    } else {
      // Client errors - can expose more details
      return reply.code(statusCode).send({
        error: error.name || 'Error',
        message: error.message || 'An error occurred',
        statusCode,
        ...(traceId ? { traceId } : {}),
      });
    }
  });

  // Catch-all route for debugging 404s
  app.setNotFoundHandler((request, reply) => {
    log.info(`404 - Method: ${request.method}, Path: ${request.url}, Headers: ${JSON.stringify(request.headers)}`
    );
    reply.code(404).send({ error: 'Not found', path: request.url, method: request.method });
  });

  // Error hook for additional logging
  app.addHook('onError', async (request, reply, error) => {
    const method = request.method;
    const url = request.url;
    const duration = (Date.now() - (request.startTime || Date.now())) / 1000;

    log.error(`Request error: ${error.message}`
    );
  });

  // Handle uncaught exceptions in routes
  app.addHook('preHandler', async (request, reply) => {
    // Store original reply.send to catch errors in response serialization
    const originalSend = reply.send.bind(reply);
    reply.send = function (payload: any) {
      try {
        return originalSend(payload);
      } catch (error: any) {
        log.error(`Response serialization error: ${error.message}`
        );
        throw error;
      }
    };
  });
}
