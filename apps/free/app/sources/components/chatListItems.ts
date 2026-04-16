import type { Message } from '../sync/typesMessage';

const TIME_GAP_THRESHOLD_MS = 5 * 60 * 1000;
const MAX_INCREMENTAL_CACHE_ENTRIES = 4;

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

type ChatGroup = {
  messageIds: string[];
  primaryMessageId: string;
  createdAt: number;
  role: 'user' | 'assistant';
};

type ChatListBuildResult = {
  listItems: ChatListItem[];
  messagesById: Map<string, Message>;
  userNavItems: ChatUserNavItem[];
};

type ChatListBuildCacheEntry = ChatListBuildResult & {
  source: Message[];
  groups: ChatGroup[];
  userInfoById: Map<string, { text: string; createdAt: number }>;
};

const recentBuildCache: ChatListBuildCacheEntry[] = [];

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
  const incrementalResult = buildChatListDataIncremental(messages, formatDateLabel, formatTime);
  if (incrementalResult) {
    return incrementalResult;
  }

  const items: ChatListItem[] = [];
  const groups: ChatGroup[] = [];
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

  const result = {
    listItems: items,
    messagesById,
    userNavItems,
  };

  storeBuildCache({
    ...result,
    source: messages,
    groups,
    userInfoById,
  });

  return result;
}

function buildChatListDataIncremental(
  messages: Message[],
  formatDateLabel: (ts: number) => string,
  formatTime: (ts: number) => string
): ChatListBuildResult | null {
  const previous = findIncrementalBase(messages);
  if (!previous) {
    return null;
  }

  const prependedCount = messages.length - previous.source.length;
  if (prependedCount <= 0) {
    return null;
  }

  const groups = previous.groups.map(group => ({
    ...group,
    messageIds: [...group.messageIds],
  }));
  const messagesById = new Map(previous.messagesById);
  const userInfoById = new Map(previous.userInfoById);
  const prependedMessages = messages.slice(0, prependedCount);

  appendMessagesToGroups(groups, prependedMessages, messagesById, userInfoById);

  const previousLastGroup = previous.groups[previous.groups.length - 1] ?? null;
  const newGroups = groups.slice(previous.groups.length);
  const nextChronologicalItems = buildChronologicalItemsForGroups(
    newGroups,
    previousLastGroup,
    formatDateLabel,
    formatTime
  );
  const prependedItems = [...nextChronologicalItems].reverse();
  const listItems = [...prependedItems, ...previous.listItems];

  const shiftedUserNavItems =
    prependedItems.length === 0
      ? previous.userNavItems
      : previous.userNavItems.map(item => ({
          ...item,
          listIndex: item.listIndex + prependedItems.length,
        }));

  const nextUserNavItems = buildUserNavItemsFromChronologicalItems(
    nextChronologicalItems,
    prependedItems.length,
    shiftedUserNavItems.length,
    userInfoById,
    formatTime
  );
  const userNavItems = [...shiftedUserNavItems, ...nextUserNavItems];

  const result = {
    listItems,
    messagesById,
    userNavItems,
  };

  storeBuildCache({
    ...result,
    source: messages,
    groups,
    userInfoById,
  });

  return result;
}

function appendMessagesToGroups(
  groups: ChatGroup[],
  prependedMessages: Message[],
  messagesById: Map<string, Message>,
  userInfoById: Map<string, { text: string; createdAt: number }>
) {
  const getRole = (message: Message): 'user' | 'assistant' =>
    message.kind === 'user-text' ? 'user' : 'assistant';

  let currentGroup = groups[groups.length - 1] ?? null;

  for (let index = prependedMessages.length - 1; index >= 0; index -= 1) {
    const message = prependedMessages[index]!;
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
      continue;
    }

    currentGroup.messageIds.push(message.id);
    currentGroup.primaryMessageId = message.id;
    currentGroup.createdAt = message.createdAt;
  }
}

function buildChronologicalItemsForGroups(
  groups: ChatGroup[],
  previousGroup: ChatGroup | null,
  formatDateLabel: (ts: number) => string,
  formatTime: (ts: number) => string
): ChatListItem[] {
  const items: ChatListItem[] = [];
  let priorGroup = previousGroup;

  for (const group of groups) {
    if (!priorGroup || !isSameDay(group.createdAt, priorGroup.createdAt)) {
      items.push({
        type: 'date-separator',
        label: formatDateLabel(group.createdAt),
        key: `date-${getLocalDayKey(group.createdAt)}-${group.primaryMessageId}`,
      });
    }

    if (
      priorGroup &&
      isSameDay(group.createdAt, priorGroup.createdAt) &&
      group.createdAt - priorGroup.createdAt > TIME_GAP_THRESHOLD_MS
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

    priorGroup = group;
  }

  return items;
}

function buildUserNavItemsFromChronologicalItems(
  chronologicalItems: ChatListItem[],
  prependedItemsCount: number,
  existingUserItemCount: number,
  userInfoById: Map<string, { text: string; createdAt: number }>,
  formatTime: (ts: number) => string
): ChatUserNavItem[] {
  const userGroups = chronologicalItems.filter(
    (item): item is Extract<ChatListItem, { type: 'message-group' }> =>
      item.type === 'message-group' && item.role === 'user'
  );

  return userGroups.map((item, index) => {
    const info = userInfoById.get(item.primaryMessageId);
    const preview = info ? info.text.split('\n').slice(0, 2).join(' ').trim() || '…' : '…';
    return {
      listIndex: prependedItemsCount - 1 - chronologicalItems.indexOf(item),
      messageId: item.primaryMessageId,
      seq: existingUserItemCount + index + 1,
      preview,
      time: formatTime(info?.createdAt ?? item.createdAt),
      createdAt: info?.createdAt ?? item.createdAt,
    };
  });
}

function findIncrementalBase(messages: Message[]): ChatListBuildCacheEntry | null {
  for (const entry of recentBuildCache) {
    const prependedCount = messages.length - entry.source.length;
    if (prependedCount <= 0) {
      continue;
    }

    let matches = true;
    for (let index = 0; index < entry.source.length; index += 1) {
      if (messages[index + prependedCount] !== entry.source[index]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return entry;
    }
  }

  return null;
}

function storeBuildCache(entry: ChatListBuildCacheEntry) {
  const existingIndex = recentBuildCache.findIndex(candidate => candidate.source === entry.source);
  if (existingIndex >= 0) {
    recentBuildCache.splice(existingIndex, 1);
  }
  recentBuildCache.unshift(entry);
  if (recentBuildCache.length > MAX_INCREMENTAL_CACHE_ENTRIES) {
    recentBuildCache.length = MAX_INCREMENTAL_CACHE_ENTRIES;
  }
}
