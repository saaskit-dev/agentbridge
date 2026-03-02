/**
 * Server Capabilities Detection Service
 *
 * Detects server capabilities for feature detection.
 * Supports both free server (enhanced) and legacy server (basic).
 *
 * @module serverCapabilities
 */

import {
  type ServerCapabilities,
  DEFAULT_CAPABILITIES,
  hasCapability as hasCapabilityUtil,
} from '@agentbridge/core';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

/**
 * Server capabilities service
 *
 * Usage:
 * ```typescript
 * import { serverCapabilities } from '@/api/serverCapabilities';
 *
 * // Detect capabilities
 * await serverCapabilities.detect();
 *
 * // Check if streaming is supported
 * if (serverCapabilities.hasCapability('textDelta')) {
 *   // Enable typewriter effect
 * }
 * ```
 */
class ServerCapabilitiesService {
  private capabilities: ServerCapabilities | null = null;
  private detectionPromise: Promise<ServerCapabilities> | null = null;

  /**
   * Get current capabilities (may be null if not detected yet)
   */
  getCapabilities(): ServerCapabilities | null {
    return this.capabilities;
  }

  /**
   * Get server type
   */
  getServerType(): 'free' | 'happy' | 'unknown' {
    return this.capabilities?.serverType ?? 'unknown';
  }

  /**
   * Check if a specific capability is enabled
   */
  hasCapability(capability: string): boolean {
    if (!this.capabilities) {
      return false;
    }
    return hasCapabilityUtil(this.capabilities, capability as any);
  }

  /**
   * Check if streaming text (typewriter effect) is supported
   */
  supportsTextDelta(): boolean {
    return this.hasCapability('textDelta');
  }

  /**
   * Check if thinking streaming is supported
   */
  supportsThinkingDelta(): boolean {
    return this.hasCapability('thinkingDelta');
  }

  /**
   * Detect server capabilities
   *
   * Caches the result after first detection.
   * Returns cached result if already detected.
   */
  async detect(): Promise<ServerCapabilities> {
    // Return cached result
    if (this.capabilities) {
      return this.capabilities;
    }

    // Return existing detection promise to avoid duplicate requests
    if (this.detectionPromise) {
      return this.detectionPromise;
    }

    this.detectionPromise = this.doDetect();
    return this.detectionPromise;
  }

  /**
   * Force re-detection of capabilities
   */
  async redetect(): Promise<ServerCapabilities> {
    this.capabilities = null;
    this.detectionPromise = null;
    return this.detect();
  }

  /**
   * Internal detection implementation
   */
  private async doDetect(): Promise<ServerCapabilities> {
    const serverUrl = configuration.serverUrl;

    try {
      logger.debug(`[ServerCapabilities] Detecting capabilities from ${serverUrl}`);

      const response = await fetch(`${serverUrl}/v1/capabilities`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (!response.ok) {
    // Endpoint not found - assume legacy server
        if (response.status === 404) {
          logger.debug('[ServerCapabilities] Endpoint not found, assuming legacy server');
          this.capabilities = DEFAULT_CAPABILITIES;
          return this.capabilities;
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Validate response structure
      if (!this.isValidCapabilitiesResponse(data)) {
        logger.warn('[ServerCapabilities] Invalid response structure, using defaults');
        this.capabilities = DEFAULT_CAPABILITIES;
        return this.capabilities;
      }

      this.capabilities = data as ServerCapabilities;

      logger.info(`[ServerCapabilities] Detected ${this.capabilities.serverType} server v${this.capabilities.version}`);

      // Log enhanced features if available
      const enhancedFeatures = Object.entries(this.capabilities.capabilities.enhanced)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);

      if (enhancedFeatures.length > 0) {
        logger.debug(`[ServerCapabilities] Enhanced features: ${enhancedFeatures.join(', ')}`);
      }

      return this.capabilities;
    } catch (error) {
      // Network error or timeout - assume legacy server with basic capabilities
      logger.debug(`[ServerCapabilities] Detection failed: ${error}. Using default capabilities.`);
      this.capabilities = DEFAULT_CAPABILITIES;
      return this.capabilities;
    }
  }

  /**
   * Validate capabilities response structure
   */
  private isValidCapabilitiesResponse(data: unknown): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const obj = data as Record<string, unknown>;

    // Check required fields
    if (typeof obj.serverType !== 'string') return false;
    if (typeof obj.version !== 'string') return false;
    if (!obj.capabilities || typeof obj.capabilities !== 'object') return false;

    const caps = obj.capabilities as Record<string, unknown>;
    if (!caps.basic || typeof caps.basic !== 'object') return false;
    if (!caps.enhanced || typeof caps.enhanced !== 'object') return false;

    return true;
  }
}

/**
 * Singleton instance
 */
export const serverCapabilities = new ServerCapabilitiesService();

/**
 * Convenience function to detect capabilities
 */
export async function detectServerCapabilities(): Promise<ServerCapabilities> {
  return serverCapabilities.detect();
}

/**
 * Convenience function to check if streaming is supported
 */
export function supportsStreamingText(): boolean {
  return serverCapabilities.supportsTextDelta();
}
