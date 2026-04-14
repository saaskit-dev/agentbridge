import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useDesktopSessionTabsState } from '@/hooks/useDesktopSessionTabs';
import { t } from '@/text';
import { WebPortal } from './web/WebPortal';

type TabContextMenuState = {
  x: number;
  y: number;
  tabId: string;
};

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
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  menuItemDanger: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
}));

const TabContextMenu = React.memo(
  ({
    menu,
    onClose,
    onCloseOthers,
    onCloseAll,
  }: {
    menu: TabContextMenuState;
    onClose: () => void;
    onCloseOthers: () => void;
    onCloseAll: () => void;
  }) => {
    const { theme } = useUnistyles();
    const menuWidth = 176;
    const fallbackMenuHeight = 88;
    const [menuHeight, setMenuHeight] = React.useState(fallbackMenuHeight);
    const viewportWidth =
      typeof window !== 'undefined' ? window.innerWidth : menu.x + menuWidth + 16;
    const viewportHeight =
      typeof window !== 'undefined' ? window.innerHeight : menu.y + menuHeight + 16;
    const cursorOffset = 10;
    const preferredLeft = menu.x + cursorOffset;
    const preferredTop = menu.y + cursorOffset;
    const left =
      preferredLeft + menuWidth <= viewportWidth - 8
        ? preferredLeft
        : Math.max(8, menu.x - menuWidth - cursorOffset);
    const top =
      preferredTop + menuHeight <= viewportHeight - 8
        ? preferredTop
        : Math.max(8, menu.y - menuHeight - cursorOffset);
    return (
      <WebPortal>
        <Pressable
          onPress={onClose}
          // @ts-ignore web
          onContextMenu={(event: any) => {
            event.preventDefault();
            onClose();
          }}
          style={{
            position: 'fixed' as any,
            inset: 0,
            zIndex: 999,
          }}
        />
        <View
          onLayout={event => {
            const nextHeight = Math.ceil(event.nativeEvent.layout.height);
            if (nextHeight > 0 && nextHeight !== menuHeight) {
              setMenuHeight(nextHeight);
            }
          }}
          style={{
            position: 'fixed' as any,
            left,
            top,
            zIndex: 1000,
            width: menuWidth,
            maxHeight: viewportHeight - 16,
            backgroundColor: theme.colors.surface,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.colors.divider,
            shadowColor: '#000',
            shadowOpacity: 0.08,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
            overflow: 'hidden',
          }}
        >
          <Pressable onPress={onCloseOthers} style={styles.menuItem}>
            <Ionicons name="remove-circle-outline" size={16} color={theme.colors.text} />
            <Text style={{ color: theme.colors.text, ...Typography.default() }}>
              {t('tabs.closeOthers')}
            </Text>
          </Pressable>
          <Pressable
            onPress={onCloseAll}
            style={[
              styles.menuItem,
              styles.menuItemDanger,
              {
                borderTopColor: theme.colors.divider,
              },
            ]}
          >
            <Ionicons name="close-circle-outline" size={16} color={theme.colors.status.error} />
            <Text style={{ color: theme.colors.status.error, ...Typography.default() }}>
              {t('tabs.closeAll')}
            </Text>
          </Pressable>
        </View>
      </WebPortal>
    );
  }
);

const DesktopSessionTabItem = React.memo(
  ({
    tabId,
    title,
    active,
    fallbackTabId,
    onActivateTab,
    onCloseTab,
    onOpenContextMenu,
  }: {
    tabId: string;
    title: string;
    active: boolean;
    fallbackTabId: string | null;
    onActivateTab: (tabId: string) => void;
    onCloseTab: (tabId: string, options: { active: boolean; fallbackTabId: string | null }) => void;
    onOpenContextMenu: (tabId: string, event: any) => void;
  }) => {
    const { theme } = useUnistyles();

    return (
      <Pressable
        onPress={() => onActivateTab(tabId)}
        // @ts-ignore web
        onContextMenu={Platform.OS === 'web' ? (event: any) => onOpenContextMenu(tabId, event) : undefined}
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
          {title}
        </Text>
        <Pressable
          hitSlop={8}
          onPress={(event: any) => {
            event?.stopPropagation?.();
            onCloseTab(tabId, { active, fallbackTabId });
          }}
          style={styles.closeButton}
        >
          <Ionicons name="close" size={12} color={theme.colors.textSecondary} />
        </Pressable>
      </Pressable>
    );
  }
);

export function DesktopSessionTabs({
  activeSessionId,
}: {
  activeSessionId: string;
}) {
  const router = useRouter();
  const tabs = useDesktopSessionTabsState(state => state.tabs);
  const closeTab = useDesktopSessionTabsState(state => state.closeTab);
  const closeOtherTabs = useDesktopSessionTabsState(state => state.closeOtherTabs);
  const closeAllTabs = useDesktopSessionTabsState(state => state.closeAllTabs);
  const [contextMenu, setContextMenu] = React.useState<TabContextMenuState | null>(null);

  const handleActivateTab = React.useCallback(
    (tabId: string) => {
      router.navigate(`/session/${tabId}`);
    },
    [router]
  );

  const handleOpenContextMenu = React.useCallback((tabId: string, event: any) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX ?? event.nativeEvent?.clientX ?? 0,
      y: event.clientY ?? event.nativeEvent?.clientY ?? 0,
      tabId,
    });
  }, []);

  const handleCloseTab = React.useCallback(
    (tabId: string, options: { active: boolean; fallbackTabId: string | null }) => {
      if (options.active) {
        if (options.fallbackTabId) {
          router.navigate(`/session/${options.fallbackTabId}`);
        } else {
          router.navigate('/');
        }
        setTimeout(() => closeTab(tabId), 0);
        return;
      }

      closeTab(tabId);
    },
    [closeTab, router]
  );

  if (tabs.length <= 1) {
    return null;
  }

  return (
    <View style={styles.strip}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
        {tabs.map((tab, index) => {
          const active = tab.id === activeSessionId;
          const fallbackTabId = tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null;
          return (
            <DesktopSessionTabItem
              key={tab.id}
              tabId={tab.id}
              title={tab.title}
              active={active}
              fallbackTabId={fallbackTabId}
              onActivateTab={handleActivateTab}
              onCloseTab={handleCloseTab}
              onOpenContextMenu={handleOpenContextMenu}
            />
          );
        })}
      </ScrollView>
      {contextMenu ? (
        <TabContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onCloseOthers={() => {
            closeOtherTabs(contextMenu.tabId);
            setContextMenu(null);
          }}
          onCloseAll={() => {
            router.navigate('/');
            setContextMenu(null);
            setTimeout(() => closeAllTabs(), 0);
          }}
        />
      ) : null}
    </View>
  );
}
