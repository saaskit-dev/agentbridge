import { describe, expect, it } from 'vitest';
import type { Message } from '../sync/typesMessage';
import { buildChatListData, buildChatListItems } from './chatListItems';

function createUserTextMessage(id: string, createdAt: number, text: string): Message {
  return {
    kind: 'user-text',
    id,
    createdAt,
    text,
  };
}

function createAgentTextMessage(id: string, createdAt: number, text: string): Message {
  return {
    kind: 'agent-text',
    id,
    createdAt,
    text,
  };
}

describe('chatListItems', () => {
  it('derives list items, message map, and user navigation without changing list output', () => {
    const messages: Message[] = [
      createAgentTextMessage('agent-3', 3_000, 'latest reply'),
      createUserTextMessage('user-2', 2_000, 'second line\nmore detail'),
      createAgentTextMessage('agent-2', 1_500, 'older reply'),
      createUserTextMessage('user-1', 1_000, 'first question'),
    ];

    const formatDateLabel = (ts: number) => `date-${ts}`;
    const formatTime = (ts: number) => `time-${ts}`;

    const derived = buildChatListData(messages, formatDateLabel, formatTime);
    const legacyItems = buildChatListItems(messages, formatDateLabel, formatTime);

    expect(derived.listItems).toEqual(legacyItems);
    expect(Array.from(derived.messagesById.keys())).toEqual(['user-1', 'agent-2', 'user-2', 'agent-3']);
    expect(derived.userNavItems).toEqual([
      {
        listIndex: 3,
        messageId: 'user-1',
        seq: 1,
        preview: 'first question',
        time: 'time-1000',
        createdAt: 1_000,
      },
      {
        listIndex: 1,
        messageId: 'user-2',
        seq: 2,
        preview: 'second line more detail',
        time: 'time-2000',
        createdAt: 2_000,
      },
    ]);
  });

  it('reuses previous build structure when newer messages are prepended', () => {
    const baseMessages: Message[] = [
      createAgentTextMessage('agent-3', 3_000, 'latest reply'),
      createUserTextMessage('user-2', 2_000, 'second line\nmore detail'),
      createAgentTextMessage('agent-2', 1_500, 'older reply'),
      createUserTextMessage('user-1', 1_000, 'first question'),
    ];
    const nextMessages: Message[] = [
      createAgentTextMessage('agent-5', 5_000, 'follow-up'),
      createUserTextMessage('user-4', 4_000, 'new prompt'),
      ...baseMessages,
    ];

    const formatDateLabel = (ts: number) => `date-${ts}`;
    const formatTime = (ts: number) => `time-${ts}`;

    buildChatListData(baseMessages, formatDateLabel, formatTime);
    const incremental = buildChatListData(nextMessages, formatDateLabel, formatTime);

    const expected = buildChatListItems(nextMessages, formatDateLabel, formatTime);

    expect(incremental.listItems).toEqual(expected);
    expect(incremental.userNavItems).toEqual([
      {
        listIndex: 5,
        messageId: 'user-1',
        seq: 1,
        preview: 'first question',
        time: 'time-1000',
        createdAt: 1_000,
      },
      {
        listIndex: 3,
        messageId: 'user-2',
        seq: 2,
        preview: 'second line more detail',
        time: 'time-2000',
        createdAt: 2_000,
      },
      {
        listIndex: 1,
        messageId: 'user-4',
        seq: 3,
        preview: 'new prompt',
        time: 'time-4000',
        createdAt: 4_000,
      },
    ]);
  });
});
