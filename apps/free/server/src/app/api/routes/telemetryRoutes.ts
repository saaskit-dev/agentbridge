/**
 * Telemetry ingest endpoint — receives batched log entries from CLI/Daemon/App
 * and forwards them to New Relic via the server-side TelemetryRelay.
 *
 * Protection:
 * - JWT authentication (existing app.authenticate)
 * - Payload size: max 50 entries/request
 *
 * Rate limiting: temporarily disabled for monitoring.
 * Stats collected for future rate limit calibration.
 */

import { z } from 'zod';
import { type Fastify } from '../types';
import { telemetryRelay } from '@/utils/telemetryRelay';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('server/telemetryRoutes');
const MAX_LOG_MESSAGE_LENGTH = 8192;
const MAX_ERROR_MESSAGE_LENGTH = 8192;
const MAX_ERROR_STACK_LENGTH = 16384;

function clampString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 14))}...[truncated]`;
}

function clampStringSchema(maxLength: number) {
  return z.string().transform(value => clampString(value, maxLength));
}

function shouldMirrorClientLogs(): boolean {
  if (process.env.TELEMETRY_MIRROR_CLIENT_LOGS) {
    return process.env.TELEMETRY_MIRROR_CLIENT_LOGS === 'true';
  }
  return process.env.APP_ENV === 'development' || process.env.NODE_ENV === 'development';
}

// ---------------------------------------------------------------------------
// Statistics tracking (for future rate limit calibration)
// ---------------------------------------------------------------------------

interface UserStats {
  perMinuteCounts: number[]; // Last 5 minute counts
  lastMinute: number;
  currentCount: number;
  totalCount: number;
}

const userStats = new Map<string, UserStats>();

// Aggregate stats (reset daily)
let globalDailyStats = {
  totalEntries: 0,
  totalRequests: 0,
  uniqueUsers: new Set<string>(),
  peakPerMinute: 0,
  peakUserId: '',
};

// Periodically aggregate per-minute stats and log summary
const _statsTimer = setInterval(() => {
  const now = Date.now();
  const currentMinute = Math.floor(now / 60_000);

  for (const [userId, stats] of userStats) {
    if (stats.lastMinute < currentMinute - 1) {
      // Roll over to new minute
      stats.perMinuteCounts.push(stats.currentCount);
      if (stats.perMinuteCounts.length > 5) stats.perMinuteCounts.shift();
      stats.currentCount = 0;
      stats.lastMinute = currentMinute;
    }
  }

  // Log summary every 5 minutes
  if (currentMinute % 5 === 0) {
    const topUsers = Array.from(userStats.entries())
      .map(([userId, stats]) => ({
        userId: userId.substring(0, 8),
        last5min: stats.perMinuteCounts.reduce((a, b) => a + b, 0) + stats.currentCount,
        total: stats.totalCount,
      }))
      .sort((a, b) => b.last5min - a.last5min)
      .slice(0, 5);

    if (topUsers.length > 0) {
      logger.info('[TELEMETRY] Usage stats', {
        uniqueUsers: userStats.size,
        dailyTotal: globalDailyStats.totalEntries,
        peakPerMinute: globalDailyStats.peakPerMinute,
        topUsers,
      });
    }
  }
}, 60_000);
if (_statsTimer && typeof _statsTimer === 'object' && 'unref' in _statsTimer) {
  (_statsTimer as NodeJS.Timeout).unref();
}

// Reset daily stats at midnight
const _dailyResetTimer = setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    logger.info('[TELEMETRY] Daily stats reset', {
      totalEntries: globalDailyStats.totalEntries,
      totalRequests: globalDailyStats.totalRequests,
      uniqueUsers: globalDailyStats.uniqueUsers.size,
      peakPerMinute: globalDailyStats.peakPerMinute,
      peakUserId: globalDailyStats.peakUserId,
    });
    globalDailyStats = {
      totalEntries: 0,
      totalRequests: 0,
      uniqueUsers: new Set(),
      peakPerMinute: 0,
      peakUserId: '',
    };
    userStats.clear();
  }
}, 60_000);
if (_dailyResetTimer && typeof _dailyResetTimer === 'object' && 'unref' in _dailyResetTimer) {
  (_dailyResetTimer as NodeJS.Timeout).unref();
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const logEntrySchema = z.object({
  timestamp: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  layer: z.string().max(64),
  component: z.string().max(128),
  message: clampStringSchema(MAX_LOG_MESSAGE_LENGTH),
  traceId: z.string().max(64).optional(),
  sessionId: z.string().max(128).optional(),
  machineId: z.string().max(128).optional(),
  data: z.record(z.unknown()).optional(),
  error: z
    .object({
      message: clampStringSchema(MAX_ERROR_MESSAGE_LENGTH),
      stack: clampStringSchema(MAX_ERROR_STACK_LENGTH).optional(),
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
      bodyLimit: 1024 * 1024, // 1 MB — prevent abuse via oversized payloads
    },
    async (request, reply) => {
      const userId = request.userId;
      const { metadata, entries } = request.body as z.infer<typeof ingestBodySchema>;

      // Track statistics for future rate limit calibration
      const now = Date.now();
      const currentMinute = Math.floor(now / 60_000);

      let stats = userStats.get(userId);
      if (!stats) {
        stats = {
          perMinuteCounts: [],
          lastMinute: currentMinute,
          currentCount: 0,
          totalCount: 0,
        };
        userStats.set(userId, stats);
      }

      // Roll over if new minute
      if (stats.lastMinute < currentMinute) {
        stats.perMinuteCounts.push(stats.currentCount);
        if (stats.perMinuteCounts.length > 5) stats.perMinuteCounts.shift();
        stats.currentCount = 0;
        stats.lastMinute = currentMinute;
      }

      // Update counts
      stats.currentCount += entries.length;
      stats.totalCount += entries.length;

      // Update global stats
      globalDailyStats.totalEntries += entries.length;
      globalDailyStats.totalRequests += 1;
      globalDailyStats.uniqueUsers.add(userId);

      if (stats.currentCount > globalDailyStats.peakPerMinute) {
        globalDailyStats.peakPerMinute = stats.currentCount;
        globalDailyStats.peakUserId = userId.substring(0, 8);
      }

      // Forward to relay (non-blocking)
      if (telemetryRelay) {
        telemetryRelay.ingest(entries, metadata);
      }

      // Client log mirroring is for local debugging only. In production it can
      // explode JSONL volume and amplify noisy debug traffic into server I/O.
      if (shouldMirrorClientLogs()) {
        for (const entry of entries) {
          const level = entry.level === 'warn' ? 'info' : entry.level;
          if (level === 'error') {
            logger.error(
              `[client:${metadata.layer}] ${entry.message}`,
              entry.error ? new Error(entry.error.message) : undefined,
              {
                clientComponent: entry.component,
                ...entry.data,
              }
            );
          } else if (level === 'info' || level === 'debug') {
            logger.info(`[client:${metadata.layer}] ${entry.message}`, {
              clientComponent: entry.component,
              clientLevel: entry.level,
              ...entry.data,
            });
          }
        }
      }

      return { accepted: entries.length };
    }
  );
}
