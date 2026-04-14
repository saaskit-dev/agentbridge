import React from 'react';
import { View, FlatList } from 'react-native';
import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { Avatar } from '@/components/Avatar';
import { layout } from '@/components/layout';
import { buildSessionHistoryItems, type SessionHistoryItem } from '@/components/sessionHistoryItems';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useAllSessions } from '@/sync/storage';
import { t } from '@/text';

const styles = StyleSheet.create(theme => ({
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
  dateHeader: {
    backgroundColor: theme.colors.groupped.background,
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: 24,
  },
  dateHeaderText: {
    ...Typography.default('semiBold'),
    color: theme.colors.groupped.sectionTitle,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  sessionCard: {
    backgroundColor: theme.colors.surface,
    marginHorizontal: 16,
    marginBottom: 1,
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionCardFirst: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  sessionCardLast: {
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    marginBottom: 12,
  },
  sessionCardSingle: {
    borderRadius: 12,
    marginBottom: 12,
  },
  sessionContent: {
    flex: 1,
    marginLeft: 16,
  },
  sessionTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: theme.colors.text,
    marginBottom: 2,
    ...Typography.default('semiBold'),
  },
  sessionSubtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    ...Typography.default(),
  },
}));

export default function SessionHistory() {
  const safeArea = useSafeAreaInsets();
  const allSessions = useAllSessions();
  const navigateToSession = useNavigateToSession();

  const groupedItems = React.useMemo(() => {
    return buildSessionHistoryItems(allSessions);
  }, [allSessions]);

  const renderItem = React.useCallback(
    ({ item }: { item: SessionHistoryItem }) => {
      if (item.type === 'date-header') {
        return (
          <View style={styles.dateHeader}>
            <Text style={styles.dateHeaderText}>{item.date}</Text>
          </View>
        );
      }

      if (item.type === 'session') {
        const session = item.session;

        return (
          <Pressable
            style={[
              styles.sessionCard,
              item.cardPosition === 'single'
                ? styles.sessionCardSingle
                : item.cardPosition === 'first'
                  ? styles.sessionCardFirst
                  : item.cardPosition === 'last'
                    ? styles.sessionCardLast
                    : {},
            ]}
            onPress={() => navigateToSession(session.id)}
          >
            <Avatar id={item.avatarId} size={48} />
            <View style={styles.sessionContent}>
              <Text style={styles.sessionTitle} numberOfLines={1}>
                {item.sessionName}
              </Text>
              <Text style={styles.sessionSubtitle} numberOfLines={1}>
                {item.sessionSubtitle}
              </Text>
            </View>
          </Pressable>
        );
      }

      return null;
    },
    [navigateToSession]
  );

  const keyExtractor = React.useCallback((item: SessionHistoryItem) => item.key, []);

  if (!allSessions) {
    return (
      <View style={styles.container}>
        <View style={styles.contentContainer} />
      </View>
    );
  }

  if (groupedItems.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.contentContainer}>
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t('sessionHistory.empty')}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.contentContainer}>
        <FlatList
          data={groupedItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{
            paddingBottom: safeArea.bottom + 16,
            paddingTop: 8,
          }}
        />
      </View>
    </View>
  );
}
