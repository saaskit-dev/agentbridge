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
  Text,
  View,
} from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { ChatFooter } from './ChatFooter';
import { MessageView } from './MessageView';
import { useSession, useSessionMessages } from '@/sync/storage';
import { Metadata, Session } from '@/sync/storageTypes';
import { Message } from '@/sync/typesMessage';
import { sync } from '@/sync/sync';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

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
  | { type: 'message'; message: Message }
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

    items.push({ type: 'message', message: msg });
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
// Scroll-to-bottom FAB with unread badge
// ---------------------------------------------------------------------------

const ScrollToBottomFab = React.memo(
  (props: { visible: boolean; unreadCount: number; onPress: () => void }) => {
    const { theme } = useUnistyles();
    if (!props.visible) return null;

    return (
      <Pressable
        onPress={props.onPress}
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          zIndex: 20,
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: theme.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 6,
        }}
        accessibilityLabel={t('chatList.scrollToBottom')}
      >
        <Ionicons name="chevron-down" size={22} color={theme.colors.text} />
        {props.unreadCount > 0 && (
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
              {props.unreadCount > 99 ? '99+' : props.unreadCount}
            </Text>
          </View>
        )}
      </Pressable>
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
  const { messages, hasOlderMessages, isLoadingOlder } = useSessionMessages(props.session.id);
  return (
    <ChatListInternal
      metadata={props.session.metadata}
      sessionId={props.session.id}
      messages={messages}
      hasOlderMessages={hasOlderMessages}
      isLoadingOlder={isLoadingOlder}
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
// Main list
// ---------------------------------------------------------------------------

const ChatListInternal = React.memo(
  (props: {
    metadata: Metadata | null;
    sessionId: string;
    messages: Message[];
    hasOlderMessages: boolean;
    isLoadingOlder: boolean;
    footerNotice?: string | null;
  }) => {
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
    const [showScrollFab, setShowScrollFab] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
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
        if (isAtBottom.current && !wasAtBottom) {
          updateShowScrollFab(false);
          updateUnreadCount(0);
        } else if (!isAtBottom.current && wasAtBottom) {
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
          !props.isLoadingOlder
        ) {
          triggerLoad('older', () => sync.loadOlderMessages(props.sessionId));
        }
      },
      [setPull, triggerLoad, props.sessionId, props.isLoadingOlder, updateShowScrollFab, updateUnreadCount]
    );

    const handleScrollEndDrag = useCallback(() => {
      if (refreshRef.current === 'ready') {
        triggerLoad('refresh', () => sync.refreshMessages(props.sessionId));
      }
      if (olderRef.current === 'ready' && !props.isLoadingOlder) {
        triggerLoad('older', () => sync.loadOlderMessages(props.sessionId));
      }
    }, [props.sessionId, props.isLoadingOlder, triggerLoad]);

    // ----- auto-scroll / unread tracking -----
    const prevMessageCount = useRef(props.messages.length);
    useEffect(() => {
      const count = props.messages.length;
      const added = count - prevMessageCount.current;
      if (added > 0) {
        if (isAtBottom.current) {
          requestAnimationFrame(() => {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
          });
        } else {
          updateUnreadCount(prev => prev + added);
        }
      }
      prevMessageCount.current = count;
    }, [props.messages.length, updateUnreadCount]);

    const handleScrollToBottom = useCallback(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      updateShowScrollFab(false);
      updateUnreadCount(0);
    }, [updateShowScrollFab, updateUnreadCount]);

    // ----- build list items with separators -----
    const listItems = useMemo(() => buildListItems(props.messages), [props.messages]);

    // ----- render items -----
    const keyExtractor = useCallback((item: ListItem) => {
      if (item.type === 'message') return item.message.id;
      return item.key;
    }, []);

    const renderItem = useCallback(
      ({ item }: { item: ListItem }) => {
        if (item.type === 'date-separator') return <DateSeparator label={item.label} />;
        if (item.type === 'time-separator') return <TimeSeparator label={item.label} />;
        return (
          <MessageView
            message={item.message}
            metadata={props.metadata}
            sessionId={props.sessionId}
          />
        );
      },
      [props.metadata, props.sessionId]
    );

    // onEndReached: load older (fires on both platforms when near visual top)
    const handleEndReached = useCallback(() => {
      if (!props.hasOlderMessages || props.isLoadingOlder) return;
      if (olderRef.current === 'loading') return;
      triggerLoad('older', () => sync.loadOlderMessages(props.sessionId));
    }, [props.sessionId, props.hasOlderMessages, props.isLoadingOlder, triggerLoad]);

    const olderLoader = useMemo(
      () => <OlderMessagesLoader isLoading={props.isLoadingOlder} />,
      [props.isLoadingOlder]
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
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={7}
          scrollEventThrottle={16}
          onScroll={handleScroll}
          onScrollEndDrag={handleScrollEndDrag}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
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

        <ScrollToBottomFab
          visible={showScrollFab}
          unreadCount={unreadCount}
          onPress={handleScrollToBottom}
        />

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
