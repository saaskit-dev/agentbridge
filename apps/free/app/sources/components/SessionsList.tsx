import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import React from 'react';
import { View, Pressable, FlatList, Platform } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { ActiveSessionsGroupCompact } from './ActiveSessionsGroupCompact';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { Typography } from '@/constants/Typography';
import { StatusDot } from './StatusDot';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActiveSessionsGroup } from './ActiveSessionsGroup';
import { Avatar } from './Avatar';
import { UpdateBanner } from './UpdateBanner';
import { layout } from './layout';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { SessionRowActionButton } from './SessionRowActionButton';
import { t } from '@/text';
import { Item } from './Item';
import { ItemGroup } from './ItemGroup';
import { Text } from '@/components/StyledText';
import { useFreeAction } from '@/hooks/useFreeAction';
import { FreeError } from '@/utils/errors';
import { Modal } from '@/modal';
import { sessionDelete } from '@/sync/ops';
import { useSetting } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { requestReview } from '@/utils/requestReview';
import { useIsTablet } from '@/utils/responsive';
import { buildSessionsListItems, SessionsListRenderItem } from './sessionsListItems';
import { useSessionStatus } from '@/utils/sessionUtils';

const stylesheet = StyleSheet.create(theme => ({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'stretch',
    backgroundColor: theme.colors.groupped.background,
  },
  contentContainer: {
    flex: 1,
    maxWidth: layout.maxWidth,
  },
  headerSection: {
    backgroundColor: theme.colors.groupped.background,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 8,
  },
  headerText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.groupped.sectionTitle,
    letterSpacing: 0.1,
    ...Typography.default('semiBold'),
  },
  projectGroup: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface,
  },
  projectGroupTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  projectGroupSubtitle: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 2,
    ...Typography.default(),
  },
  sessionItem: {
    height: 88,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: theme.colors.surface,
  },
  sessionItemContainer: {
    marginHorizontal: 16,
    marginBottom: 1,
    overflow: 'hidden',
  },
  sessionItemFirst: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  sessionItemLast: {
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  sessionItemSingle: {
    borderRadius: 12,
  },
  sessionItemContainerFirst: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  sessionItemContainerLast: {
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    marginBottom: 12,
  },
  sessionItemContainerSingle: {
    borderRadius: 12,
    marginBottom: 12,
  },
  sessionItemSelected: {
    backgroundColor: theme.colors.surfaceSelected,
  },
  sessionContent: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'center',
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  sessionTitle: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
    ...Typography.default('semiBold'),
  },
  sessionTitleConnected: {
    color: theme.colors.text,
  },
  sessionTitleDisconnected: {
    color: theme.colors.textSecondary,
  },
  sessionSubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: 4,
    ...Typography.default(),
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDotContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 16,
    marginTop: 2,
    marginRight: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    ...Typography.default(),
  },
  avatarContainer: {
    position: 'relative',
    width: 48,
    height: 48,
  },
  draftIconContainer: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftIconOverlay: {
    color: theme.colors.textSecondary,
  },
  artifactsSection: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: theme.colors.groupped.background,
  },
  swipeAction: {
    width: 112,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.status.error,
  },
  swipeActionText: {
    marginTop: 4,
    fontSize: 12,
    color: '#FFFFFF',
    textAlign: 'center',
    ...Typography.default('semiBold'),
  },
}));

export function SessionsList() {
  const styles = stylesheet;
  const safeArea = useSafeAreaInsets();
  const data = useVisibleSessionListViewData();
  const pathname = usePathname();
  const isTablet = useIsTablet();
  const navigateToSession = useNavigateToSession();
  const compactSessionView = useSetting('compactSessionView');
  const selectable = isTablet;
  const selectedSessionId = React.useMemo(() => {
    if (!selectable || !pathname.startsWith('/session/')) {
      return undefined;
    }

    const parts = pathname.split('/');
    return parts[2] || undefined;
  }, [pathname, selectable]);
  const listItems = React.useMemo(
    () => (data ? buildSessionsListItems(data, selectedSessionId) : null),
    [data, selectedSessionId]
  );

  // Request review
  React.useEffect(() => {
    if (data && data.length > 0) {
      requestReview();
    }
  }, [data && data.length > 0]);

  // Early return if no data yet
  if (!data) {
    return <View style={styles.container} />;
  }

  const keyExtractor = React.useCallback(
    (item: SessionsListRenderItem) => {
      return item.key;
    },
    []
  );

  const renderItem = React.useCallback(
    ({ item, index }: { item: SessionsListRenderItem; index: number }) => {
      switch (item.type) {
        case 'header':
          return (
            <View style={styles.headerSection}>
              <Text style={styles.headerText}>{item.title}</Text>
            </View>
          );

        case 'active-sessions':
          const ActiveComponent = compactSessionView
            ? ActiveSessionsGroupCompact
            : ActiveSessionsGroup;
          return <ActiveComponent sessions={item.sessions} selectedSessionId={item.selectedSessionId} />;

        case 'project-group':
          return (
            <View style={styles.projectGroup}>
              <Text style={styles.projectGroupTitle}>{item.displayPath}</Text>
              <Text style={styles.projectGroupSubtitle}>
                {item.machine.metadata?.displayName ||
                  item.machine.metadata?.host ||
                  item.machine.id}
              </Text>
            </View>
          );

        case 'session':
          return (
            <SessionItem
              session={item.session}
              sessionName={item.sessionName}
              sessionSubtitle={item.sessionSubtitle}
              avatarId={item.avatarId}
              selected={item.selected}
              isFirst={item.cardPosition === 'first'}
              isLast={item.cardPosition === 'last'}
              isSingle={item.cardPosition === 'single'}
              isTablet={isTablet}
              navigateToSession={navigateToSession}
              testID={`session-item-${index}`}
            />
          );
      }
    },
    [compactSessionView, isTablet, navigateToSession]
  );

  // Remove this section as we'll use FlatList for all items now

  const HeaderComponent = React.useCallback(() => {
    return <UpdateBanner />;
  }, []);

  // Footer removed - all sessions now shown inline

  return (
    <View style={styles.container}>
      <View style={styles.contentContainer}>
        <FlatList
          data={listItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{
            paddingBottom: safeArea.bottom + 128,
            maxWidth: layout.maxWidth,
            alignSelf: 'center',
            width: '100%',
          }}
          ListHeaderComponent={HeaderComponent}
        />
      </View>
    </View>
  );
}

