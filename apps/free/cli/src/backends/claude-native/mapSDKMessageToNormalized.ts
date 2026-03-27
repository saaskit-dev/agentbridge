/**
 * mapSDKMessageToNormalized
 *
 * Converts Claude SDK messages (from claudeRemote onMessage callback) to the
 * NormalizedMessage format consumed by AgentSession.pipeBackendOutput().
 *
 * Returns null for messages that carry no renderable information (system, log, etc.)
 *
 * Callers must create a SDKMapperState via createSDKMapperState() and pass it on
 * every call so that open tool calls can be tracked across messages. When the
 * session ends (normally or by abort), call flushSDKOpenToolCalls(state) to emit
 * synthetic tool-result messages for any calls that were never closed.
 */

import { createId } from '@paralleldrive/cuid2';
import type { NormalizedMessage, UsageData } from '@/daemon/sessions/types';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKSystemMessage,
} from '@/claude/sdk/types';

function nowMs(): number {
  return Date.now();
}

const base = () => ({ createdAt: nowMs(), isSidechain: false }) as const;

export type SDKMapperState = {
  /** IDs of tool calls that have been started but not yet closed via tool_result. */
  openToolCallIds: Set<string>;
};

export function createSDKMapperState(): SDKMapperState {
  return { openToolCallIds: new Set() };
}

/**
 * Emits synthetic tool-result (is_error=true) messages for every tool call that
 * was started but never received a tool_result (e.g. the session was aborted).
 * Idempotent — clears the set so calling it twice is safe.
 */
export function flushSDKOpenToolCalls(state: SDKMapperState): NormalizedMessage[] {
  const results: NormalizedMessage[] = [];
  for (const toolUseId of state.openToolCallIds) {
    results.push({
      ...base(),
      id: createId(),
      role: 'agent',
      content: [
        {
          type: 'tool-result',
          tool_use_id: toolUseId,
          content: null,
          is_error: true,
          uuid: createId(),
          parentUUID: null,
        },
      ],
    });
  }
  state.openToolCallIds.clear();
  return results;
}

export function mapSDKMessageToNormalized(
  message: SDKMessage,
  state: SDKMapperState
): NormalizedMessage[] {
  const results: NormalizedMessage[] = [];

  if (message.type === 'system') {
    const _msg = message as SDKSystemMessage;
    return results;
  }

  if (message.type === 'assistant') {
    const msg = message as SDKAssistantMessage;
    // All content blocks from a single API turn share one traceId so the
    // reducer can identify turn boundaries and avoid merging text across turns.
    const turnTraceId = createId();
    for (const block of msg.message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        results.push({
          ...base(),
          id: createId(),
          traceId: turnTraceId,
          role: 'agent',
          content: [{ type: 'text', text: block.text, uuid: createId(), parentUUID: null }],
        });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        results.push({
          ...base(),
          id: createId(),
          traceId: turnTraceId,
          role: 'agent',
          content: [
            {
              type: 'thinking',
              thinking: block.thinking as string,
              uuid: createId(),
              parentUUID: null,
            },
          ],
        });
      } else if (block.type === 'tool_use' && typeof block.id === 'string') {
        const name = typeof block.name === 'string' ? block.name : 'unknown';
        state.openToolCallIds.add(block.id);
        results.push({
          ...base(),
          id: createId(),
          traceId: turnTraceId,
          role: 'agent',
          content: [
            {
              type: 'tool-call',
              id: block.id,
              name,
              input: block.input ?? {},
              description: name,
              uuid: createId(),
              parentUUID: null,
            },
          ],
        });
      }
    }
    return results;
  }

  if (message.type === 'user') {
    const msg = message as SDKUserMessage;
    const content = msg.message.content;
    if (Array.isArray(content)) {
      const turnTraceId = createId();
      for (const block of content) {
        if (block.type === 'tool_result') {
          const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
          const isError = block.is_error === true;
          state.openToolCallIds.delete(toolUseId);
          results.push({
            ...base(),
            id: createId(),
            traceId: turnTraceId,
            role: 'agent',
            content: [
              {
                type: 'tool-result',
                tool_use_id: toolUseId,
                content: block.content,
                is_error: isError,
                uuid: createId(),
                parentUUID: null,
              },
            ],
          });
        }
      }
    }
    return results;
  }

  if (message.type === 'result') {
    const msg = message as SDKResultMessage;

    // Flush any tool calls that are still open — shouldn't happen in normal flow
    // but guards against Claude returning without closing all tool calls.
    results.push(...flushSDKOpenToolCalls(state));

    if (msg.subtype === 'error_max_turns') {
      results.push({
        ...base(),
        id: createId(),
        role: 'event',
        content: {
          type: 'error',
          message: `Maximum turns reached (${msg.num_turns} turns)`,
          retryable: false,
        },
      });
    } else if (msg.subtype === 'error_during_execution') {
      results.push({
        ...base(),
        id: createId(),
        role: 'event',
        content: {
          type: 'error',
          message: `Error during execution (${msg.num_turns} turns before error)`,
          retryable: false,
        },
      });
    }

    if (msg.usage) {
      const usage: UsageData = {
        input_tokens: msg.usage.input_tokens,
        output_tokens: msg.usage.output_tokens,
        cache_read_input_tokens: msg.usage.cache_read_input_tokens,
        cache_creation_input_tokens: msg.usage.cache_creation_input_tokens,
      };
      results.push({
        ...base(),
        id: createId(),
        role: 'event',
        content: { type: 'token_count', usage },
      });
    }

    results.push({
      ...base(),
      id: createId(),
      role: 'event',
      content: { type: 'status', state: 'idle' },
    });
    return results;
  }

  return [];
}
