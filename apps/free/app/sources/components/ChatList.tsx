import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { ChatFooter } from './ChatFooter';
import { layout } from './layout';
import { MessageView } from './MessageView';
import { useSession, useSessionMessages, useMessage } from '@/sync/storage';
import { Metadata, Session } from '@/sync/storageTypes';
import { Message } from '@/sync/typesMessage';
import { sync } from '@/sync/sync';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type PullState = 'idle' | 'pulling' | 'ready' | 'loading';

const PULL_THRESHOLD = 80;
const PULL_MIN = 10;
const MIN_LOADING_MS = 300;
/** Scroll offset threshold to consider user "at bottom" (inverted: y ≈ 0). */
const AT_BOTTOM_THRESHOLD = 80;
/** Minimum time gap (ms) between consecutive messages to show a timestamp separator. */
const TIME_GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

type UserNavItem = { listIndex: number; messageId: string; seq: number; preview: string; time: string };
const FAB_SIZE = 40;
const FAB_GAP = 12;
const logger = new Logger('app/components/ChatList');

// ---------------------------------------------------------------------------
// Date / time helpers
// ---------------------------------------------------------------------------

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function formatDateLabel(ts: number): string {
  const now = Date.now();
  if (isSameDay(ts, now)) return t('chatList.today');
  const yesterday = now - 86_400_000;
  if (isSameDay(ts, yesterday)) return t('chatList.yesterday');
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(ts).getFullYear() !== new Date(now).getFullYear() ? 'numeric' : undefined,
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// List item types (messages + separators)
// ---------------------------------------------------------------------------

type ListItem =
  | { type: 'message'; messageId: string }
  | { type: 'date-separator'; label: string; key: string }
  | { type: 'time-separator'; label: string; key: string };

function buildListItems(messages: Message[]): ListItem[] {
  // Messages are sorted newest-first. In the inverted FlatList, data[0] = visual bottom.
  // We iterate from oldest (end) to newest (start) to insert separators correctly.

  const items: ListItem[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const prevMsg = i < messages.length - 1 ? messages[i + 1] : null; // older neighbor

    // Date separator: if this message is on a different day from the previous one
    if (!prevMsg || !isSameDay(msg.createdAt, prevMsg.createdAt)) {
      items.push({
        type: 'date-separator',
        label: formatDateLabel(msg.createdAt),
        key: `date-${Math.floor(msg.createdAt / 86_400_000)}`,
      });
    }

    // Time gap separator: same day but > TIME_GAP_THRESHOLD_MS since previous message
    if (
      prevMsg &&
      isSameDay(msg.createdAt, prevMsg.createdAt) &&
      msg.createdAt - prevMsg.createdAt > TIME_GAP_THRESHOLD_MS
    ) {
      items.push({
        type: 'time-separator',
        label: formatTime(msg.createdAt),
        key: `time-${msg.id}`,
      });
    }

    items.push({ type: 'message', messageId: msg.id });
  }

  // Reverse so newest is at index 0 (matches inverted FlatList expectation)
  items.reverse();
  return items;
}

// ---------------------------------------------------------------------------
// Pull-to-action pill
// ---------------------------------------------------------------------------

const PullPill = React.memo(
  (props: {
    state: PullState;
    readyText: string;
    pullingText: string;
    loadingText: string;
    position: 'top' | 'bottom';
  }) => {
    const { theme } = useUnistyles();
    if (props.state === 'idle') return null;

    return (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          [props.position]: 8,
          left: 0,
          right: 0,
          alignItems: 'center',
          zIndex: 10,
        }}
      >
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 16,
            paddingHorizontal: 14,
            paddingVertical: 7,
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {props.state === 'loading' && (
            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
          )}
          <Text
            style={{
              fontSize: 12,
              color: props.state === 'ready' ? theme.colors.text : theme.colors.textSecondary,
              fontWeight: props.state === 'ready' ? '600' : '400',
              ...Typography.default(),
            }}
          >
            {props.state === 'loading'
              ? props.loadingText
              : props.state === 'ready'
                ? props.readyText
                : props.pullingText}
          </Text>
        </View>
      </View>
    );
  }
);

// ---------------------------------------------------------------------------
// Shared FAB system — all floating buttons use ChatFab + ChatFabStack
// ---------------------------------------------------------------------------

