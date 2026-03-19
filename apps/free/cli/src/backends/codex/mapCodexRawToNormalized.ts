/**
 * mapCodexRawToNormalized
 *
 * Converts raw Codex MCP notification events (from `codex/event`) to the
 * NormalizedMessage format consumed by AgentSession.pipeBackendOutput().
 *
 * Returns null for events that carry no renderable information (e.g. internal
 * lifecycle events without data that doesn't need to surface to the App).
 */

import { createId } from '@paralleldrive/cuid2';
import { randomUUID } from 'node:crypto';
import type { NormalizedMessage, UsageData } from '@/daemon/sessions/types';

function nowMs(): number {
  return Date.now();
}

function pickCallId(message: Record<string, unknown>): string {
  const callId = message.call_id ?? message.callId;
  if (typeof callId === 'string' && callId.length > 0) return callId;
  return randomUUID();
}

function summarizeCommand(command: unknown): string | null {
  if (typeof command === 'string' && command.trim().length > 0) return command;
  if (Array.isArray(command)) {
    const cmd = command
      .map(v => String(v))
      .join(' ')
      .trim();
    return cmd.length > 0 ? cmd : null;
  }
  return null;
}

function commandToTitle(command: string | null): string {
  if (!command) return 'Run command';
  const short = command.length > 80 ? `${command.slice(0, 77)}...` : command;
  return `Run \`${short}\``;
}

function patchDescription(changes: unknown): string {
  if (!changes || typeof changes !== 'object') return 'Applying patch';
  const fileCount = Object.keys(changes as Record<string, unknown>).length;
  if (fileCount === 1) return 'Applying patch to 1 file';
  return `Applying patch to ${fileCount} files`;
}

export function mapCodexRawToNormalized(
  message: Record<string, unknown>
): NormalizedMessage | null {
  const type = message.type;
  const id = createId();
  const createdAt = nowMs();
  const base = { id, createdAt, isSidechain: false } as const;

  if (type === 'task_started') {
    return {
      ...base,
      role: 'event',
      content: { type: 'status', state: 'working' },
    };
  }

  if (type === 'task_complete' || type === 'turn_aborted') {
    return {
      ...base,
      role: 'event',
      content: { type: 'status', state: 'idle' },
    };
  }

  if (type === 'token_count') {
    const rawUsage = message.usage as Record<string, unknown> | undefined;
    if (!rawUsage) return null;
    const usage: UsageData = {
      input_tokens: (rawUsage.input_tokens as number) ?? 0,
      output_tokens: (rawUsage.output_tokens as number) ?? 0,
      cache_creation_input_tokens: rawUsage.cache_creation_input_tokens as number | undefined,
      cache_read_input_tokens: rawUsage.cache_read_input_tokens as number | undefined,
    };
    return {
      ...base,
      role: 'event',
      content: { type: 'token_count', usage },
    };
  }

  if (type === 'agent_message') {
    if (typeof message.message !== 'string') return null;
    const msgText = message.message;

    try {
      const parsed = JSON.parse(msgText);
      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.code !== undefined &&
        parsed.message !== undefined
      ) {
        const errorMsg = (parsed.data as Record<string, unknown>)?.message ?? parsed.message;
        return {
          ...base,
          role: 'event',
          content: { type: 'error', message: String(errorMsg), retryable: false },
        };
      }
    } catch {
      /* not JSON, fall through */
    }

    return {
      ...base,
      role: 'agent',
      content: [{ type: 'text', text: msgText, uuid: createId(), parentUUID: null }],
    };
  }

  if (type === 'agent_reasoning' || type === 'agent_reasoning_delta') {
    const text =
      typeof message.text === 'string'
        ? message.text
        : typeof message.delta === 'string'
          ? message.delta
          : null;
    if (!text) return null;
    return {
      ...base,
      role: 'agent',
      content: [{ type: 'thinking', thinking: text, uuid: createId(), parentUUID: null }],
    };
  }

  if (type === 'exec_command_begin' || type === 'exec_approval_request') {
    const callId = pickCallId(message);
    const { call_id: _a, callId: _b, type: _t, ...args } = message;
    const command = summarizeCommand((args as Record<string, unknown>).command);
    const description =
      typeof (args as Record<string, unknown>).description === 'string'
        ? (args as Record<string, string>).description
        : (command ?? 'Execute command');
    return {
      ...base,
      role: 'agent',
      content: [
        {
          type: 'tool-call',
          id: callId,
          name: 'CodexBash',
          input: args,
          description,
          uuid: createId(),
          parentUUID: null,
        },
      ],
    };
  }

  if (type === 'patch_apply_begin') {
    const callId = pickCallId(message);
    const changes = (message as { changes?: unknown }).changes;
    const description = patchDescription(changes);
    const autoApproved = (message as { auto_approved?: unknown }).auto_approved;
    return {
      ...base,
      role: 'agent',
      content: [
        {
          type: 'tool-call',
          id: callId,
          name: 'CodexPatch',
          input: { auto_approved: autoApproved, changes },
          description,
          uuid: createId(),
          parentUUID: null,
        },
      ],
    };
  }

  // exec_command_end, patch_apply_end, and all other events: no renderable output
  return null;
}
