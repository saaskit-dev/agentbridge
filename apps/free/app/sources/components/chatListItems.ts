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
  const items: ChatListItem[] = [];
  const groups: Array<{
    messageIds: string[];
    primaryMessageId: string;
    createdAt: number;
    role: 'user' | 'assistant';
  }> = [];

  const getRole = (message: Message): 'user' | 'assistant' =>
    message.kind === 'user-text' ? 'user' : 'assistant';

  let currentGroup: (typeof groups)[number] | null = null;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
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
  return items;
}