/** Unified floating action button. All FABs share this size/shadow/shape. */
const ChatFab = React.memo(
  (props: {
    onPress: () => void;
    accessibilityLabel?: string;
    children: React.ReactNode;
  }) => {
    const { theme } = useUnistyles();
    return (
      <Pressable
        onPress={props.onPress}
        style={({ pressed }) => ({
          width: FAB_SIZE,
          height: FAB_SIZE,
          borderRadius: FAB_SIZE / 2,
          backgroundColor: theme.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 6,
          opacity: pressed ? 0.7 : 1,
        })}
        accessibilityLabel={props.accessibilityLabel}
      >
        {props.children}
      </Pressable>
    );
  }
);

/** Stacks FABs vertically from the bottom-right corner (first child = bottom). */
const ChatFabStack = React.memo((props: { children: React.ReactNode }) => {
  const { width: screenWidth } = useWindowDimensions();
  // Align FAB with the right edge of the maxWidth content area on wide screens
  const fabRight =
    layout.maxWidth < screenWidth
      ? Math.max(16, (screenWidth - layout.maxWidth) / 2 + 16)
      : 16;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: 16,
        right: fabRight,
        zIndex: 20,
        flexDirection: 'column-reverse',
        alignItems: 'center',
        gap: FAB_GAP,
      }}
    >
      {props.children}
    </View>
  );
});

/** Unread message count badge for the scroll-to-bottom FAB. */
const UnreadBadge = React.memo((props: { count: number }) => {
  const { theme } = useUnistyles();
  if (props.count <= 0) return null;
  return (
    <View
      style={{
        position: 'absolute',
        top: -4,
        right: -4,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: theme.colors.button.primary.background,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
      }}
    >
      <Text
        style={{
          fontSize: 10,
          fontWeight: '700',
          color: '#fff',
          ...Typography.default('semiBold'),
        }}
      >
        {props.count > 99 ? '99+' : props.count}
      </Text>
    </View>
  );
});

// ---------------------------------------------------------------------------
// User-message navigation panel (command-palette style)
// ---------------------------------------------------------------------------

/** Centered overlay card listing user messages — styled after CommandPalette. */
const UserMessageNavPanel = React.memo(
  (props: {
    items: UserNavItem[];
    onJumpTo: (messageId: string) => void;
    onClose: () => void;
    hasMoreMessages: boolean;
  }) => {
    const { theme } = useUnistyles();
    const { items, onJumpTo, onClose, hasMoreMessages } = props;
    const [query, setQuery] = useState('');
    const hasSearch = items.length > 8;
    const borderColor = theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const subtleBackground = theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
    const pressedBackground = theme.dark ? 'rgba(255,255,255,0.08)' : '#F0F7FF';

    const filtered = useMemo(() => {
      if (!query.trim()) return items;
      const lowerQ = query.trim().toLowerCase();
      return items.filter((it) => it.preview.toLowerCase().includes(lowerQ));
    }, [items, query]);

    return (
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 25,
          justifyContent: 'flex-start',
          alignItems: 'center',
          paddingTop: Platform.OS === 'web' ? ('20%' as any) : 120,
          paddingHorizontal: 20,
        }}
      >
        {/* Backdrop */}
        <Pressable
          onPress={onClose}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 15, 15, 0.5)',
          }}
        />

        {/* Card */}
        <View
          style={{
            zIndex: 1,
            width: '100%',
            maxWidth: 480,
            maxHeight: Platform.OS === 'web' ? ('50vh' as any) : 400,
            backgroundColor: theme.colors.surface,
            borderRadius: 16,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 20 },
            shadowOpacity: 0.25,
            shadowRadius: 40,
            elevation: 20,
            borderWidth: 1,
            borderColor: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
          }}
        >
          {/* Header — search input only appears when > 8 messages */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: 16,
              paddingRight: 14,
              paddingVertical: 4,
              borderBottomWidth: 1,
              borderBottomColor: borderColor,
              gap: 8,
            }}
          >
            <Ionicons
              name={hasSearch ? 'search' : 'chatbubbles-outline'}
              size={16}
              color={theme.colors.textSecondary}
            />
            {hasSearch ? (
              <TextInput
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  fontSize: 15,
                  color: theme.colors.text,
                  letterSpacing: -0.2,
                  ...Typography.default(),
                }}
                value={query}
                onChangeText={setQuery}
                placeholder={`Search ${items.length} messages…`}
                placeholderTextColor={theme.colors.textSecondary}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="done"
              />
            ) : (
              <Text
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  fontSize: 14,
                  color: theme.colors.textSecondary,
                  ...Typography.default(),
                }}
              >
                {`${items.length} messages`}
              </Text>
            )}
            {query.length > 0 && (
              <Text
                style={{ fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() }}
              >
                {filtered.length}/{items.length}
              </Text>
            )}
            <Pressable onPress={query ? () => setQuery('') : onClose} hitSlop={8}>
              <Ionicons
                name={query ? 'close-circle' : 'close'}
                size={query ? 18 : 20}
                color={theme.colors.textSecondary}
              />
            </Pressable>
          </View>

          {/* Incomplete-load hint */}
          {hasMoreMessages && !query && (
            <View
              style={{
                paddingHorizontal: 16,
                paddingVertical: 6,
                backgroundColor: theme.dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                borderBottomWidth: 1,
                borderBottomColor: borderColor,
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  color: theme.colors.textSecondary,
                  ...Typography.default(),
                }}
              >
                {t('chatList.navPanelPartialHint')}
              </Text>
            </View>
          )}

          {/* Message list */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingVertical: 4 }}
          >
            {filtered.length === 0 ? (
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <Text
                  style={{
                    fontSize: 14,
                    color: theme.colors.textSecondary,
                    ...Typography.default(),
                  }}
                >
                  No matching messages
                </Text>
              </View>
            ) : (
              filtered.map((item, i) => (
                <Pressable
                  key={`unav-${item.listIndex}`}
                  onPress={() => onJumpTo(item.messageId)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    marginHorizontal: 8,
                    borderRadius: 8,
                    backgroundColor: pressed ? pressedBackground : 'transparent',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    borderBottomWidth: i < filtered.length - 1 ? 0.5 : 0,
                    borderBottomColor: borderColor,
                  })}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: subtleBackground,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '600',
                        color: theme.colors.textSecondary,
                        ...Typography.default('semiBold'),
                      }}
                    >
                      {item.seq}
                    </Text>
                  </View>

                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 14,
                        color: theme.colors.text,
                        lineHeight: 20,
                        letterSpacing: -0.2,
                        ...Typography.default(),
                      }}
                    >
                      {item.preview}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: theme.colors.textSecondary,
                        ...Typography.default(),
                      }}
                    >
                      {item.time}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    );
  }
);

