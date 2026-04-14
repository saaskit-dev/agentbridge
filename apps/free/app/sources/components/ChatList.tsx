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
} from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { ChatFooter } from './ChatFooter';
import { buildChatListItems, type ChatListItem } from './chatListItems';
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
const MESSAGE_HIGHLIGHT_MS = 1200;
/** Scroll offset threshold to consider user "at bottom" (inverted: y ≈ 0). */
const AT_BOTTOM_THRESHOLD = 80;

type UserNavItem = {
  listIndex: number;
  messageId: string;
  seq: number;
  preview: string;
  time: string;
  createdAt: number;
};
const FAB_SIZE = 40;
const FAB_GAP = 12;
const logger = new Logger('app/components/ChatList');

function shouldHideHistoricalDaemonError(
  message: Message,
  latestUserMessageCreatedAt: number | null
): boolean {
  return (
    latestUserMessageCreatedAt !== null &&
    message.kind === 'agent-event' &&
    message.event.type === 'daemon-log' &&
    message.event.level === 'error' &&
    message.createdAt < latestUserMessageCreatedAt
  );
}

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

function isFoldableDaemonErrorMessage(message: Message): boolean {
  if (message.kind !== 'agent-event') return false;
  return message.event.type === 'daemon-log' && message.event.level === 'error';
}

function getDaemonErrorSignature(message: Message): string | null {
  if (message.kind !== 'agent-event') return null;
  if (message.event.type !== 'daemon-log' || message.event.level !== 'error') return null;
  const { component, message: text, error } = message.event;
  return `${component}::${text}::${error ?? ''}`;
}

function getDaemonErrorSummaryText(message: Message, count: number): string {
  if (message.kind !== 'agent-event') return '';
  if (message.event.type !== 'daemon-log' || message.event.level !== 'error') return '';
  const { component, message: text } = message.event;
  return count > 1 ? `${component}: ${text} ×${count}` : `${component}: ${text}`;
}

function renderHighlightedText(
  text: string,
  query: string,
  baseStyle: Record<string, unknown>,
  highlightStyle: Record<string, unknown>
) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return <Text style={baseStyle}>{text}</Text>;
  const lowerText = text.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  const parts: React.ReactNode[] = [];
  let start = 0;
  let key = 0;

  while (start < text.length) {
    const matchIndex = lowerText.indexOf(lowerQuery, start);
    if (matchIndex === -1) {
      parts.push(text.slice(start));
      break;
    }
    if (matchIndex > start) {
      parts.push(text.slice(start, matchIndex));
    }
    parts.push(
      <Text key={`match-${key++}`} style={highlightStyle}>
        {text.slice(matchIndex, matchIndex + trimmedQuery.length)}
      </Text>
    );
    start = matchIndex + trimmedQuery.length;
  }

  return <Text style={baseStyle}>{parts}</Text>;
}

// ---------------------------------------------------------------------------
// List item types (messages + separators)
// ---------------------------------------------------------------------------

type ListItem = ChatListItem;

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
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
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

