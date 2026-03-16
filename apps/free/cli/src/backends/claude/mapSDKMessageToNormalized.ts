/**
 * mapSDKMessageToNormalized
 *
 * Converts Claude SDK messages (from claudeRemote onMessage callback) to the
 * NormalizedMessage format consumed by AgentSession.pipeBackendOutput().
 *
 * Returns null for messages that carry no renderable information (system, log, etc.)
 */

import { createId } from '@paralleldrive/cuid2';
import type { NormalizedMessage, UsageData } from '@/daemon/sessions/types';
import type { SDKMessage, SDKAssistantMessage, SDKUserMessage, SDKResultMessage, SDKSystemMessage } from '@/claude/sdk/types';

function nowMs(): number {
  return Date.now();
}

const base = () => ({ createdAt: nowMs(), isSidechain: false } as const);

export function mapSDKMessageToNormalized(message: SDKMessage): NormalizedMessage[] {
  const results: NormalizedMessage[] = [];

  if (message.type === 'system') {
    const _msg = message as SDKSystemMessage;
    return results;
  }

  if (message.type === 'assistant') {
    const msg = message as SDKAssistantMessage;
    for (const block of msg.message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        results.push({
          ...base(),
          id: createId(),
          role: 'agent',
          content: [{ type: 'text', text: block.text, uuid: createId(), parentUUID: null }],
        });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        results.push({
          ...base(),
          id: createId(),
          role: 'agent',
          content: [{ type: 'thinking', thinking: block.thinking as string, uuid: createId(), parentUUID: null }],
        });
      } else if (block.type === 'tool_use' && typeof block.id === 'string') {
        const name = typeof block.name === 'string' ? block.name : 'unknown';
        results.push({
          ...base(),
          id: createId(),
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
      for (const block of content) {
        if (block.type === 'tool_result') {
          const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
          const isError = block.is_error === true;
          results.push({
            ...base(),
            id: createId(),
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