// ---------------------------------------------------------------------------
// Separator components
// ---------------------------------------------------------------------------

const DateSeparator = React.memo((props: { label: string }) => {
  const { theme } = useUnistyles();
  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: 12,
        flexDirection: 'row',
        paddingHorizontal: 32,
        gap: 12,
      }}
    >
      <View style={{ flex: 1, height: 0.5, backgroundColor: theme.colors.divider }} />
      <Text
        style={{
          fontSize: 12,
          color: theme.colors.textSecondary,
          fontWeight: '500',
          ...Typography.default('semiBold'),
        }}
      >
        {props.label}
      </Text>
      <View style={{ flex: 1, height: 0.5, backgroundColor: theme.colors.divider }} />
    </View>
  );
});

const TimeSeparator = React.memo((props: { label: string }) => {
  const { theme } = useUnistyles();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 6 }}>
      <Text
        style={{
          fontSize: 11,
          color: theme.colors.textSecondary,
          ...Typography.default(),
        }}
      >
        {props.label}
      </Text>
    </View>
  );
});

// ---------------------------------------------------------------------------
// List chrome
// ---------------------------------------------------------------------------

export const ChatList = React.memo((props: { session: Session; footerNotice?: string | null }) => {
  return (
    <ChatListInternal
      metadata={props.session.metadata}
      sessionId={props.session.id}
      footerNotice={props.footerNotice}
    />
  );
});

const OlderMessagesLoader = React.memo((props: { isLoading: boolean }) => {
  if (!props.isLoading) return null;
  return (
    <View style={{ alignItems: 'center', paddingVertical: 12 }}>
      <ActivityIndicator size="small" />
    </View>
  );
});

const ListFooter = React.memo((props: { sessionId: string; notice?: string | null }) => {
  const session = useSession(props.sessionId)!;
  return (
    <ChatFooter
      controlledByUser={session.agentState?.controlledByUser || false}
      notice={props.notice}
    />
  );
});

// ---------------------------------------------------------------------------
// Per-message row — subscribes to a single message, isolated re-render
// ---------------------------------------------------------------------------

const MessageRow = React.memo(
  (props: { sessionId: string; messageId: string; metadata: Metadata | null }) => {
    const message = useMessage(props.sessionId, props.messageId);
    if (!message) return null;
    return (
      <MessageView
        message={message}
        metadata={props.metadata}
        sessionId={props.sessionId}
      />
    );
  }
);

