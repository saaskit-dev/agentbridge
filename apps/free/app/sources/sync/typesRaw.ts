import { isCuid } from '@paralleldrive/cuid2';
import * as z from 'zod';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { MessageMetaSchema, MessageMeta } from './typesMessageMeta';

const logger = new Logger('app/sync/typesRaw');

//
// Raw types
//

// Usage data type from Claude API
const usageDataSchema = z.object({
  input_tokens: z.number(),
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  output_tokens: z.number(),
  context_used_tokens: z.number().optional(),
  context_window_size: z.number().optional(),
  service_tier: z.string().optional(),
});

export type UsageData = z.infer<typeof usageDataSchema>;

const agentEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('switch'),
    mode: z.enum(['local', 'remote']),
  }),
  z.object({
    type: z.literal('message'),
    message: z.string(),
  }),
  z.object({
    type: z.literal('limit-reached'),
    endsAt: z.number(),
  }),
  z.object({
    type: z.literal('ready'),
    stopReason: z.string().optional(),
  }),
  z.object({
    type: z.literal('status'),
    state: z.enum(['working', 'idle']),
  }),
  z
    .object({
      type: z.literal('token_count'),
    })
    .passthrough(),
  z.object({
    type: z.literal('daemon-log'),
    level: z.enum(['error', 'warn']),
    component: z.string(),
    message: z.string(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('permission_request'),
    requestId: z.string(),
    toolName: z.string(),
    toolInput: z.unknown(),
    permissionMode: z.string(),
  }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

const sessionTextEventSchema = z.object({
  t: z.literal('text'),
  text: z.string(),
  thinking: z.boolean().optional(),
});

const sessionServiceMessageEventSchema = z.object({
  t: z.literal('service'),
  text: z.string(),
});

const sessionToolCallStartEventSchema = z.object({
  t: z.literal('tool-call-start'),
  call: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  args: z.record(z.string(), z.unknown()),
});

const sessionToolCallEndEventSchema = z.object({
  t: z.literal('tool-call-end'),
  call: z.string(),
});

const sessionFileEventSchema = z.object({
  t: z.literal('file'),
  ref: z.string(),
  name: z.string(),
});

const sessionPhotoEventSchema = z.object({
  t: z.literal('photo'),
  ref: z.string(),
  thumbhash: z.string(),
  width: z.number(),
  height: z.number(),
});

const sessionTurnStartEventSchema = z.object({
  t: z.literal('turn-start'),
});

const sessionStartEventSchema = z.object({
  t: z.literal('start'),
  title: z.string().optional(),
});

const sessionTurnEndEventSchema = z.object({
  t: z.literal('turn-end'),
  status: z.enum(['completed', 'failed', 'cancelled']),
});

const sessionStopEventSchema = z.object({
  t: z.literal('stop'),
});

const sessionEventSchema = z.discriminatedUnion('t', [
  sessionTextEventSchema,
  sessionServiceMessageEventSchema,
  sessionToolCallStartEventSchema,
  sessionToolCallEndEventSchema,
  sessionFileEventSchema,
  sessionPhotoEventSchema,
  sessionTurnStartEventSchema,
  sessionStartEventSchema,
  sessionTurnEndEventSchema,
  sessionStopEventSchema,
]);

const sessionEnvelopeSchema = z
  .object({
    id: z.string(),
    time: z.number(),
    role: z.enum(['user', 'agent']),
    turn: z.string().optional(),
    subagent: z
      .string()
      .refine(value => isCuid(value), {
        message: 'subagent must be a cuid2 value',
      })
      .optional(),
    ev: sessionEventSchema,
  })
  .superRefine((envelope, ctx) => {
    if (envelope.ev.t === 'service' && envelope.role !== 'agent') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'service events must use role "agent"',
        path: ['role'],
      });
    }
    if ((envelope.ev.t === 'start' || envelope.ev.t === 'stop') && envelope.role !== 'agent') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${envelope.ev.t} events must use role "agent"`,
        path: ['role'],
      });
    }
  });

const rawTextContentSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
  })
  .passthrough(); // ROBUST: Accept unknown fields for future API compatibility
export type RawTextContent = z.infer<typeof rawTextContentSchema>;

const rawToolUseContentSchema = z
  .object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.any(),
  })
  .passthrough(); // ROBUST: Accept unknown fields preserved by transform
export type RawToolUseContent = z.infer<typeof rawToolUseContentSchema>;

const rawToolResultContentSchema = z
  .object({
    type: z.literal('tool_result'),
    tool_use_id: z.string(),
    content: z
      .union([z.string(), z.array(z.object({ type: z.string() }).passthrough()), z.null()])
      .optional(), // Tool results can contain text strings, arrays of typed blocks, or null
    is_error: z.boolean().optional(),
    permissions: z
      .object({
        date: z.number(),
        result: z.enum(['approved', 'denied']),
        mode: z
          .enum([
            'default',
            'acceptEdits',
            'bypassPermissions',
            'plan',
            'read-only',
            'safe-yolo',
            'yolo',
          ])
          .optional(),
        allowedTools: z.array(z.string()).optional(),
        decision: z.enum(['approved', 'approved_for_session', 'denied', 'abort']).optional(),
      })
      .optional(),
  })
  .passthrough(); // ROBUST: Accept unknown fields for future API compatibility
export type RawToolResultContent = z.infer<typeof rawToolResultContentSchema>;

/**
 * Extended thinking content from Claude API
 * Contains model's reasoning process before generating the final response
 * Uses .passthrough() to preserve signature and other unknown fields
 */
const rawThinkingContentSchema = z
  .object({
    type: z.literal('thinking'),
    thinking: z.string(),
  })
  .passthrough(); // ROBUST: Accept signature and future fields
export type RawThinkingContent = z.infer<typeof rawThinkingContentSchema>;

const normalizedDirectTextContentSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    uuid: z.string(),
    parentUUID: z.string().nullable(),
  })
  .passthrough();

const normalizedDirectThinkingContentSchema = z
  .object({
    type: z.literal('thinking'),
    thinking: z.string(),
    uuid: z.string(),
    parentUUID: z.string().nullable(),
  })
  .passthrough();

const normalizedDirectToolCallContentSchema = z
  .object({
    type: z.literal('tool-call'),
    id: z.string(),
    name: z.string(),
    input: z.any(),
    description: z.string().nullable(),
    uuid: z.string(),
    parentUUID: z.string().nullable(),
  })
  .passthrough();

const normalizedDirectToolResultContentSchema = z
  .object({
    type: z.literal('tool-result'),
    tool_use_id: z.string(),
    content: z.any(),
    is_error: z.boolean(),
    uuid: z.string(),
    parentUUID: z.string().nullable(),
    permissions: z
      .object({
        date: z.number(),
        result: z.enum(['approved', 'denied']),
        mode: z.string().optional(),
        allowedTools: z.array(z.string()).optional(),
        decision: z.enum(['approved', 'approved_for_session', 'denied', 'abort']).optional(),
      })
      .optional(),
  })
  .passthrough();

const normalizedDirectSummaryContentSchema = z
  .object({
    type: z.literal('summary'),
    summary: z.string(),
  })
  .passthrough();

const normalizedDirectSidechainContentSchema = z
  .object({
    type: z.literal('sidechain'),
    uuid: z.string(),
    prompt: z.string(),
  })
  .passthrough();

const normalizedDirectAgentContentSchema = z.discriminatedUnion('type', [
  normalizedDirectTextContentSchema,
  normalizedDirectThinkingContentSchema,
  normalizedDirectToolCallContentSchema,
  normalizedDirectToolResultContentSchema,
  normalizedDirectSummaryContentSchema,
  normalizedDirectSidechainContentSchema,
]);

// ============================================================================
// WOLOG: Type-Safe Content Normalization via Zod Transform
// ============================================================================
// Accepts both hyphenated (Codex/Gemini) and underscore (Claude) formats
// Transforms all to canonical underscore format during validation
// Full type safety - no `unknown` types
// Source: Part D of the Expo Mobile Testing & Package Manager Agnostic System plan
// ============================================================================

/**
 * Hyphenated tool-call format from Codex/Gemini agents
 * Transforms to canonical tool_use format during validation
 * Uses .passthrough() to preserve unknown fields for future API compatibility
 */
const rawHyphenatedToolCallSchema = z
  .object({
    type: z.literal('tool-call'),
    callId: z.string(),
    id: z.string().optional(), // Some messages have both
    name: z.string(),
    input: z.any(),
  })
  .passthrough(); // ROBUST: Accept and preserve unknown fields
type RawHyphenatedToolCall = z.infer<typeof rawHyphenatedToolCallSchema>;

/**
 * Hyphenated tool-call-result format from Codex/Gemini agents
 * Transforms to canonical tool_result format during validation
 * Uses .passthrough() to preserve unknown fields for future API compatibility
 */
const rawHyphenatedToolResultSchema = z
  .object({
    type: z.literal('tool-call-result'),
    callId: z.string(),
    tool_use_id: z.string().optional(), // Some messages have both
    output: z.any(),
    content: z.any().optional(), // Some messages have both
    is_error: z.boolean().optional(),
  })
  .passthrough(); // ROBUST: Accept and preserve unknown fields
type RawHyphenatedToolResult = z.infer<typeof rawHyphenatedToolResultSchema>;

/**
 * Input schema accepting ALL formats (both hyphenated and canonical)
 * Including Claude's extended thinking content type
 */
const rawAgentContentInputSchema = z.discriminatedUnion('type', [
  rawTextContentSchema, // type: 'text' (canonical)
  rawToolUseContentSchema, // type: 'tool_use' (canonical)
  rawToolResultContentSchema, // type: 'tool_result' (canonical)
  rawThinkingContentSchema, // type: 'thinking' (canonical)
  rawHyphenatedToolCallSchema, // type: 'tool-call' (hyphenated)
  rawHyphenatedToolResultSchema, // type: 'tool-call-result' (hyphenated)
]);
type RawAgentContentInput = z.infer<typeof rawAgentContentInputSchema>;

/**
 * Type-safe transform: Hyphenated tool-call → Canonical tool_use
 * ROBUST: Unknown fields preserved via object spread and .passthrough()
 */
function normalizeToToolUse(input: RawHyphenatedToolCall) {
  // Spread preserves all fields from input (passthrough fields included)
  return {
    ...input,
    type: 'tool_use' as const,
    id: input.callId, // Codex uses callId, canonical uses id
  };
}

/**
 * Type-safe transform: Hyphenated tool-call-result → Canonical tool_result
 * ROBUST: Unknown fields preserved via object spread and .passthrough()
 */
function normalizeToToolResult(input: RawHyphenatedToolResult) {
  // Spread preserves all fields from input (passthrough fields included)
  return {
    ...input,
    type: 'tool_result' as const,
    tool_use_id: input.callId, // Codex uses callId, canonical uses tool_use_id
    content: input.output ?? input.content ?? '', // Codex uses output, canonical uses content
    is_error: input.is_error ?? false,
  };
}

/**
 * Schema that accepts both hyphenated and canonical formats.
 * Normalization happens via .preprocess() at root level to avoid Zod v4 "unmergable intersection" issue.
 * See: https://github.com/colinhacks/zod/discussions/2100
 *
 * Accepts: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'tool-call' | 'tool-call-result'
 * All types validated by their respective schemas with .passthrough() for unknown fields
 */
const rawAgentContentSchema = z.union([
  rawTextContentSchema,
  rawToolUseContentSchema,
  rawToolResultContentSchema,
  rawThinkingContentSchema,
  rawHyphenatedToolCallSchema,
  rawHyphenatedToolResultSchema,
]);
export type RawAgentContent = z.infer<typeof rawAgentContentSchema>;

const rawAgentRecordSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('output'),
    data: z.intersection(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('system') }),
        z.object({ type: z.literal('result') }),
        z.object({ type: z.literal('summary'), summary: z.string() }),
        z.object({
          type: z.literal('assistant'),
          message: z.object({
            role: z.literal('assistant'),
            model: z.string(),
            content: z.array(rawAgentContentSchema),
            usage: usageDataSchema.optional(),
          }),
          parent_tool_use_id: z.string().nullable().optional(),
        }),
        z.object({
          type: z.literal('user'),
          message: z.object({
            role: z.literal('user'),
            content: z.union([z.string(), z.array(rawAgentContentSchema)]),
          }),
          parent_tool_use_id: z.string().nullable().optional(),
          toolUseResult: z.any().nullable().optional(),
        }),
      ]),
      z
        .object({
          isSidechain: z.boolean().nullish(),
          isCompactSummary: z.boolean().nullish(),
          isMeta: z.boolean().nullish(),
          uuid: z.string().nullish(),
          parentUuid: z.string().nullish(),
        })
        .passthrough()
    ), // ROBUST: Accept CLI metadata fields (userType, cwd, sessionId, version, gitBranch, slug, requestId, timestamp)
  }),
  z.object({
    type: z.literal('event'),
    id: z.string(),
    data: agentEventSchema,
  }),
  z.object({
    type: z.literal('session'),
    data: sessionEnvelopeSchema,
  }),
  z.object({
    type: z.literal('codex'),
    data: z.discriminatedUnion('type', [
      z.object({ type: z.literal('reasoning'), message: z.string() }),
      z.object({ type: z.literal('message'), message: z.string() }),
      z.object({
        type: z.literal('tool-call'),
        callId: z.string(),
        input: z.any(),
        name: z.string(),
        id: z.string(),
      }),
      z.object({
        type: z.literal('tool-call-result'),
        callId: z.string(),
        output: z.any(),
        id: z.string(),
      }),
    ]),
  }),
  z.object({
    type: z.literal('acp'),
    provider: z.enum(['gemini', 'codex', 'claude', 'opencode']),
    data: z.discriminatedUnion('type', [
      z.object({ type: z.literal('reasoning'), message: z.string() }),
      z.object({ type: z.literal('message'), message: z.string() }),
      z.object({ type: z.literal('thinking'), text: z.string() }),
      z.object({
        type: z.literal('tool-call'),
        callId: z.string(),
        input: z.any(),
        name: z.string(),
        id: z.string(),
      }),
      z.object({
        type: z.literal('tool-result'),
        callId: z.string(),
        output: z.any(),
        id: z.string(),
        isError: z.boolean().optional(),
      }),
      z.object({
        type: z.literal('tool-call-result'),
        callId: z.string(),
        output: z.any(),
        id: z.string(),
      }),
      z.object({
        type: z.literal('file-edit'),
        description: z.string(),
        filePath: z.string(),
        diff: z.string().optional(),
        oldContent: z.string().optional(),
        newContent: z.string().optional(),
        id: z.string(),
      }),
      z.object({
        type: z.literal('terminal-output'),
        data: z.string(),
        callId: z.string(),
      }),
      z.object({ type: z.literal('task_started'), id: z.string() }),
      z.object({ type: z.literal('task_complete'), id: z.string() }),
      z.object({ type: z.literal('turn_aborted'), id: z.string() }),
      z.object({
        type: z.literal('permission-request'),
        permissionId: z.string(),
        toolName: z.string(),
        description: z.string(),
        options: z.any().optional(),
      }),
      z.object({ type: z.literal('token_count') }).passthrough(),
    ]),
  }),
]);

/**
 * Preprocessor: Normalizes hyphenated content types to canonical before validation
 * This avoids Zod v4's "unmergable intersection" issue with transforms inside complex schemas
 * See: https://github.com/colinhacks/zod/discussions/2100
 */
function preprocessMessageContent(data: any): any {
  if (!data || typeof data !== 'object') return data;

  // Helper: normalize a single content item
  const normalizeContent = (item: any): any => {
    if (!item || typeof item !== 'object') return item;

    if (item.type === 'tool-call') {
      return normalizeToToolUse(item);
    }
    if (item.type === 'tool-call-result') {
      return normalizeToToolResult(item);
    }
    return item;
  };

  // Normalize assistant message content
  if (
    data.role === 'agent' &&
    data.content?.type === 'output' &&
    data.content?.data?.message?.content
  ) {
    if (Array.isArray(data.content.data.message.content)) {
      data.content.data.message.content = data.content.data.message.content.map(normalizeContent);
    }
  }

  // Normalize user message content
  if (
    data.role === 'agent' &&
    data.content?.type === 'output' &&
    data.content?.data?.type === 'user' &&
    Array.isArray(data.content.data.message?.content)
  ) {
    data.content.data.message.content = data.content.data.message.content.map(normalizeContent);
  }

  return data;
}

const rawRecordSchema = z.preprocess(
  preprocessMessageContent,
  z.discriminatedUnion('role', [
    z.object({
      role: z.literal('event'),
      content: agentEventSchema,
      isSidechain: z.boolean().optional(),
      traceId: z.string().optional(),
      meta: MessageMetaSchema.optional(),
    }),
    z.object({
      role: z.literal('agent'),
      content: z.union([rawAgentRecordSchema, z.array(normalizedDirectAgentContentSchema)]),
      isSidechain: z.boolean().optional(),
      usage: usageDataSchema.optional(),
      traceId: z.string().optional(),
      meta: MessageMetaSchema.optional(),
    }),
    z.object({
      role: z.literal('user'),
      content: z.union([
        // Standard text content
        z.object({
          type: z.literal('text'),
          text: z.string(),
          attachments: z
            .array(
              z.object({
                id: z.string(),
                mimeType: z.string(),
                thumbhash: z.string().optional(),
                filename: z.string().optional(),
              })
            )
            .optional(),
        }),
        // Session envelope content (from CLI)
        z.object({
          type: z.literal('session'),
          data: sessionEnvelopeSchema,
        }),
      ]),
      isSidechain: z.boolean().optional(),
      traceId: z.string().optional(),
      meta: MessageMetaSchema.optional(),
    }),
  ])
);

export type RawRecord = z.infer<typeof rawRecordSchema>;

// Export schemas for validation
export const RawRecordSchema = rawRecordSchema;

//
// Normalized types
//

type NormalizedAgentContent =
  | {
      type: 'text';
      text: string;
      uuid: string;
      parentUUID: string | null;
    }
  | {
      type: 'thinking';
      thinking: string;
      uuid: string;
      parentUUID: string | null;
    }
  | {
      type: 'tool-call';
      id: string;
      name: string;
      input: any;
      description: string | null;
      uuid: string;
      parentUUID: string | null;
    }
  | {
      type: 'tool-result';
      tool_use_id: string;
      content: any;
      is_error: boolean;
      uuid: string;
      parentUUID: string | null;
      permissions?: {
        date: number;
        result: 'approved' | 'denied';
        mode?: string;
        allowedTools?: string[];
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
      };
    }
  | {
      type: 'summary';
      summary: string;
    }
  | {
      type: 'sidechain';
      uuid: string;
      prompt: string;
    };

export type NormalizedMessage = (
  | {
      role: 'user';
      content: {
        type: 'text';
        text: string;
        attachments?: Array<{
          id: string;
          mimeType: string;
          thumbhash?: string;
          filename?: string;
        }>;
      };
    }
  | {
      role: 'agent';
      content: NormalizedAgentContent[];
    }
  | {
      role: 'event';
      content: AgentEvent;
    }
) & {
  id: string;
  seq?: number; // Server-assigned monotonic sequence number for stable sort
  createdAt: number;
  isSidechain: boolean;
  meta?: MessageMeta;
  usage?: UsageData;
  traceId?: string; // RFC §19.3: propagated from server DB for cross-layer trace correlation
};

export function normalizeRawMessage(
  id: string,
  createdAt: number,
  raw: RawRecord
): NormalizedMessage | null {
  // Zod transform handles normalization during validation
  const parsed = rawRecordSchema.safeParse(raw);
  if (!parsed.success) {
    logger.error(
      'normalizeRawMessage validation failed',
      new Error(JSON.stringify(parsed.error.issues)),
      {
        id,

        createdAt,
      }
    );
    return null;
  }
  raw = parsed.data;
  if (raw.role === 'event') {
    if (raw.content.type === 'token_count') {
      return null;
    }

    return {
      id,

      createdAt,
      role: 'event',
      content: raw.content,
      isSidechain: false,
      meta: raw.meta,
    };
  }
  if (raw.role === 'user') {
    // Handle session envelope content (from CLI)
    if (raw.content.type === 'session') {
      const envelope = raw.content.data;
      // Extract text from session envelope
      if (envelope.ev.t === 'text') {
        return {
          id,

          createdAt,
          role: 'user',
          content: {
            type: 'text',
            text: envelope.ev.text,
          },
          isSidechain: false,
          meta: raw.meta,
          traceId: raw.traceId,
        };
      }
      // Skip other session event types (turn-start, turn-end, etc.)
      return null;
    }
    // Handle standard text content
    const textContent = raw.content as {
      type: 'text';
      text: string;
      attachments?: Array<{ id: string; mimeType: string; thumbhash?: string; filename?: string }>;
    };
    return {
      id,

      createdAt,
      role: 'user',
      content: {
        type: 'text' as const,
        text: textContent.text,
        ...(textContent.attachments?.length && { attachments: textContent.attachments }),
      },
      isSidechain: false,
      meta: raw.meta,
      traceId: raw.traceId,
    };
  }
  if (raw.role === 'agent') {
    if (Array.isArray(raw.content)) {
      return {
        id,

        createdAt,
        role: 'agent',
        isSidechain: raw.isSidechain ?? false,
        content: raw.content as NormalizedAgentContent[],
        meta: raw.meta,
        usage: raw.usage,
        traceId: raw.traceId,
      };
    }

    if (raw.content.type === 'output') {
      // Skip Meta messages
      if (raw.content.data.isMeta) {
        return null;
      }

      // Skip compact summary messages
      if (raw.content.data.isCompactSummary) {
        return null;
      }

      // Handle Assistant messages (including sidechains)
      if (raw.content.data.type === 'assistant') {
        if (!raw.content.data.uuid) {
          return null;
        }
        const content: NormalizedAgentContent[] = [];
        for (const c of raw.content.data.message.content) {
          if (c.type === 'text') {
            content.push({
              ...c, // WOLOG: Preserve all fields including unknown ones
              uuid: raw.content.data.uuid,
              parentUUID: raw.content.data.parentUuid ?? null,
            } as NormalizedAgentContent);
          } else if (c.type === 'thinking') {
            content.push({
              ...c, // WOLOG: Preserve all fields including unknown ones (signature, etc.)
              uuid: raw.content.data.uuid,
              parentUUID: raw.content.data.parentUuid ?? null,
            } as NormalizedAgentContent);
          } else if (c.type === 'tool_use') {
            let description: string | null = null;
            if (
              typeof c.input === 'object' &&
              c.input !== null &&
              'description' in c.input &&
              typeof c.input.description === 'string'
            ) {
              description = c.input.description;
            }
            content.push({
              ...c, // WOLOG: Preserve all fields including unknown ones
              type: 'tool-call',
              description,
              uuid: raw.content.data.uuid,
              parentUUID: raw.content.data.parentUuid ?? null,
            } as NormalizedAgentContent);
          }
        }
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: raw.content.data.isSidechain ?? false,
          content,
          meta: raw.meta,
          usage: raw.content.data.message.usage,
        };
      } else if (raw.content.data.type === 'user') {
        if (!raw.content.data.uuid) {
          return null;
        }

        // Handle sidechain user messages
        if (
          raw.content.data.isSidechain &&
          raw.content.data.message &&
          typeof raw.content.data.message.content === 'string'
        ) {
          // Return as a special agent message with sidechain content
          return {
            id,

            createdAt,
            role: 'agent',
            isSidechain: true,
            content: [
              {
                type: 'sidechain',
                uuid: raw.content.data.uuid,
                prompt: raw.content.data.message.content,
              },
            ],
          };
        }

        // Handle regular user messages
        if (raw.content.data.message && typeof raw.content.data.message.content === 'string') {
          return {
            id,

            createdAt,
            role: 'user',
            isSidechain: false,
            content: {
              type: 'text',
              text: raw.content.data.message.content,
            },
          };
        }

        // Handle tool results
        const content: NormalizedAgentContent[] = [];
        if (typeof raw.content.data.message.content === 'string') {
          content.push({
            type: 'text',
            text: raw.content.data.message.content,
            uuid: raw.content.data.uuid,
            parentUUID: raw.content.data.parentUuid ?? null,
          });
        } else {
          for (const c of raw.content.data.message.content) {
            if (c.type === 'tool_result') {
              content.push({
                ...c, // WOLOG: Preserve all fields including unknown ones
                type: 'tool-result',
                content: raw.content.data.toolUseResult
                  ? raw.content.data.toolUseResult
                  : typeof c.content === 'string'
                    ? c.content
                    : Array.isArray(c.content) && c.content[0]?.type === 'text'
                      ? c.content[0].text
                      : c.content,
                is_error: c.is_error || false,
                uuid: raw.content.data.uuid,
                parentUUID: raw.content.data.parentUuid ?? null,
                permissions: c.permissions
                  ? {
                      date: c.permissions.date,
                      result: c.permissions.result,
                      mode: c.permissions.mode,
                      allowedTools: c.permissions.allowedTools,
                      decision: c.permissions.decision,
                    }
                  : undefined,
              } as NormalizedAgentContent);
            }
          }
        }
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: raw.content.data.isSidechain ?? false,
          content,
          meta: raw.meta,
        };
      }
    }
    if (raw.content.type === 'event') {
      return {
        id,

        createdAt,
        role: 'event',
        content: raw.content.data,
        isSidechain: false,
      };
    }
    if (raw.content.type === 'session') {
      const envelope = raw.content.data;

      // Session protocol requires turn id on all agent-originated envelopes.
      // Drop malformed agent events without turn to avoid attaching stray messages.
      if (envelope.role === 'agent' && !envelope.turn) {
        return null;
      }

      const messageId = envelope.id;
      const messageCreatedAt = envelope.time;
      const parentUUID = envelope.subagent ?? null;
      const isSidechain = parentUUID !== null;
      const contentUUID = envelope.id;

      if (envelope.ev.t === 'turn-start') {
        return null;
      }

      if (envelope.ev.t === 'start' || envelope.ev.t === 'stop') {
        // Lifecycle marker for subagent boundaries; currently not rendered as chat content.
        return null;
      }

      if (envelope.ev.t === 'turn-end') {
        return {
          id: messageId,

          createdAt: messageCreatedAt,
          role: 'event',
          isSidechain: false,
          content: { type: 'ready' },
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }

      if (envelope.ev.t === 'service') {
        if (envelope.role !== 'agent') {
          return null;
        }

        return {
          id: messageId,

          createdAt: messageCreatedAt,
          role: 'agent',
          isSidechain,
          content: [
            {
              type: 'text',
              text: envelope.ev.text,
              uuid: contentUUID,
              parentUUID,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }

      if (envelope.ev.t === 'text') {
        if (envelope.role === 'user') {
          return {
            id: messageId,

            createdAt: messageCreatedAt,
            role: 'user',
            isSidechain: false,
            content: {
              type: 'text',
              text: envelope.ev.text,
            },
            meta: raw.meta,
          } satisfies NormalizedMessage;
        }

        return {
          id: messageId,

          createdAt: messageCreatedAt,
          role: 'agent',
          isSidechain,
          content: [
            envelope.ev.thinking
              ? {
                  type: 'thinking',
                  thinking: envelope.ev.text,
                  uuid: contentUUID,
                  parentUUID,
                }
              : {
                  type: 'text',
                  text: envelope.ev.text,
                  uuid: contentUUID,
                  parentUUID,
                },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }

      if (envelope.ev.t === 'tool-call-start') {
        return {
          id: messageId,

          createdAt: messageCreatedAt,
          role: 'agent',
          isSidechain,
          content: [
            {
              type: 'tool-call',
              id: envelope.ev.call,
              name: envelope.ev.name || 'unknown',
              input: envelope.ev.args,
              description: envelope.ev.description,
              uuid: contentUUID,
              parentUUID,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }

      if (envelope.ev.t === 'tool-call-end') {
        return {
          id: messageId,

          createdAt: messageCreatedAt,
          role: 'agent',
          isSidechain,
          content: [
            {
              type: 'tool-result',
              tool_use_id: envelope.ev.call,
              content: null,
              is_error: false,
              uuid: contentUUID,
              parentUUID,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }

      if (envelope.ev.t === 'file') {
        return {
          id: messageId,

          createdAt: messageCreatedAt,
          role: 'agent',
          isSidechain,
          content: [
            {
              type: 'tool-call',
              id: messageId,
              name: 'file',
              input: {
                ref: envelope.ev.ref,
                name: envelope.ev.name,
              },
              description: `Attached file: ${envelope.ev.name}`,
              uuid: contentUUID,
              parentUUID,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }

      if (envelope.ev.t === 'photo') {
        return {
          id: messageId,

          createdAt: messageCreatedAt,
          role: 'agent',
          isSidechain,
          content: [
            {
              type: 'tool-call',
              id: messageId,
              name: 'photo',
              input: {
                ref: envelope.ev.ref,
                thumbhash: envelope.ev.thumbhash,
                width: envelope.ev.width,
                height: envelope.ev.height,
              },
              description: `Attached photo (${envelope.ev.width}x${envelope.ev.height})`,
              uuid: contentUUID,
              parentUUID,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
    }
    if (raw.content.type === 'codex') {
      if (raw.content.data.type === 'message' || raw.content.data.type === 'reasoning') {
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: false,
          content: [
            {
              type: 'text',
              text: raw.content.data.message,
              uuid: id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === 'tool-call') {
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: false,
          content: [
            {
              type: 'tool-call',
              id: raw.content.data.callId,
              name: raw.content.data.name || 'unknown',
              input: raw.content.data.input,
              description: null,
              uuid: raw.content.data.id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === 'tool-call-result') {
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: false,
          content: [
            {
              type: 'tool-result',
              tool_use_id: raw.content.data.callId,
              content: raw.content.data.output,
              is_error: false,
              uuid: raw.content.data.id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
    }
    if (raw.content.type === 'acp') {
      if (raw.content.data.type === 'message' || raw.content.data.type === 'reasoning') {
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: false,
          content: [
            {
              type: 'text',
              text: raw.content.data.message,
              uuid: id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === 'tool-call') {
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: false,
          content: [
            {
              type: 'tool-call',
              id: raw.content.data.callId,
              name: raw.content.data.name || 'unknown',
              input: raw.content.data.input,
              description: null,
              uuid: raw.content.data.id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === 'tool-result') {
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: false,
          content: [
            {
              type: 'tool-result',
              tool_use_id: raw.content.data.callId,
              content: raw.content.data.output,
              is_error: raw.content.data.isError ?? false,
              uuid: raw.content.data.id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === 'tool-call-result') {
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: false,
          content: [
            {
              type: 'tool-result',
              tool_use_id: raw.content.data.callId,
              content: raw.content.data.output,
              is_error: false,
              uuid: raw.content.data.id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === 'thinking') {
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: false,
          content: [
            {
              type: 'thinking',
              thinking: raw.content.data.text,
              uuid: id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === 'file-edit') {
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: false,
          content: [
            {
              type: 'tool-call',
              id: raw.content.data.id,
              name: 'file-edit',
              input: {
                filePath: raw.content.data.filePath,
                description: raw.content.data.description,
                diff: raw.content.data.diff,
                oldContent: raw.content.data.oldContent,
                newContent: raw.content.data.newContent,
              },
              description: raw.content.data.description,
              uuid: raw.content.data.id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === 'terminal-output') {
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: false,
          content: [
            {
              type: 'tool-result',
              tool_use_id: raw.content.data.callId,
              content: raw.content.data.data,
              is_error: false,
              uuid: id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === 'permission-request') {
        return {
          id,

          createdAt,
          role: 'agent',
          isSidechain: false,
          content: [
            {
              type: 'tool-call',
              id: raw.content.data.permissionId,
              name: raw.content.data.toolName,
              input: raw.content.data.options ?? {},
              description: raw.content.data.description,
              uuid: id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
    }
  }
  return null;
}
