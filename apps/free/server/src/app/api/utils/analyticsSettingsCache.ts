/**
 * In-memory cache for analytics settings
 *
 * Used to add X-Analytics-Enabled header to all API responses
 * without querying the database on every request.
 *
 * Updated when settings are changed via /v1/account/settings
 */

import { db } from '@/storage/db';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const log = new Logger('app/api/utils/analyticsSettingsCache');

// Cache: userId -> analyticsEnabled (undefined means not cached yet)
const cache = new Map<string, boolean>();

/**
 * Get analyticsEnabled for a user from cache or database
 */
export async function getAnalyticsEnabled(userId: string): Promise<boolean> {
  // Check cache first
  const cached = cache.get(userId);
  if (cached !== undefined) {
    return cached;
  }

  // Query from database
  try {
    const user = await db.account.findUnique({
      where: { id: userId },
      select: { settings: true },
    });

    if (user?.settings) {
      try {
        const settings = JSON.parse(user.settings as string);
        const analyticsEnabled = settings.analyticsEnabled ?? true;
        cache.set(userId, analyticsEnabled);
        return analyticsEnabled;
      } catch {
        // Invalid JSON, default to true
        cache.set(userId, true);
        return true;
      }
    }

    // No settings, default to true
    cache.set(userId, true);
    return true;
  } catch (error) {
    log.debug(`Failed to get analytics settings for user ${userId}:`, error);
    return true; // Default to enabled on error
  }
}

/**
 * Update cache when settings change
 */
export function updateAnalyticsEnabledCache(userId: string, analyticsEnabled: boolean): void {
  cache.set(userId, analyticsEnabled);
  log.debug(`Updated analytics cache for user ${userId}: ${analyticsEnabled}`);
}

/**
 * Invalidate cache for a user (force reload on next request)
 */
export function invalidateAnalyticsEnabledCache(userId: string): void {
  cache.delete(userId);
}