// ---------------------------------------------------------------------------
// Main list
// ---------------------------------------------------------------------------

const ChatListInternal = React.memo(
  (props: {
    metadata: Metadata | null;
    sessionId: string;
    footerNotice?: string | null;
  }) => {
    const { messages, hasOlderMessages, isLoadingOlder } = useSessionMessages(props.sessionId);
    useEffect(() => {
      logger.debug('[chat-list] mounted', { sessionId: props.sessionId });
      return () => {
        logger.debug('[chat-list] unmounted', { sessionId: props.sessionId });
      };
    }, [props.sessionId]);

    // ----- pull states -----
    const [refreshPull, setRefreshPull] = useState<PullState>('idle');
    const [olderPull, setOlderPull] = useState<PullState>('idle');
    const refreshRef = useRef<PullState>('idle');
    const olderRef = useRef<PullState>('idle');
    useEffect(() => { refreshRef.current = refreshPull; }, [refreshPull]);
    useEffect(() => { olderRef.current = olderPull; }, [olderPull]);

    const setPull = useCallback(
      (which: 'refresh' | 'older', next: PullState) => {
        const ref = which === 'refresh' ? refreshRef : olderRef;
        if (ref.current === next) return;
        ref.current = next;
        (which === 'refresh' ? setRefreshPull : setOlderPull)(next);
      },
      []
    );

    const triggerLoad = useCallback(
      (which: 'refresh' | 'older', action: () => Promise<void>) => {
        setPull(which, 'loading');
        const start = Date.now();
        action().finally(() => {
          const elapsed = Date.now() - start;
          const remaining = MIN_LOADING_MS - elapsed;
          if (remaining > 0) {
            setTimeout(() => setPull(which, 'idle'), remaining);
          } else {
            setPull(which, 'idle');
          }
        });
      },
      [setPull]
    );

    // ----- scroll position tracking -----
    const prevY = useRef(-1);
    const flatListRef = useRef<FlatList>(null);
    const isAtBottom = useRef(true);
    /** Set during programmatic scrollToIndex to suppress onEndReached. */
    const isProgrammaticScrollRef = useRef(false);
    /** Always reflects the latest listItems for jump-by-messageId. */
    const listItemsRef = useRef<ListItem[]>([]);
    const [showScrollFab, setShowScrollFab] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [navOpen, setNavOpen] = useState(false);
    const { theme } = useUnistyles();
    const showScrollFabRef = useRef(false);
    const unreadCountRef = useRef(0);

    const updateShowScrollFab = useCallback((next: boolean) => {
      if (showScrollFabRef.current === next) return;
      showScrollFabRef.current = next;
      setShowScrollFab(next);
    }, []);

    const updateUnreadCount = useCallback((next: number | ((prev: number) => number)) => {
      const resolved =
        typeof next === 'function' ? next(unreadCountRef.current) : next;
      if (unreadCountRef.current === resolved) return;
      unreadCountRef.current = resolved;
      setUnreadCount(resolved);
    }, []);

    // ----- unified scroll handler -----
    const handleScroll = useCallback(
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        const maxScroll = contentSize.height - layoutMeasurement.height;
        const y = contentOffset.y;
        const prev = prevY.current;
        prevY.current = y;

        const wasAtBottom = isAtBottom.current;
        isAtBottom.current = y <= AT_BOTTOM_THRESHOLD;

        // Show/hide scroll-to-bottom FAB
        if (isAtBottom.current) {
          updateShowScrollFab(false);
          if (!wasAtBottom) updateUnreadCount(0);
        } else {
          updateShowScrollFab(true);
        }

        // --- Native overscroll pull indicators ---
        if (refreshRef.current !== 'loading') {
          if (y < -PULL_THRESHOLD) setPull('refresh', 'ready');
          else if (y < -PULL_MIN) setPull('refresh', 'pulling');
          else setPull('refresh', 'idle');
        }
        if (olderRef.current !== 'loading') {
          const over = maxScroll > 0 ? y - maxScroll : 0;
          if (over > PULL_THRESHOLD) setPull('older', 'ready');
          else if (over > PULL_MIN) setPull('older', 'pulling');
          else setPull('older', 'idle');
        }

        // --- Edge-arrival detection ---
        if (prev > 50 && y <= 2 && refreshRef.current === 'idle') {
          triggerLoad('refresh', () => sync.refreshMessages(props.sessionId));
        }
        if (
          maxScroll > 0 &&
          prev < maxScroll - 50 &&
          y >= maxScroll - 5 &&
          olderRef.current === 'idle' &&
          !isLoadingOlder
        ) {
          triggerLoad('older', () => sync.loadOlderMessages(props.sessionId));
        }
      },
      [setPull, triggerLoad, props.sessionId, isLoadingOlder, updateShowScrollFab, updateUnreadCount]
    );

    const handleScrollEndDrag = useCallback(() => {
      // User manually dragged — cancel any programmatic scroll suppression
      isProgrammaticScrollRef.current = false;
      if (refreshRef.current === 'ready') {
        triggerLoad('refresh', () => sync.refreshMessages(props.sessionId));
      }
      if (olderRef.current === 'ready' && !isLoadingOlder) {
        triggerLoad('older', () => sync.loadOlderMessages(props.sessionId));
      }
    }, [props.sessionId, isLoadingOlder, triggerLoad]);

    // ----- auto-scroll / unread tracking -----
    const prevMessageIdsRef = useRef(new Set<string>(messages.map(message => message.id)));
    useEffect(() => {
      const prevIds = prevMessageIdsRef.current;
      const relevantNewMessages: Message[] = [];
      for (const message of messages) {
        if (prevIds.has(message.id)) {
          break;
        }
        relevantNewMessages.push(message);
      }

      if (relevantNewMessages.length > 0) {
        if (isAtBottom.current) {
          requestAnimationFrame(() => {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
          });
        } else {
          updateUnreadCount(prev => prev + relevantNewMessages.length);
        }
      }

      prevMessageIdsRef.current = new Set(messages.map(message => message.id));
    }, [messages, updateUnreadCount]);

    const handleScrollToBottom = useCallback(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      updateShowScrollFab(false);
      updateUnreadCount(0);
    }, [updateShowScrollFab, updateUnreadCount]);

    /** Jump to a message by id. Looks up the current index to avoid stale-index bugs. */
    const handleJumpToUserMessage = useCallback((messageId: string) => {
      const index = listItemsRef.current.findIndex(
        (item) => item.type === 'message' && item.messageId === messageId
      );
      if (index === -1) return;
      isProgrammaticScrollRef.current = true;
      flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 500);
    }, []);

    /** Fallback when scrollToIndex targets an unmeasured item. */
    const handleScrollToIndexFailed = useCallback(
      (info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
        isProgrammaticScrollRef.current = true;
        flatListRef.current?.scrollToOffset({
          offset: info.averageItemLength * info.index,
          animated: false,
        });
        setTimeout(() => {
          // Re-lookup the target item in case listItems changed during the scroll
          const targetItem = listItemsRef.current[info.index];
          if (!targetItem) {
            isProgrammaticScrollRef.current = false;
            return;
          }
          // Find the item's current index (it may have shifted if older messages were loaded)
          const currentIndex =
            targetItem.type === 'message'
              ? listItemsRef.current.findIndex(
                  (item) => item.type === 'message' && item.messageId === targetItem.messageId
                )
              : info.index;
          flatListRef.current?.scrollToIndex({
            index: currentIndex >= 0 ? currentIndex : info.index,
            animated: true,
            viewPosition: 0.5,
          });
          setTimeout(() => { isProgrammaticScrollRef.current = false; }, 500);
        }, 200);
      },
      []
    );

    // ----- build list items with separators -----
    const listItems = useMemo(() => buildListItems(messages), [messages]);
    listItemsRef.current = listItems;
    const previousListStateRef = useRef<{
      messageCount: number;
      itemCount: number;
      hasOlderMessages: boolean;
      isLoadingOlder: boolean;
    } | null>(null);
    useEffect(() => {
      const previous = previousListStateRef.current;
      if (
        !previous ||
        previous.messageCount !== messages.length ||
        previous.itemCount !== listItems.length ||
        previous.hasOlderMessages !== hasOlderMessages ||
        previous.isLoadingOlder !== isLoadingOlder
      ) {
        logger.debug('[chat-list] data state changed', {
          sessionId: props.sessionId,
          messageCount: messages.length,
          itemCount: listItems.length,
          hasOlderMessages,
          isLoadingOlder,
          newestMessageId: messages[0]?.id ?? null,
          newestSeq: messages[0]?.seq ?? null,
        });
        previousListStateRef.current = {
          messageCount: messages.length,
          itemCount: listItems.length,
          hasOlderMessages,
          isLoadingOlder,
        };
      }
    }, [hasOlderMessages, isLoadingOlder, listItems.length, messages, props.sessionId]);

    // ----- user message nav items (chronological: oldest first) -----
    const userNavItems = useMemo(() => {
      const infoById = new Map<string, { text: string; createdAt: number }>();
      for (const m of messages) {
        if (m.kind === 'user-text') {
          infoById.set(m.id, { text: m.displayText || m.text, createdAt: m.createdAt });
        }
      }
      const items: UserNavItem[] = [];
      let seq = 1;
      for (let i = listItems.length - 1; i >= 0; i--) {
        const item = listItems[i];
        if (item.type === 'message' && infoById.has(item.messageId)) {
          const { text, createdAt } = infoById.get(item.messageId)!;
          const preview = text.split('\n').slice(0, 2).join(' ').trim() || '…';
          items.push({ listIndex: i, messageId: item.messageId, seq: seq++, preview, time: formatTime(createdAt) });
        }
      }
      return items;
    }, [messages, listItems]);

    // ----- render items -----
    const keyExtractor = useCallback((item: ListItem) => {
      if (item.type === 'message') return item.messageId;
      return item.key;
    }, []);

    const renderItem = useCallback(
      ({ item }: { item: ListItem }) => {
        if (item.type === 'date-separator') return <DateSeparator label={item.label} />;
        if (item.type === 'time-separator') return <TimeSeparator label={item.label} />;
        return (
          <MessageRow
            messageId={item.messageId}
            metadata={props.metadata}
            sessionId={props.sessionId}
          />
        );
      },
      [props.metadata, props.sessionId]
    );

    // onEndReached: load older (fires on both platforms when near visual top)
    const handleEndReached = useCallback(() => {
      if (isProgrammaticScrollRef.current) return;
      if (!hasOlderMessages || isLoadingOlder) return;
      if (olderRef.current === 'loading') return;
      triggerLoad('older', () => sync.loadOlderMessages(props.sessionId));
    }, [props.sessionId, hasOlderMessages, isLoadingOlder, triggerLoad]);

    const olderLoader = useMemo(
      () => <OlderMessagesLoader isLoading={isLoadingOlder} />,
      [isLoadingOlder]
    );

    const footer = useMemo(
      () => <ListFooter sessionId={props.sessionId} notice={props.footerNotice} />,
      [props.sessionId, props.footerNotice]
    );

    return (
      <View style={{ flex: 1 }}>
        <FlatList
          ref={flatListRef}
          data={listItems}
          inverted={true}
          keyExtractor={keyExtractor}
          initialNumToRender={50}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={Platform.OS !== 'ios'}
          scrollEventThrottle={16}
          onScroll={handleScroll}
          onScrollEndDrag={handleScrollEndDrag}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
            autoscrollToTopThreshold: 10,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
          renderItem={renderItem}
          ListHeaderComponent={footer}
          ListFooterComponent={olderLoader}
        />

        <ChatFabStack>
          {showScrollFab && (
            <ChatFab onPress={handleScrollToBottom} accessibilityLabel={t('chatList.scrollToBottom')}>
              <Ionicons name="chevron-down" size={22} color={theme.colors.text} />
              <UnreadBadge count={unreadCount} />
            </ChatFab>
          )}
          {showScrollFab && userNavItems.length > 0 && (
            <ChatFab onPress={() => setNavOpen(true)} accessibilityLabel="Message navigation">
              <Ionicons name="list-outline" size={18} color={theme.colors.text} />
            </ChatFab>
          )}
        </ChatFabStack>

        {navOpen && (
          <UserMessageNavPanel
            items={userNavItems}
            onJumpTo={(messageId) => {
              handleJumpToUserMessage(messageId);
              setNavOpen(false);
            }}
            onClose={() => setNavOpen(false)}
            hasMoreMessages={hasOlderMessages}
          />
        )}

        <PullPill
          state={refreshPull}
          position="bottom"
          pullingText={t('chatList.pullToRefresh')}
          readyText={t('chatList.releaseToRefresh')}
          loadingText={t('chatList.refreshing')}
        />
        <PullPill
          state={olderPull}
          position="top"
          pullingText={t('chatList.pullToLoadEarlier')}
          readyText={t('chatList.releaseToLoadEarlier')}
          loadingText={t('chatList.loadingEarlier')}
        />
      </View>
    );
  }
);
