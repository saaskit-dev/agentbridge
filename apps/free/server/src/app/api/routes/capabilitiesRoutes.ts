/**
 * Capabilities Routes
 *
 * Exposes server capabilities for client feature detection.
 * This allows free clients to adapt to either free server (enhanced) or legacy server (basic).
 */

import { z } from "zod";
import { type Fastify } from "../types";

// Server version - read from package.json at build time
const SERVER_VERSION = '0.0.1';

// Server capabilities schema
const CapabilitiesSchema = z.object({
  serverType: z.enum(['free', 'happy']),
  version: z.string(),
  capabilities: z.object({
    basic: z.object({
      messages: z.boolean(),
      sessions: z.boolean(),
      machines: z.boolean(),
      artifacts: z.boolean(),
      ephemeral: z.boolean(),
      auth: z.boolean(),
      kv: z.boolean(),
    }),
    enhanced: z.object({
      textDelta: z.boolean(),
      thinkingDelta: z.boolean(),
      realtimeRpc: z.boolean(),
      voiceChat: z.boolean(),
      multiAgent: z.boolean(),
    }),
  }),
});

export type ServerCapabilities = z.infer<typeof CapabilitiesSchema>;

/**
 * Free Server capabilities
 * Includes all enhanced features
 */
const FREE_CAPABILITIES: ServerCapabilities = {
  serverType: 'free',
  version: SERVER_VERSION,
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
      textDelta: true,        // 打字机效果
      thinkingDelta: true,    // Thinking 流式输出
      realtimeRpc: true,      // 实时 RPC
      voiceChat: false,       // 语音聊天 (coming soon)
      multiAgent: false,      // 多 Agent (coming soon)
    },
  },
};

export function capabilitiesRoutes(app: Fastify) {
  /**
   * GET /v1/capabilities
   *
   * Returns server capabilities for feature detection.
   * Free server returns full capabilities.
   * Legacy server does not have this endpoint (404).
   */
  app.get('/v1/capabilities', {
    schema: {
      response: {
        200: CapabilitiesSchema,
      },
    },
  }, async (request, reply) => {
    reply.send(FREE_CAPABILITIES);
  });

  /**
   * GET /v1/capabilities/feature/:name
   *
   * Check if a specific feature is enabled.
   * Useful for quick feature checks without parsing full capabilities.
   */
  app.get('/v1/capabilities/feature/:name', {
    schema: {
      params: z.object({
        name: z.string(),
      }),
      response: {
        200: z.object({
          enabled: z.boolean(),
        }),
        404: z.object({
          error: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    const { name } = request.params;

    // Check basic capabilities
    if (name in FREE_CAPABILITIES.capabilities.basic) {
      reply.send({
        enabled: FREE_CAPABILITIES.capabilities.basic[name as keyof typeof FREE_CAPABILITIES.capabilities.basic],
      });
      return;
    }

    // Check enhanced capabilities
    if (name in FREE_CAPABILITIES.capabilities.enhanced) {
      reply.send({
        enabled: FREE_CAPABILITIES.capabilities.enhanced[name as keyof typeof FREE_CAPABILITIES.capabilities.enhanced],
      });
      return;
    }

    reply.code(404).send({ error: `Unknown capability: ${name}` });
  });
}
