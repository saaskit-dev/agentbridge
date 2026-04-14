import type { Message } from '../sync/typesMessage';

const TIME_GAP_THRESHOLD_MS = 5 * 60 * 1000;

export type ChatListItem =
  | {
      type: 'message-group';
      key: string;
      messageIds: string[];
      primaryMessageId: string;
      createdAt: number;
      role: 'user' | 'assistant';
    }
  | { type: 'date-separator'; label: string; key: string }
  | { type: 'time-separator'; label: string; key: string };

export type ChatUserNavItem = {
  listIndex: number;
  messageId: string;
  seq: number;
  preview: string;
  time: string;
  createdAt: number;
};

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function getLocalDayKey(ts: number): string {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildChatListItems(
  messages: Message[],
  formatDateLabel: (ts: number) => string,
  formatTime: (ts: number) => string
): ChatListItem[] {
  return buildChatListData(messages, formatDateLabel, formatTime).listItems;
}

export function buildChatListData(
  messages: Message[],
  formatDateLabel: (ts: number) => string,
  formatTime: (ts: number) => string
): {
  listItems: ChatListItem[];
  messagesById: Map<string, Message>;
  userNavItems: ChatUserNavItem[];
} {
  const items: ChatListItem[] = [];
  const groups: Array<{
    messageIds: string[];
    primaryMessageId: string;
    createdAt: number;
    role: 'user' | 'assistant';
  }> = [];
  const messagesById = new Map<string, Message>();
  const userInfoById = new Map<string, { text: string; createdAt: number }>();

  const getRole = (message: Message): 'user' | 'assistant' =>
    message.kind === 'user-text' ? 'user' : 'assistant';

  let currentGroup: (typeof groups)[number] | null = null;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    messagesById.set(message.id, message);
    if (message.kind === 'user-text') {
      userInfoById.set(message.id, {
        text: message.displayText || message.text,
        createdAt: message.createdAt,
      });
    }
    const role = getRole(message);
    if (!currentGroup || currentGroup.role !== role) {
      currentGroup = {
        messageIds: [message.id],
        primaryMessageId: message.id,
        createdAt: message.createdAt,
        role,
      };
      groups.push(currentGroup);
    } else {
      currentGroup.messageIds.push(message.id);
      currentGroup.primaryMessageId = message.id;
      currentGroup.createdAt = message.createdAt;
    }
  }

  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const previousGroup = index > 0 ? groups[index - 1] : null;

    if (!previousGroup || !isSameDay(group.createdAt, previousGroup.createdAt)) {
      items.push({
        type: 'date-separator',
        label: formatDateLabel(group.createdAt),
        key: `date-${getLocalDayKey(group.createdAt)}-${group.primaryMessageId}`,
      });
    }

    if (
      previousGroup &&
      isSameDay(group.createdAt, previousGroup.createdAt) &&
      group.createdAt - previousGroup.createdAt > TIME_GAP_THRESHOLD_MS
    ) {
      items.push({
        type: 'time-separator',
        label: formatTime(group.createdAt),
        key: `time-${group.primaryMessageId}`,
      });
    }

    items.push({
      type: 'message-group',
      key: `group-${group.primaryMessageId}`,
      messageIds: group.messageIds,
      primaryMessageId: group.primaryMessageId,
      createdAt: group.createdAt,
      role: group.role,
    });
  }

  items.reverse();
  const userNavItems: ChatUserNavItem[] = [];
  let seq = 1;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item?.type !== 'message-group' || item.role !== 'user') {
      continue;
    }
    const info = userInfoById.get(item.primaryMessageId);
    if (!info) {
      continue;
    }
    const preview = info.text.split('\n').slice(0, 2).join(' ').trim() || '…';
    userNavItems.push({
      listIndex: index,
      messageId: item.primaryMessageId,
      seq: seq++,
      preview,
      time: formatTime(info.createdAt),
      createdAt: info.createdAt,
    });
  }

  return {
    listItems: items,
    messagesById,
    userNavItems,
  };
}
