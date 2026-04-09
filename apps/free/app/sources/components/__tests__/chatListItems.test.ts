import { describe, expect, it } from 'vitest';
import type { Message } from '../../sync/typesMessage';
import { buildChatListItems } from '../chatListItems';

function createUserMessage(id: string, createdAt: number, seq: number): Message {
  return {
    kind: 'user-text',
    id,
    createdAt,
    seq,
    text: id,
  };
}

function createAgentText(id: string, createdAt: number, seq: number, text = id): Message {
  return {
    kind: 'agent-text',
    id,
    createdAt,
    seq,
    text,
  };
}

function createToolCall(id: string, createdAt: number, seq: number): Message {
  return {
    kind: 'tool-call',
    id,
    createdAt,
    seq,
    tool: {
      name: 'Read',
      state: 'completed',
      input: {},
      createdAt,
      startedAt: createdAt,
      completedAt: createdAt + 1,
      description: null,
      result: 'ok',
    },
    children: [],
  };
}

describe('buildChatListItems', () => {
  it('keeps assistant message order inside a grouped turn', () => {
    const messages: Message[] = [
      createAgentText('final-text', 1700, 5),
      createToolCall('tool-1', 1600, 4),
      createAgentText('first-text', 1500, 3),
      createUserMessage('user-1', 1000, 1),
    ];

    const items = buildChatListItems(messages, String, String);
    const assistantGroup = items.find(
      item => item.type === 'message-group' && item.role === 'assistant'
    );

    expect(
      assistantGroup && assistantGroup.type === 'message-group'
        ? assistantGroup.messageIds
        : null
    ).toEqual(['first-text', 'tool-1', 'final-text']);
  });

  it('keeps newest group at index zero for inverted list consumption', () => {
    const messages: Message[] = [
      createAgentText('assistant-1', 2000, 2),
      createUserMessage('user-1', 1000, 1),
    ];

    const items = buildChatListItems(messages, String, String);

    expect(items[0]).toMatchObject({
      type: 'message-group',
      primaryMessageId: 'assistant-1',
    });
  });
});
