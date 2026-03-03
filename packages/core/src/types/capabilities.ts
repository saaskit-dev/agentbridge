/**
 * Server Capabilities Types
 *
 * Shared types for server capability detection.
 * Used by both CLI and App clients.
 */

/**
 * Server type identifier
 */
export type ServerType = 'free' | 'happy' | 'unknown';

/**
 * Basic server capabilities (supported by all servers)
 */
export interface BasicCapabilities {
  messages: boolean;
  sessions: boolean;
  machines: boolean;
  artifacts: boolean;
  ephemeral: boolean;
  auth: boolean;
  kv: boolean;
}

/**
 * Enhanced server capabilities (free server only)
 */
export interface EnhancedCapabilities {
  /** Typewriter effect - streaming text delta */
  textDelta: boolean;
  /** Thinking delta streaming */
  thinkingDelta: boolean;
  /** Real-time RPC */
  realtimeRpc: boolean;
  /** Voice chat */
  voiceChat: boolean;
  /** Multi-agent support */
  multiAgent: boolean;
}

/**
 * Full server capabilities response
 */
export interface ServerCapabilities {
  serverType: ServerType;
  version: string;
  capabilities: {
    basic: BasicCapabilities;
    enhanced: EnhancedCapabilities;
  };
}

/**
 * Default capabilities for unknown/legacy servers
 * Default capabilities for unknown/happy servers
 * Conservative: assume only basic features are available
 */
export const DEFAULT_CAPABILITIES: ServerCapabilities = {
  serverType: 'happy',
  version: 'unknown',
  capabilities: {
    basic: {
      messages: true,
      sessions: true,
      machines: true,
      artifacts: true,
      ephemeral: true,
      auth: true,
      kv: true,
    },
    enhanced: {
      textDelta: false,
      thinkingDelta: false,
      realtimeRpc: false,
      voiceChat: false,
      multiAgent: false,
    },
  },
};

/**
 * Check if a specific capability is enabled
 */
export function hasCapability(
  capabilities: ServerCapabilities,
  capability: keyof BasicCapabilities | keyof EnhancedCapabilities
): boolean {
  // Check basic capabilities
  if (capability in capabilities.capabilities.basic) {
    return capabilities.capabilities.basic[capability as keyof BasicCapabilities];
  }

  // Check enhanced capabilities
  if (capability in capabilities.capabilities.enhanced) {
    return capabilities.capabilities.enhanced[capability as keyof EnhancedCapabilities];
  }

  return false;
}

/**
 * Check if server supports streaming text (typewriter effect)
 */
export function supportsTextDelta(capabilities: ServerCapabilities): boolean {
  return capabilities.capabilities.enhanced.textDelta;
}

/**
 * Check if server supports thinking streaming
 */
export function supportsThinkingDelta(capabilities: ServerCapabilities): boolean {
  return capabilities.capabilities.enhanced.thinkingDelta;
}

/**
 * Get a human-readable server description
 */
export function getServerDescription(capabilities: ServerCapabilities): string {
  const enhancedFeatures = Object.entries(capabilities.capabilities.enhanced)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  if (capabilities.serverType === 'free' && enhancedFeatures.length > 0) {
    return `Free Server v${capabilities.version} (enhanced: ${enhancedFeatures.join(', ')})`;
  }

  if (capabilities.serverType === 'happy') {
    return `Legacy Server v${capabilities.version} (basic mode)`;
  }

  return `Unknown Server (basic mode)`;
}