const NewMessagesPill = React.memo((props: { count: number; onPress: () => void }) => {
  const { theme } = useUnistyles();
  if (props.count <= 0) return null;
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        right: 16,
        bottom: FAB_SIZE * 2 + FAB_GAP * 2 + 20,
        zIndex: 19,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(18, 28, 45, 0.08)',
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 6,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Ionicons name="sparkles-outline" size={14} color={theme.colors.button.primary.background} />
      <Text
        style={{
          fontSize: 12,
          color: theme.colors.text,
          ...Typography.default('semiBold'),
        }}
      >
        {props.count === 1 ? '1 new message' : `${props.count} new messages`}
      </Text>
    </Pressable>
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
    activeMessageId?: string | null;
  }) => {
    const { theme } = useUnistyles();
    const { items, onJumpTo, onClose, hasMoreMessages, activeMessageId } = props;
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const hasSearch = items.length > 8;
    const borderColor = theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const subtleBackground = theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
    const pressedBackground = theme.dark ? 'rgba(255,255,255,0.08)' : '#F0F7FF';
    const scrollRef = useRef<ScrollView>(null);

    const filtered = useMemo(() => {
      if (!query.trim()) return items;
      const lowerQ = query.trim().toLowerCase();
      return items.filter((it) => it.preview.toLowerCase().includes(lowerQ));
    }, [items, query]);

    useEffect(() => {
      if (filtered.length === 0) {
        setSelectedIndex(0);
        return;
      }
      const activeIndex = activeMessageId
        ? filtered.findIndex(item => item.messageId === activeMessageId)
        : -1;
      setSelectedIndex(prev => {
        if (activeIndex >= 0) return activeIndex;
        return Math.min(prev, filtered.length - 1);
      });
    }, [activeMessageId, filtered]);

    useEffect(() => {
      if (selectedIndex < 0 || filtered.length === 0) return;
      const rowHeight = 58;
      scrollRef.current?.scrollTo({
        y: Math.max(0, selectedIndex * rowHeight - rowHeight * 2),
        animated: true,
      });
    }, [selectedIndex, filtered.length]);

    const handleSubmitSelected = useCallback(() => {
      const selectedItem = filtered[selectedIndex];
      if (selectedItem) onJumpTo(selectedItem.messageId);
    }, [filtered, onJumpTo, selectedIndex]);

    const handleSearchKeyPress = useCallback(
      (e: { nativeEvent?: { key?: string } }) => {
        const key = e.nativeEvent?.key;
        if (!key) return;
        if (key === 'ArrowDown') {
          setSelectedIndex(prev => (filtered.length === 0 ? 0 : Math.min(prev + 1, filtered.length - 1)));
        } else if (key === 'ArrowUp') {
          setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (key === 'Home') {
          setSelectedIndex(0);
        } else if (key === 'End') {
          setSelectedIndex(Math.max(filtered.length - 1, 0));
        } else if (key === 'PageDown') {
          setSelectedIndex(prev => (filtered.length === 0 ? 0 : Math.min(prev + 6, filtered.length - 1)));
        } else if (key === 'PageUp') {
          setSelectedIndex(prev => Math.max(prev - 6, 0));
        } else if (key === 'Enter') {
          handleSubmitSelected();
        } else if (key === 'Escape') {
          onClose();
        }
      },
      [filtered.length, handleSubmitSelected, onClose]
    );

    const shortcutHint =
      Platform.OS === 'web'
        ? navigator.platform.toLowerCase().includes('mac')
          ? 'Cmd+K'
          : 'Ctrl+K'
        : null;

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
          paddingTop: Platform.OS === 'web' ? 96 : 120,
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
            backgroundColor: Platform.OS === 'web' ? 'rgba(12, 16, 24, 0.56)' : 'rgba(15, 15, 15, 0.5)',
          }}
        />

        {/* Card */}
        <View
          style={{
            zIndex: 1,
            width: '100%',
            maxWidth: Platform.OS === 'web' ? 560 : 480,
            maxHeight: Platform.OS === 'web' ? ('min(70vh, 640px)' as any) : 400,
            backgroundColor: theme.colors.surface,
            borderRadius: Platform.OS === 'web' ? 22 : 16,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 24 },
            shadowOpacity: Platform.OS === 'web' ? 0.18 : 0.25,
            shadowRadius: Platform.OS === 'web' ? 48 : 40,
            elevation: 20,
            borderWidth: 1,
            borderColor: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(18, 28, 45, 0.08)',
          }}
        >
          {/* Header — search input only appears when > 8 messages */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: 18,
              paddingRight: 16,
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderBottomColor: borderColor,
              gap: 10,
              backgroundColor: Platform.OS === 'web' ? subtleBackground : theme.colors.surface,
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
                  paddingVertical: 10,
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
                onSubmitEditing={handleSubmitSelected}
                onKeyPress={handleSearchKeyPress}
                autoFocus={Platform.OS === 'web'}
              />
            ) : (
              <Text
                style={{
                  flex: 1,
                  paddingVertical: 10,
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
                paddingVertical: 8,
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
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingVertical: 8 }}
          >
            {!query && filtered.length > 0 && (
              <View
                style={{
                  paddingHorizontal: 18,
                  paddingTop: 4,
                  paddingBottom: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    color: theme.colors.textSecondary,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    ...Typography.default('semiBold'),
                  }}
                >
                  Recent Prompts
                </Text>
              </View>
            )}
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
              filtered.map((item, i) => {
                const isSelected = i === selectedIndex;
                const isActive = item.messageId === activeMessageId;
                const isLatest = item.seq === items.length;
                return (
                <Pressable
                  key={`unav-${item.listIndex}`}
                  onPress={() => {
                    setSelectedIndex(i);
                    onJumpTo(item.messageId);
                  }}
                  style={({ pressed }) => ({
                    paddingHorizontal: 18,
                    paddingVertical: 12,
                    marginHorizontal: 10,
                    borderRadius: 12,
                    backgroundColor: pressed
                      ? pressedBackground
                      : isSelected
                        ? subtleBackground
                        : 'transparent',
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 12,
                    borderBottomWidth: i < filtered.length - 1 ? 0.5 : 0,
                    borderBottomColor: borderColor,
                    borderWidth: isActive ? 1 : 0,
                    borderColor: isActive ? theme.colors.button.primary.background : 'transparent',
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
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        {renderHighlightedText(item.preview, query, {
                          fontSize: 14,
                          color: theme.colors.text,
                          lineHeight: 20,
                          letterSpacing: -0.2,
                          ...Typography.default(),
                        }, {
                          backgroundColor: theme.dark ? 'rgba(255,255,255,0.12)' : 'rgba(46, 144, 250, 0.18)',
                          color: theme.colors.text,
                          borderRadius: 4,
                          ...Typography.default('semiBold'),
                        })}
                      </View>
                      {isActive && (
                        <View
                          style={{
                            borderRadius: 999,
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            backgroundColor: theme.dark
                              ? 'rgba(255,255,255,0.08)'
                              : 'rgba(46, 144, 250, 0.12)',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              color: theme.colors.button.primary.background,
                              ...Typography.default('semiBold'),
                            }}
                          >
                            Current
                          </Text>
                        </View>
                      )}
                      {isLatest && !isActive && (
                        <View
                          style={{
                            borderRadius: 999,
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            backgroundColor: theme.dark
                              ? 'rgba(255,255,255,0.06)'
                              : 'rgba(15, 23, 42, 0.06)',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              color: theme.colors.textSecondary,
                              ...Typography.default('semiBold'),
                            }}
                          >
                            Latest
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text
                      style={{
                        fontSize: 11,
                        color: isActive
                          ? theme.colors.button.primary.background
                          : theme.colors.textSecondary,
                        ...Typography.default(),
                      }}
                    >
                      {item.time}
                    </Text>
                  </View>
                </Pressable>
              );
            })
            )}
          </ScrollView>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderTopWidth: 1,
              borderTopColor: borderColor,
              backgroundColor: Platform.OS === 'web' ? subtleBackground : theme.colors.surface,
            }}
          >
            <Text
            style={{
              fontSize: 11,
              color: theme.colors.textSecondary,
              ...Typography.default(),
            }}
          >
              ↑↓ Navigate  Home/End Jump List  Enter Open
            </Text>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              {shortcutHint ? (
                <Text
                  style={{
                    fontSize: 11,
                    color: theme.colors.textSecondary,
                    ...Typography.default('semiBold'),
                  }}
                >
                  {shortcutHint}
                </Text>
              ) : null}
              <Text
                style={{
                  fontSize: 10,
                  color: theme.colors.textSecondary,
                  ...Typography.default(),
                }}
              >
                {filtered.length === 0
                  ? '0 results'
                  : `${selectedIndex + 1} / ${filtered.length}`}
              </Text>
            </View>
          </View>
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

export const ChatList = React.memo((props: {
  session: Session;
  footerNotice?: string | null;
  jumpToRecentUserSignal?: number;
}) => {
  return (
    <ChatListInternal
      metadata={props.session.metadata}
      sessionId={props.session.id}
      footerNotice={props.footerNotice}
      jumpToRecentUserSignal={props.jumpToRecentUserSignal ?? 0}
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
  (props: {
    sessionId: string;
    messageId: string;
    metadata: Metadata | null;
    collapseToolsSignal?: number;
  }) => {
    const message = useMessage(props.sessionId, props.messageId);
    if (!message) return null;
    return (
      <MessageView
        message={message}
        metadata={props.metadata}
        sessionId={props.sessionId}
        hideTimestamp={true}
        collapseToolsSignal={props.collapseToolsSignal}
      />
    );
  }
);

const FoldedDaemonErrorRow = React.memo(
  (props: {
    sessionId: string;
    messageIds: string[];
    messages: Message[];
    metadata: Metadata | null;
    collapseToolsSignal?: number;
  }) => {
    const { theme } = useUnistyles();
    const summaryText = useMemo(
      () => getDaemonErrorSummaryText(props.messages[0], props.messages.length),
      [props.messages]
    );

    return (
      <View style={{ alignItems: 'center' }}>
        <View
          style={{
            marginHorizontal: 8,
            marginVertical: 2,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
            alignSelf: 'center',
            maxWidth: layout.maxWidth,
            alignItems: 'center',
            opacity: 0.88,
          }}
        >
          <Text
            style={{
              color: theme.colors.warningCritical,
              fontSize: 11,
              lineHeight: 16,
              textAlign: 'center',
              ...Typography.default(),
            }}
            numberOfLines={2}
          >
            {summaryText}
          </Text>
        </View>
      </View>
    );
  }
);

const TurnGroupRow = React.memo(
  (props: {
    sessionId: string;
    messageIds: string[];
    messagesById: Map<string, Message>;
    metadata: Metadata | null;
    createdAt: number;
    role: 'user' | 'assistant';
    isHighlighted?: boolean;
    collapseToolsSignal?: number;
  }) => {
    const { theme } = useUnistyles();
    const renderableBlocks = useMemo(() => {
      const blocks: Array<
        | { type: 'single'; messageId: string }
        | { type: 'folded-daemon-error'; messageIds: string[]; messages: Message[] }
      > = [];

      for (let index = 0; index < props.messageIds.length; ) {
        const messageId = props.messageIds[index];
        const message = props.messagesById.get(messageId);
        if (!message) {
          index += 1;
          continue;
        }
        const signature = getDaemonErrorSignature(message);
        if (!signature) {
          blocks.push({ type: 'single', messageId });
          index += 1;
          continue;
        }

        const groupedIds = [messageId];
        const groupedMessages = [message];
        let nextIndex = index + 1;
        while (nextIndex < props.messageIds.length) {
          const nextId = props.messageIds[nextIndex];
          const nextMessage = props.messagesById.get(nextId);
          if (!nextMessage || getDaemonErrorSignature(nextMessage) !== signature) break;
          groupedIds.push(nextId);
          groupedMessages.push(nextMessage);
          nextIndex += 1;
        }

        if (groupedIds.length > 1) {
          blocks.push({
            type: 'folded-daemon-error',
            messageIds: groupedIds,
            messages: groupedMessages,
          });
        } else {
          blocks.push({ type: 'single', messageId });
        }
        index = nextIndex;
      }

      return blocks;
    }, [props.messageIds, props.messagesById]);

    return (
      <View
        style={{
          width: '100%',
          marginHorizontal: 8,
          marginVertical: 2,
          borderRadius: 16,
          backgroundColor: props.isHighlighted
            ? theme.dark
              ? 'rgba(255,255,255,0.06)'
              : 'rgba(46, 144, 250, 0.10)'
            : 'transparent',
          borderWidth: props.isHighlighted ? 1 : 0,
          borderColor: props.isHighlighted
            ? theme.dark
              ? 'rgba(255,255,255,0.12)'
              : 'rgba(46, 144, 250, 0.26)'
            : 'transparent',
          paddingVertical: props.isHighlighted ? 4 : 0,
        }}
      >
        <View style={{ width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center' }}>
          {renderableBlocks.map((block, index) =>
            block.type === 'single' ? (
              <MessageRow
                key={block.messageId}
                messageId={block.messageId}
                metadata={props.metadata}
                sessionId={props.sessionId}
                collapseToolsSignal={props.collapseToolsSignal}
              />
            ) : (
              <FoldedDaemonErrorRow
                key={`daemon-error-${block.messageIds[0]}-${index}`}
                sessionId={props.sessionId}
                messageIds={block.messageIds}
                messages={block.messages}
                metadata={props.metadata}
                collapseToolsSignal={props.collapseToolsSignal}
              />
            )
          )}
          <Text
            style={{
              alignSelf: props.role === 'user' ? 'flex-end' : 'flex-start',
              marginHorizontal: 16,
              marginTop: 2,
              marginBottom: 10,
              color: theme.colors.textSecondary,
              fontSize: 11,
              opacity: 0.75,
              ...Typography.default(),
            }}
          >
            {formatTime(props.createdAt)}
          </Text>
        </View>
      </View>
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
    jumpToRecentUserSignal: number;
  }) => {
    const { messages, hasOlderMessages, isLoadingOlder } = useSessionMessages(props.sessionId);
    const visibleMessages = useMemo(() => {
      const latestUserMessageCreatedAt =
        messages.find(message => message.kind === 'user-text')?.createdAt ?? null;
      if (latestUserMessageCreatedAt === null) {
        return messages;
      }
      return messages.filter(
        message => !shouldHideHistoricalDaemonError(message, latestUserMessageCreatedAt)
      );
    }, [messages]);
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
    const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
    const { theme } = useUnistyles();
    const showScrollFabRef = useRef(false);
    const unreadCountRef = useRef(0);
    const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recentUserJumpIndexRef = useRef(-1);
    const lastHandledJumpSignalRef = useRef(0);
    const shouldFollowBottomRef = useRef(true);

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
          if (!isProgrammaticScrollRef.current) {
            shouldFollowBottomRef.current = true;
            recentUserJumpIndexRef.current = -1;
          }
          updateShowScrollFab(false);
          if (!wasAtBottom) updateUnreadCount(0);
        } else {
          if (!isProgrammaticScrollRef.current) {
            shouldFollowBottomRef.current = false;
          }
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
    const prevMessageIdsRef = useRef(new Set(visibleMessages.map(message => message.id)));
    useEffect(() => {
      const prevIds = prevMessageIdsRef.current;
      const relevantNewMessages: Message[] = [];
      for (const message of visibleMessages) {
        if (prevIds.has(message.id)) {
          break;
        }
        relevantNewMessages.push(message);
      }

      if (relevantNewMessages.length > 0) {
        const hasNewUserMessage = relevantNewMessages.some(message => message.kind === 'user-text');
        if (hasNewUserMessage) {
          shouldFollowBottomRef.current = true;
          recentUserJumpIndexRef.current = -1;
        }
        if (shouldFollowBottomRef.current && (isAtBottom.current || hasNewUserMessage)) {
          requestAnimationFrame(() => {
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
          });
        } else {
          updateUnreadCount(prev => prev + relevantNewMessages.length);
        }
      }

      prevMessageIdsRef.current = new Set(visibleMessages.map(message => message.id));
    }, [updateUnreadCount, visibleMessages]);

    useEffect(
      () => () => {
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
      },
      []
    );

    useEffect(() => {
      if (Platform.OS !== 'web') return;
      const handleKeyDown = (event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          setNavOpen(open => !open);
          return;
        }
        if (event.key === 'Escape') {
          setNavOpen(false);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleScrollToBottom = useCallback(() => {
      shouldFollowBottomRef.current = true;
      recentUserJumpIndexRef.current = -1;
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      updateShowScrollFab(false);
      updateUnreadCount(0);
    }, [updateShowScrollFab, updateUnreadCount]);

    const highlightMessage = useCallback((messageId: string) => {
      setHighlightedMessageId(messageId);
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedMessageId(current => (current === messageId ? null : current));
      }, MESSAGE_HIGHLIGHT_MS);
    }, []);

    const finishProgrammaticScroll = useCallback(() => {
      isProgrammaticScrollRef.current = false;
      if (isAtBottom.current) {
        shouldFollowBottomRef.current = true;
        updateShowScrollFab(false);
        updateUnreadCount(0);
      }
    }, [updateShowScrollFab, updateUnreadCount]);

    /** Jump to a message by id. Looks up the current index to avoid stale-index bugs. */
    const handleJumpToUserMessage = useCallback((messageId: string) => {
      const index = listItemsRef.current.findIndex(
        (item) => item.type === 'message-group' && item.messageIds.includes(messageId)
      );
      if (index === -1) return;
      shouldFollowBottomRef.current = false;
      highlightMessage(messageId);
      isProgrammaticScrollRef.current = true;
      flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      setTimeout(() => {
        finishProgrammaticScroll();
      }, 500);
    }, [finishProgrammaticScroll, highlightMessage]);

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
            finishProgrammaticScroll();
            return;
          }
          // Find the item's current index (it may have shifted if older messages were loaded)
          const currentIndex =
            targetItem.type === 'message-group'
              ? listItemsRef.current.findIndex(
                  (item) =>
                    item.type === 'message-group' &&
                    item.primaryMessageId === targetItem.primaryMessageId
                )
              : info.index;
          flatListRef.current?.scrollToIndex({
            index: currentIndex >= 0 ? currentIndex : info.index,
            animated: true,
            viewPosition: 0.5,
          });
          setTimeout(() => { finishProgrammaticScroll(); }, 500);
        }, 200);
      },
      [finishProgrammaticScroll]
    );

    // ----- build list items with separators -----
    const listItems = useMemo(
      () => buildChatListItems(visibleMessages, formatDateLabel, formatTime),
      [visibleMessages]
    );
    const messagesById = useMemo(
      () => new Map(visibleMessages.map(message => [message.id, message])),
      [visibleMessages]
    );
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
        previous.messageCount !== visibleMessages.length ||
        previous.itemCount !== listItems.length ||
        previous.hasOlderMessages !== hasOlderMessages ||
        previous.isLoadingOlder !== isLoadingOlder
      ) {
        logger.debug('[chat-list] data state changed', {
          sessionId: props.sessionId,
          messageCount: visibleMessages.length,
          itemCount: listItems.length,
          hasOlderMessages,
          isLoadingOlder,
          newestMessageId: visibleMessages[0]?.id ?? null,
          newestSeq: visibleMessages[0]?.seq ?? null,
        });
        previousListStateRef.current = {
          messageCount: visibleMessages.length,
          itemCount: listItems.length,
          hasOlderMessages,
          isLoadingOlder,
        };
      }
    }, [hasOlderMessages, isLoadingOlder, listItems.length, props.sessionId, visibleMessages]);

    // ----- user message nav items (chronological: oldest first) -----
    const userNavItems = useMemo(() => {
      const infoById = new Map<string, { text: string; createdAt: number }>();
      for (const m of visibleMessages) {
        if (m.kind === 'user-text') {
          infoById.set(m.id, { text: m.displayText || m.text, createdAt: m.createdAt });
        }
      }
      const items: UserNavItem[] = [];
      let seq = 1;
      for (let i = listItems.length - 1; i >= 0; i--) {
        const item = listItems[i];
        if (item.type === 'message-group' && item.role === 'user' && infoById.has(item.primaryMessageId)) {
          const { text, createdAt } = infoById.get(item.primaryMessageId)!;
          const preview = text.split('\n').slice(0, 2).join(' ').trim() || '…';
          items.push({
            listIndex: i,
            messageId: item.primaryMessageId,
            seq: seq++,
            preview,
            time: formatTime(createdAt),
            createdAt,
          });
        }
      }
      return items;
    }, [listItems, visibleMessages]);

    useEffect(() => {
      if (!props.jumpToRecentUserSignal) return;
      if (props.jumpToRecentUserSignal === lastHandledJumpSignalRef.current) return;
      lastHandledJumpSignalRef.current = props.jumpToRecentUserSignal;
      const recentUserItems = [...userNavItems].sort((a, b) => b.createdAt - a.createdAt);
      if (recentUserItems.length === 0) return;
      const nextIndex = Math.min(recentUserJumpIndexRef.current + 1, recentUserItems.length - 1);
      recentUserJumpIndexRef.current = nextIndex;
      handleJumpToUserMessage(recentUserItems[nextIndex].messageId);
    }, [handleJumpToUserMessage, props.jumpToRecentUserSignal, userNavItems]);

    useEffect(() => {
      recentUserJumpIndexRef.current = -1;
    }, [props.sessionId]);

    useEffect(() => {
      if (userNavItems.length === 0) {
        recentUserJumpIndexRef.current = -1;
        return;
      }
      if (recentUserJumpIndexRef.current >= userNavItems.length) {
        recentUserJumpIndexRef.current = userNavItems.length - 1;
      }
    }, [userNavItems]);

    // ----- render items -----
    const keyExtractor = useCallback((item: ListItem) => {
      if (item.type === 'message-group') return item.key;
      return item.key;
    }, []);

    const renderItem = useCallback(
      ({ item }: { item: ListItem }) => {
        if (item.type === 'date-separator') return <DateSeparator label={item.label} />;
        if (item.type === 'time-separator') return <TimeSeparator label={item.label} />;
        return (
          <TurnGroupRow
            createdAt={item.createdAt}
            messageIds={item.messageIds}
            messagesById={messagesById}
            metadata={props.metadata}
            role={item.role}
            sessionId={props.sessionId}
            isHighlighted={item.messageIds.includes(highlightedMessageId ?? '')}
            collapseToolsSignal={props.jumpToRecentUserSignal}
          />
        );
      },
      [
        highlightedMessageId,
        messagesById,
        props.jumpToRecentUserSignal,
        props.metadata,
        props.sessionId,
      ]
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

    const contentContainerStyle = useMemo(() => {
      if (Platform.OS !== 'web') return undefined;
      return {
        // Keep a stable horizontal gutter on web to avoid content jumping.
        paddingRight: FAB_SIZE + 24,
        paddingBottom: showScrollFab ? FAB_SIZE * 3 + FAB_GAP * 3 + 44 : undefined,
      };
    }, [showScrollFab]);

    return (
      <View style={{ flex: 1, position: 'relative' }}>
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
          contentContainerStyle={contentContainerStyle}
          renderItem={renderItem}
          ListHeaderComponent={footer}
          ListFooterComponent={olderLoader}
        />

        {showScrollFab && unreadCount > 0 && (
          <NewMessagesPill count={unreadCount} onPress={handleScrollToBottom} />
        )}

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
            activeMessageId={highlightedMessageId}
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
