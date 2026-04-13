import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useDesktopSessionTabs } from '@/hooks/useDesktopSessionTabs';
import { t } from '@/text';

const styles = StyleSheet.create(theme => ({
  strip: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.divider,
    backgroundColor: theme.colors.surface,
    paddingTop: 8,
    paddingBottom: 0,
  },
  content: {
    paddingHorizontal: 10,
    alignItems: 'flex-end',
    gap: 6,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 220,
    minWidth: 120,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 10,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
  },
  tabActive: {
    backgroundColor: theme.colors.surfaceSelected,
    borderColor: theme.colors.divider,
  },
  tabInactive: {
    backgroundColor: theme.colors.surfaceHigh,
    borderColor: theme.colors.divider,
    opacity: 0.86,
  },
  title: {
    flexShrink: 1,
    fontSize: 13,
    ...Typography.default(),
  },
  closeButton: {
    marginLeft: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButton: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    fontSize: 11,
    ...Typography.default('semiBold'),
  },
}));

export function DesktopSessionTabs({
  activeSessionId,
}: {
  activeSessionId: string;
}) {
  const router = useRouter();
  const { theme } = useUnistyles();
  const { tabs, closeTab, closeOtherTabs, closeAllTabs } = useDesktopSessionTabs();

  if (tabs.length <= 1) {
    return null;
  }

  return (
    <View style={styles.strip}>
      <View style={styles.actions}>
        <Pressable
          onPress={() => closeOtherTabs(activeSessionId)}
          style={[
            styles.actionButton,
            {
              borderColor: theme.colors.divider,
              backgroundColor: theme.colors.surfaceHigh,
            },
          ]}
        >
          <Ionicons name="remove-circle-outline" size={12} color={theme.colors.textSecondary} />
          <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>
            {t('tabs.closeOthers')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            router.navigate('/');
            setTimeout(() => closeAllTabs(), 0);
          }}
          style={[
            styles.actionButton,
            {
              borderColor: theme.colors.divider,
              backgroundColor: theme.colors.surfaceHigh,
            },
          ]}
        >
          <Ionicons name="close-circle-outline" size={12} color={theme.colors.textSecondary} />
          <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>
            {t('tabs.closeAll')}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
        {tabs.map((tab, index) => {
          const active = tab.id === activeSessionId;
          return (
            <Pressable
              key={tab.id}
              onPress={() => router.navigate(`/session/${tab.id}`)}
              style={[styles.tab, active ? styles.tabActive : styles.tabInactive]}
            >
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={14}
                color={active ? theme.colors.text : theme.colors.textSecondary}
                style={{ marginRight: 8 }}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.title,
                  {
                    color: active ? theme.colors.text : theme.colors.textSecondary,
                    ...(active ? Typography.default('semiBold') : Typography.default()),
                  },
                ]}
              >
                {tab.title}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={(event: any) => {
                  event?.stopPropagation?.();
                  if (active) {
                    const fallback = tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null;
                    if (fallback) {
                      router.navigate(`/session/${fallback}`);
                    } else {
                      router.navigate('/');
                    }
                    // Defer removal until after navigation so the current SessionView
                    // can't immediately upsert the tab again before it unmounts.
                    setTimeout(() => closeTab(tab.id), 0);
                    return;
                  }

                  closeTab(tab.id);
                }}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={12} color={theme.colors.textSecondary} />
              </Pressable>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
