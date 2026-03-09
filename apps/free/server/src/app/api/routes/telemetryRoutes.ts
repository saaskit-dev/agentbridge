/**
 * Telemetry ingest endpoint — receives batched log entries from CLI/Daemon/App
 * and forwards them to New Relic via the server-side TelemetryRelay.
 *
 * Protection:
 * - JWT authentication (existing app.authenticate)
 * - Per-user rate limiting (sliding window)
 * - Payload size: max 50 entries/request, message max 4KB
 * - Route-level body limit: 256KB
 */

import { z } from 'zod';
import { type Fastify } from '../types';
import { telemetryRelay } from '@/utils/telemetryRelay';

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per-user sliding window)
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_ENTRIES = 500; // per user per window

const rateLimits = new Map<string, { count: number; resetAt: number }>();

// Periodically purge expired entries to prevent memory leak
const _cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimits) {
    if (val.resetAt < now) rateLimits.delete(key);
  }
}, 5 * 60_000);
if (_cleanupTimer && typeof _cleanupTimer === 'object' && 'unref' in _cleanupTimer) {
  (_cleanupTimer as NodeJS.Timeout).unref();
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const logEntrySchema = z.object({
  timestamp: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  layer: z.string().max(64),
  component: z.string().max(128),
  message: z.string().max(4096),
  traceId: z.string().max(64).optional(),
  spanId: z.string().max(64).optional(),
  parentSpanId: z.string().max(64).optional(),
  sessionId: z.string().max(128).optional(),
  machineId: z.string().max(128).optional(),
  data: z.record(z.unknown()).optional(),
  error: z
    .object({
      message: z.string().max(4096),
      stack: z.string().max(8192).optional(),
      code: z.string().max(64).optional(),
    })
    .optional(),
  durationMs: z.number().optional(),
});

const metadataSchema = z.object({
  deviceId: z.string().max(128),
  appVersion: z.string().max(32),
  layer: z.string().max(64),
  machineId: z.string().max(128).optional(),
});

const ingestBodySchema = z.object({
  metadata: metadataSchema,
  entries: z.array(logEntrySchema).min(1).max(50),
});

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function telemetryRoutes(app: Fastify) {
  app.post(
    '/v1/telemetry/ingest',
    {
      schema: { body: ingestBodySchema },
      preHandler: app.authenticate,
      config: { rawBody: false },
      bodyLimit: 256 * 1024, // 256KB
    },
    async (request, reply) => {
      const userId = request.userId;
      const { metadata, entries } = request.body as z.infer<typeof ingestBodySchema>;

      // Rate limiting
      const now = Date.now();
      let limit = rateLimits.get(userId);
      if (!limit || limit.resetAt < now) {
        limit = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
        rateLimits.set(userId, limit);
      }

      if (limit.count + entries.length > RATE_LIMIT_MAX_ENTRIES) {
        return reply.code(429).send({
          error: 'Rate limit exceeded',
          retryAfterMs: limit.resetAt - now,
        });
      }
      limit.count += entries.length;

      // Forward to relay (non-blocking)
      if (telemetryRelay) {
        telemetryRelay.ingest(entries, metadata);
      }

      return { accepted: entries.length };
    }
  );
}
