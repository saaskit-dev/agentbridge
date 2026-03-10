/**
 * Gemini Transport Handler
 *
 * Free-specific extension of core's GeminiTransport.
 * Overrides tool patterns to use `free__` prefix instead of `free__`.
 *
 * @module GeminiTransport
 */

import { GeminiTransport as CoreGeminiTransport } from '@saaskit-dev/agentbridge';
import type { ToolPattern, ToolNameContext } from '@saaskit-dev/agentbridge';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('agent/transport/handlers/GeminiTransport');

/**
 * Free-specific tool name patterns for Gemini CLI.
 * Uses `free__` prefix instead of `free__`.
 */
const FREE_TOOL_PATTERNS: ToolPattern[] = [
  {
    name: 'change_title',
    patterns: ['change_title', 'change-title', 'free__change_title', 'mcp__free__change_title'],
  },
  {
    name: 'save_memory',
    patterns: ['save_memory', 'save-memory'],
  },
  {
    name: 'think',
    patterns: ['think'],
  },
  {
    name: 'codebase_investigator',
    patterns: ['codebase_investigator', 'investigator', 'investigate'],
  },
];

/**
 * Free-specific Gemini transport handler.
 *
 * Extends core's GeminiTransport and overrides:
 * - Tool patterns to use `free__` prefix
 * - determineToolName to use Free-specific patterns
 */
export class GeminiTransport extends CoreGeminiTransport {
  /**
   * Override tool patterns for Free's `free__` prefix
   */
  override getToolPatterns(): ToolPattern[] {
    return FREE_TOOL_PATTERNS;
  }

  /**
   * Override extractToolNameFromId to use Free patterns
   */
  override extractToolNameFromId(toolCallId: string): string | null {
    const lowerId = toolCallId.toLowerCase();

    for (const toolPattern of FREE_TOOL_PATTERNS) {
      for (const pattern of toolPattern.patterns) {
        if (lowerId.includes(pattern.toLowerCase())) {
          return toolPattern.name;
        }
      }
    }

    return null;
  }

  /**
   * Override determineToolName to add Free-specific logging
   */
  override determineToolName(
    toolName: string,
    toolCallId: string,
    input: Record<string, unknown>,
    context: ToolNameContext
  ): string {
    // Use parent implementation for the logic
    const result = super.determineToolName(toolName, toolCallId, input, context);

    // Add Free-specific logging for unknown patterns
    if ((toolName === 'other' || toolName === 'Unknown tool') && result === toolName) {
      const inputKeys = input && typeof input === 'object' ? Object.keys(input) : [];
      logger.debug(
        `[GeminiTransport] Unknown tool pattern - toolCallId: "${toolCallId}", ` +
          `toolName: "${toolName}", inputKeys: [${inputKeys.join(', ')}]`
      );
    }

    return result;
  }
}

/**
 * Singleton instance for convenience
 */
export const geminiTransport = new GeminiTransport();
