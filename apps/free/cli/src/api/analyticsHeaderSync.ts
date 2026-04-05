/**
 * Analytics header sync via API response headers
 *
 * Server adds X-Analytics-Enabled header to all authenticated API responses.
 * This module intercepts all axios responses and syncs the
 * analyticsEnabled setting to local file when the header changes.
 *
 * This enables immediate stop of telemetry upload when user disables
 * analytics in the App - no polling needed, just piggyback on existing API calls.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { configuration } from '@/configuration';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('api/analyticsHeaderSync');

/**
 * Analytics header sync via API response headers
 *
 * Server adds X-Analytics-Enabled header to all authenticated API responses.
 * This module intercepts all axios responses and syncs the
 * analyticsEnabled setting to local file when the header changes.
 *
 * This enables immediate stop of telemetry upload when user disables
 * analytics in the App - no polling needed, just piggyback on existing API calls.
 */

/**
 * In-memory cache of the last known analyticsEnabled value.
 * Updated when we receive X-Analytics-Enabled header from server.
 */
let lastKnownAnalyticsEnabled: boolean | undefined;

/**
 * Sync analyticsEnabled from server response header.
 */
export class AnalyticsHeaderSync {
  private static lastKnownValue: boolean | undefined;
  private static lastWrittenValue: boolean | undefined;

  /**
   * Get the last known value from header sync.
   * Returns undefined if no header has been received yet.
   */
  static getLastKnownValue(): boolean | undefined {
    return this.lastKnownValue;
  }

  /**
   * Called when X-Analytics-Enabled header is received from server.
   */
  static syncFromHeader(enabled: boolean): void {
    // Update in-memory cache
    this.lastKnownValue = enabled;

    // Write to local file if changed
    if (this.lastWrittenValue !== enabled) {
      this.lastWrittenValue = enabled;
      this.writeToLocal(enabled);
    }
  }

  /**
   * Called when user runs `free analytics on/off` command.
   */
  static async syncToLocal(enabled: boolean): Promise<void> {
    this.lastKnownValue = enabled;
    if (this.lastWrittenValue !== enabled) {
      this.lastWrittenValue = enabled;
      await this.writeToLocalAsync(enabled);
    }
  }

  private static writeToLocal(enabled: boolean): void {
    try {
      if (!existsSync(configuration.settingsFile)) return;
      const content = readFileSync(configuration.settingsFile, 'utf8');
      const settings = JSON.parse(content);

      if (settings.analyticsEnabled !== enabled) {
        settings.analyticsEnabled = enabled;
        writeFileSync(configuration.settingsFile, JSON.stringify(settings, null, 2));
        logger.info('[ANALYTICS SYNC] Synced analyticsEnabled from server', { enabled });
      }
    } catch (error) {
      logger.debug('[ANALYTICS SYNC] Failed to sync to local file:', error);
    }
  }

  private static async writeToLocalAsync(enabled: boolean): Promise<void> {
    try {
      if (!existsSync(configuration.settingsFile)) return;
      const { readFile, writeFile } = require('node:fs/promises');
      const content = await readFile(configuration.settingsFile, 'utf8');
      const settings = JSON.parse(content);

      if (settings.analyticsEnabled !== enabled) {
        settings.analyticsEnabled = enabled;
        await writeFile(configuration.settingsFile, JSON.stringify(settings, null, 2));
        logger.info('[ANALYTICS SYNC] Synced analyticsEnabled from server', { enabled });
      }
    } catch (error) {
      logger.debug('[ANALYTICS SYNC] Failed to sync to local file:', error);
    }
  }
}

/**
 * Check if analytics is enabled from the in-memory cached value.
 * This is fast and doesn't hit the filesystem.
 */
export function isAnalyticsEnabled(): boolean {
  return AnalyticsHeaderSync.getLastKnownValue() ?? true;
}

/**
 * Sync version of isAnalyticsEnabled for telemetry (reads from in-memory cache).
 */
export function isAnalyticsEnabledSync(): boolean {
  return AnalyticsHeaderSync.getLastKnownValue() ?? true;
}

/**
 * Update the analytics setting (called by analytics command).
 */
export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  await AnalyticsHeaderSync.syncToLocal(enabled);
}

// Install axios interceptor on first import
let interceptorInstalled = false;

export function installAnalyticsHeaderInterceptor(): void {
  if (interceptorInstalled) return;
  interceptorInstalled = true;

  const axios = require('axios').default;
  axios.interceptors.response.use((response: any) => {
    const header = response.headers['x-analytics-enabled'];
    if (header !== undefined) {
      const enabled = header === 'true';
      AnalyticsHeaderSync.syncFromHeader(enabled);
    }
    return response;
  });
}

// Install on module load
installAnalyticsHeaderInterceptor();
