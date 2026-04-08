import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import {
  loadPermissionItems,
  performPermissionAction,
  type PermissionItem,
  type PermissionState,
} from '@/permissions/permissionCenter';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';

const stylesheet = StyleSheet.create((theme, runtime) => ({
  intro: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
  },
  introTitle: {
    ...Typography.default('semiBold'),
    color: theme.colors.text,
    fontSize: 17,
    lineHeight: 22,
  },
  introText: {
    ...Typography.default(),
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.divider,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowTitleWrap: {
    flex: 1,
  },
  rowTitle: {
    ...Typography.default('semiBold'),
    color: theme.colors.text,
    fontSize: 16,
    lineHeight: 22,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 12,
  },
  statusText: {
    ...Typography.default('semiBold'),
    fontSize: 12,
    lineHeight: 16,
  },
  sectionLabel: {
    ...Typography.default('semiBold'),
    color: theme.colors.text,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 14,
  },
  sectionText: {
    ...Typography.default(),
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  actionButton: {
    marginTop: 16,
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionButtonText: {
    ...Typography.default('semiBold'),
    fontSize: 14,
    lineHeight: 18,
  },
  loadingWrap: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

function getStatusPresentation(
  state: PermissionState,
  theme: ReturnType<typeof useUnistyles>['theme']
): {
  label: string;
  backgroundColor: string;
  color: string;
  iconColor: string;
} {
  switch (state) {
    case 'allowed':
      return {
        label: t('permissions.statusAllowed'),
        backgroundColor: '#E8F5EC',
        color: '#1F7A3D',
        iconColor: '#34C759',
      };
    case 'limited':
      return {
        label: t('permissions.statusLimited'),
        backgroundColor: '#FFF4E5',
        color: '#A35A00',
        iconColor: '#FF9500',
      };
    case 'blocked':
      return {
        label: t('permissions.statusBlocked'),
        backgroundColor: '#FDECEC',
        color: '#B42318',
        iconColor: '#FF3B30',
      };
    case 'notAsked':
      return {
        label: t('permissions.statusNotAsked'),
        backgroundColor: '#FFF4E5',
        color: '#A35A00',
        iconColor: '#FF9500',
      };
    default:
      return {
        label: t('permissions.statusUnavailable'),
        backgroundColor: theme.colors.surfacePressedOverlay,
        color: theme.colors.textSecondary,
        iconColor: theme.colors.textSecondary,
      };
  }
}

function getActionLabel(item: PermissionItem): string | null {
  if (item.action === 'allow') return t('permissions.actionAllow');
  if (item.action === 'manage') return t('permissions.actionManage');
  return null;
}

const PermissionRow = React.memo(function PermissionRow({
  item,
  loading,
  onPress,
  showDivider = true,
}: {
  item: PermissionItem;
  loading: boolean;
  onPress: () => void;
  showDivider?: boolean;
}) {
  const { theme } = useUnistyles();
  const styles = stylesheet;
  const status = getStatusPresentation(item.state, theme);
  const actionLabel = getActionLabel(item);

  return (
    <View style={[styles.row, showDivider && styles.rowDivider]}>
      <View style={styles.rowHeader}>
        <View style={styles.iconWrap}>
          <Ionicons name={item.icon as never} size={24} color={status.iconColor} />
        </View>
        <View style={styles.rowTitleWrap}>
          <Text style={styles.rowTitle}>{t(item.titleKey as never)}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: status.backgroundColor }]}>
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>{t('permissions.whyLabel')}</Text>
      <Text style={styles.sectionText}>{t(item.purposeKey as never)}</Text>

      <Text style={styles.sectionLabel}>{t('permissions.minimizeLabel')}</Text>
      <Text style={styles.sectionText}>{t(item.minimizeKey as never)}</Text>

      {actionLabel ? (
        <Pressable
          onPress={onPress}
          disabled={loading}
          style={({ pressed }) => [
            styles.actionButton,
            {
              backgroundColor: theme.colors.button.primary.background,
              opacity: loading ? 0.7 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={theme.colors.button.primary.tint} size="small" />
          ) : (
            <Text
              style={[
                styles.actionButtonText,
                { color: theme.colors.button.primary.tint },
              ]}
            >
              {actionLabel}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
});

export const PermissionsSettingsView = React.memo(function PermissionsSettingsView() {
  const styles = stylesheet;
  const [items, setItems] = React.useState<PermissionItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [actingPermissionId, setActingPermissionId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const nextItems = await loadPermissionItems();
      setItems(nextItems);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const handleAction = React.useCallback(
    async (item: PermissionItem) => {
      setActingPermissionId(item.id);
      try {
        await performPermissionAction(item);
      } finally {
        setActingPermissionId(null);
        await refresh();
      }
    },
    [refresh]
  );

  const recommended = items.filter(item => item.group === 'recommended');
  const optional = items.filter(item => item.group === 'optional');

  return (
    <ItemList style={{ paddingTop: 0 }}>
      <View style={styles.intro}>
        <Text style={styles.introTitle}>{t('settings.permissions')}</Text>
        <Text style={styles.introText}>{t('permissions.pageDescription')}</Text>
      </View>

      {Platform.OS === 'web' ? (
        <ItemGroup title={t('permissions.browserTitle')} footer={t('permissions.browserMessage')}>
          <Item
            title={t('permissions.browserTitle')}
            subtitle={t('permissions.browserMessage')}
            subtitleLines={0}
            icon={<Ionicons name="globe-outline" size={28} color="#007AFF" />}
            showChevron={false}
          />
        </ItemGroup>
      ) : (
        <>
          <ItemGroup
            title={t('permissions.recommendedTitle')}
            footer={t('permissions.recommendedFooter')}
          >
            {loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="small" />
              </View>
            ) : (
              recommended.map(item => (
                <PermissionRow
                  key={item.id}
                  item={item}
                  loading={actingPermissionId === item.id}
                  onPress={() => void handleAction(item)}
                />
              ))
            )}
          </ItemGroup>

          {optional.length > 0 ? (
            <ItemGroup title={t('permissions.optionalTitle')} footer={t('permissions.optionalFooter')}>
              {optional.map(item => (
                <PermissionRow
                  key={item.id}
                  item={item}
                  loading={actingPermissionId === item.id}
                  onPress={() => void handleAction(item)}
                />
              ))}
            </ItemGroup>
          ) : null}
        </>
      )}
    </ItemList>
  );
});
