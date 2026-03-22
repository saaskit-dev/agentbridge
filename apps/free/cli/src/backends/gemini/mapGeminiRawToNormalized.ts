/**
 * mapGeminiRawToNormalized — maps AgentMessage (ACP) to NormalizedMessage.
 *
 * Handles all message types emitted by the Gemini ACP backend:
 *   model-output, status, tool-call, tool-result, token-count,
 *   event (thinking), fs-edit, terminal-output,
 *   exec-approval-request, patch-apply-begin, patch-apply-end
 */

import { createId } from '@paralleldrive/cuid2';
import type { AgentMessage } from '@/agent';
import type { NormalizedMessage, UsageData } from '@/daemon/sessions/types';

export function mapGeminiRawToNormalized(msg: AgentMessage): NormalizedMessage | null {
  const id = createId();
  const createdAt = Date.now();
  const base = { id, createdAt, isSidechain: false };
  const m = msg as unknown as Record<string, unknown>;

  switch (msg.type) {
    case 'model-output': {
      const text = msg.textDelta ?? msg.fullText ?? '';
      if (!text) return null;
      return {
        ...base,
        role: 'agent',
        content: [{ type: 'text', text, uuid: id, parentUUID: null }],
      };
    }

    case 'status': {
      if (msg.status === 'running') {
        return { ...base, role: 'event', content: { type: 'status', state: 'working' } };
      }
      if (msg.status === 'idle' || msg.status === 'stopped') {
        return { ...base, role: 'event', content: { type: 'status', state: 'idle' } };
      }
      if (msg.status === 'error') {
        const detail = msg.detail;
        let message = 'Unknown error';
        if (detail) {
          if (typeof detail === 'object') {
            const d = detail as Record<string, unknown>;
            message = String(d.message ?? d.details ?? JSON.stringify(d));
          } else {
            message = String(detail);
          }
        }
        return { ...base, role: 'event', content: { type: 'error', message, retryable: false } };
      }
      return null;
    }

    case 'tool-call': {
      return {
        ...base,
        role: 'agent',
        content: [
          {
            type: 'tool-call',
            id: String(msg.callId),
            name: msg.toolName,
            input: msg.args ?? {},
            description: null,
            uuid: id,
            parentUUID: null,
          },
        ],
      };
    }

    case 'tool-result': {
      const isError =
        msg.result != null && typeof msg.result === 'object' && 'error' in (msg.result as object);
      return {
        ...base,
        role: 'agent',
        content: [
          {
            type: 'tool-result',
            tool_use_id: String(msg.callId),
            content: msg.result,
            is_error: isError,
            uuid: id,
            parentUUID: null,
          },
        ],
      };
    }

    case 'event': {
      if (msg.name === 'thinking') {
        const payload = msg.payload as { text?: string } | undefined;
        const thinking = typeof payload?.text === 'string' ? payload.text : '';
        if (!thinking) return null;
        return {
          ...base,
          role: 'agent',
          content: [{ type: 'thinking', thinking, uuid: id, parentUUID: null }],
        };
      }
      return null;
    }

    case 'fs-edit': {
      const text = msg.diff ? `${msg.description}\n${msg.diff}` : msg.description;
      return {
        ...base,
        role: 'agent',
        content: [{ type: 'text', text, uuid: id, parentUUID: null }],
      };
    }

    case 'terminal-output': {
      return {
        ...base,
        role: 'agent',
        content: [{ type: 'text', text: msg.data, uuid: id, parentUUID: null }],
      };
    }

    default: {
      const type = String(m.type ?? '');

      if (type === 'token-count') {
        const usage: UsageData = {
          input_tokens: Number(m.input_tokens ?? 0),
          output_tokens: Number(m.output_tokens ?? 0),
          ...(m.cache_creation_input_tokens != null
            ? { cache_creation_input_tokens: Number(m.cache_creation_input_tokens) }
            : {}),
          ...(m.cache_read_input_tokens != null
            ? { cache_read_input_tokens: Number(m.cache_read_input_tokens) }
            : {}),
        };
        return { ...base, role: 'event', content: { type: 'token_count', usage } };
      }

      if (type === 'exec-approval-request') {
        const callId = String(m.call_id ?? m.callId ?? id);
        const { call_id: _c, type: _t, ...inputs } = m;
        return {
          ...base,
          role: 'agent',
          content: [
            {
              type: 'tool-call',
              id: callId,
              name: 'CodexBash',
              input: inputs,
              description: null,
              uuid: id,
              parentUUID: null,
            },
          ],
        };
      }

      if (type === 'patch-apply-begin') {
        const callId = String(m.call_id ?? m.callId ?? id);
        return {
          ...base,
          role: 'agent',
          content: [
            {
              type: 'tool-call',
              id: callId,
              name: 'CodexPatch',
              input: { auto_approved: m.auto_approved, changes: m.changes },
              description: null,
              uuid: id,
              parentUUID: null,
            },
          ],
        };
      }

      if (type === 'patch-apply-end') {
        const callId = String(m.call_id ?? m.callId ?? id);
        return {
          ...base,
          role: 'agent',
          content: [
            {
              type: 'tool-result',
              tool_use_id: callId,
              content: { stdout: m.stdout, stderr: m.stderr, success: m.success },
              is_error: !m.success,
              uuid: id,
              parentUUID: null,
            },
          ],
        };
      }

      return null;
    }
  }
}