// Sub-component that handles session message logic
const SessionItem = React.memo(
  ({
    session,
    sessionName,
    sessionSubtitle,
    avatarId,
    selected,
    isFirst,
    isLast,
    isSingle,
    isTablet,
    navigateToSession,
    testID,
  }: {
    session: Session;
    sessionName: string;
    sessionSubtitle: string;
    avatarId: string;
    selected?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    isSingle?: boolean;
    isTablet: boolean;
    navigateToSession: (sessionId: string) => void;
    testID?: string;
  }) => {
    const styles = stylesheet;
    const sessionStatus = useSessionStatus(session);
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const swipeEnabled = Platform.OS !== 'web';

    const [deletingSession, performDelete] = useFreeAction(async () => {
      const result = await sessionDelete(session.id);
      if (!result.success) {
        throw new FreeError(result.message || t('sessionInfo.failedToDeleteSession'), false);
      }
    });

    const handleDelete = React.useCallback(() => {
      swipeableRef.current?.close();
      Modal.alert(t('sessionInfo.deleteSession'), t('sessionInfo.deleteSessionWarning'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('sessionInfo.deleteSession'),
          style: 'destructive',
          onPress: performDelete,
        },
      ]);
    }, [performDelete]);

    const itemContent = (
      <Pressable
        testID={testID}
        style={[
          styles.sessionItem,
          selected && styles.sessionItemSelected,
          isSingle
            ? styles.sessionItemSingle
            : isFirst
              ? styles.sessionItemFirst
              : isLast
                ? styles.sessionItemLast
                : {},
        ]}
        onPressIn={() => {
          if (isTablet) {
            navigateToSession(session.id);
          }
        }}
        onPress={() => {
          if (!isTablet) {
            navigateToSession(session.id);
          }
        }}
      >
        <View style={styles.avatarContainer}>
          <Avatar
            id={avatarId}
            size={48}
            monochrome={!sessionStatus.isConnected}
            flavor={session.metadata?.flavor}
          />
          {!!session.draft && (
            <View style={styles.draftIconContainer}>
              <Ionicons name="create-outline" size={12} style={styles.draftIconOverlay} />
            </View>
          )}
        </View>
        <View style={styles.sessionContent}>
          {/* Title line */}
          <View style={styles.sessionTitleRow}>
            <Text
              style={[
                styles.sessionTitle,
                sessionStatus.isConnected
                  ? styles.sessionTitleConnected
                  : styles.sessionTitleDisconnected,
              ]}
              numberOfLines={1}
            >
              {' '}
              {/* {variant !== 'no-path' ? 1 : 2} - issue is we don't have anything to take this space yet and it looks strange - if summaries were more reliably generated, we can add this. While no summary - add something like "New session" or "Empty session", and extend summary to 2 lines once we have it */}
              {sessionName}
            </Text>
          </View>

          {/* Subtitle line */}
          <Text style={styles.sessionSubtitle} numberOfLines={1}>
            {sessionSubtitle}
          </Text>

          {/* Status line with dot */}
          <View style={styles.statusRow}>
            <View style={styles.statusDotContainer}>
              <StatusDot color={sessionStatus.statusDotColor} isPulsing={sessionStatus.isPulsing} />
            </View>
            <Text style={[styles.statusText, { color: sessionStatus.statusColor }]}>
              {sessionStatus.statusText}
            </Text>
          </View>
        </View>
        {!swipeEnabled && (
          <SessionRowActionButton
            label={t('sessionInfo.deleteSession')}
            icon="trash-outline"
            onPress={handleDelete}
            destructive={true}
            disabled={deletingSession}
          />
        )}
      </Pressable>
    );

    const containerStyles = [
      styles.sessionItemContainer,
      isSingle
        ? styles.sessionItemContainerSingle
        : isFirst
          ? styles.sessionItemContainerFirst
          : isLast
            ? styles.sessionItemContainerLast
            : {},
    ];

    if (!swipeEnabled) {
      return <View style={containerStyles}>{itemContent}</View>;
    }

    const renderRightActions = () => (
      <Pressable style={styles.swipeAction} onPress={handleDelete} disabled={deletingSession}>
        <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
        <Text style={styles.swipeActionText} numberOfLines={2}>
          {t('sessionInfo.deleteSession')}
        </Text>
      </Pressable>
    );

    return (
      <View style={containerStyles}>
        <Swipeable
          ref={swipeableRef}
          renderRightActions={renderRightActions}
          overshootRight={false}
          enabled={!deletingSession}
        >
          {itemContent}
        </Swipeable>
      </View>
    );
  }
);
