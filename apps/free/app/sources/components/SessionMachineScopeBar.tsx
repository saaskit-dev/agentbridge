import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { StatusDot } from './StatusDot';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { t } from '@/text';

export type MachineFilterOption = {
  id: string | null;
  label: string;
  count: number;
  isOnline?: boolean;
  host?: string;
};

const stylesheet = StyleSheet.create(theme => ({
  triggerWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  trigger: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  triggerPressed: {
    backgroundColor: theme.colors.surfacePressedOverlay,
  },
  triggerIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: theme.colors.groupped.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  triggerContent: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    ...Typography.default('semiBold'),
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  title: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  subtitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  countBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: theme.colors.groupped.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  countText: {
    fontSize: 12,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  chevron: {
    marginLeft: 8,
  },
  modalCard: {
    width: 360,
    maxWidth: '92%',
    borderRadius: 24,
    backgroundColor: theme.colors.surface,
    padding: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  modalHeader: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  modalHeaderText: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 17,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  modalDescription: {
    marginTop: 4,
    fontSize: 13,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.groupped.background,
  },
  sectionLabel: {
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 6,
    fontSize: 11,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    ...Typography.default('semiBold'),
  },
  row: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowSelected: {
    backgroundColor: theme.colors.surfaceSelected,
  },
  rowPressed: {
    backgroundColor: theme.colors.surfacePressedOverlay,
  },
  rowLeading: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: theme.colors.groupped.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowContent: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  rowSubtitle: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 3,
    ...Typography.default(),
  },
  rowMeta: {
    alignItems: 'flex-end',
    marginLeft: 12,
    gap: 6,
  },
  rowCountBadge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: theme.colors.groupped.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCountText: {
    fontSize: 12,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
}));

function MachineScopePicker({
  options,
  selectedMachineId,
  onSelect,
  onClose,
}: {
  options: MachineFilterOption[];
  selectedMachineId: string | null;
  onSelect: (machineId: string | null) => void;
  onClose: () => void;
}) {
  const styles = stylesheet;
  const { theme } = useUnistyles();

  const allOption = options.find(option => option.id === null) ?? null;
  const onlineOptions = options.filter(option => option.id !== null && option.isOnline);
  const offlineOptions = options.filter(option => option.id !== null && !option.isOnline);

  const renderOption = React.useCallback(
    (option: MachineFilterOption, isAllMachines: boolean = false) => {
      const isSelected = option.id === selectedMachineId;
      const subtitle = isAllMachines
        ? t('status.machinesOnline', { count: onlineOptions.length })
        : `${option.isOnline ? t('status.online') : t('status.offline')}${option.host ? `  ${option.host}` : ''}`;

      return (
        <Pressable
          key={option.id ?? 'all-machines'}
          style={({ pressed }) => [
            styles.row,
            isSelected ? styles.rowSelected : null,
            pressed ? styles.rowPressed : null,
          ]}
          onPress={() => {
            onSelect(option.id);
            onClose();
          }}
        >
          <View style={styles.rowLeading}>
            {isAllMachines ? (
              <Ionicons name="layers-outline" size={18} color={theme.colors.text} />
            ) : (
              <Ionicons name="desktop-outline" size={18} color={theme.colors.text} />
            )}
          </View>
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>{option.label}</Text>
            <Text style={styles.rowSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          <View style={styles.rowMeta}>
            <View style={styles.rowCountBadge}>
              <Text style={styles.rowCountText}>{option.count}</Text>
            </View>
            {isAllMachines ? null : (
              <StatusDot
                color={
                  option.isOnline
                    ? theme.colors.status.connected
                    : theme.colors.status.disconnected
                }
                isPulsing={option.isOnline}
                size={7}
              />
            )}
          </View>
        </Pressable>
      );
    },
    [onClose, onSelect, onlineOptions.length, selectedMachineId, styles, theme.colors.status.connected, theme.colors.status.disconnected, theme.colors.text]
  );

  return (
    <View style={styles.modalCard}>
      <View style={styles.modalHeader}>
        <View style={styles.modalHeaderText}>
          <Text style={styles.modalTitle}>{t('machinePicker.headerTitle')}</Text>
          <Text style={styles.modalDescription}>{t('sidebar.machineFilterDescription')}</Text>
        </View>
        <Pressable style={styles.modalCloseButton} onPress={onClose}>
          <Ionicons name="close" size={18} color={theme.colors.text} />
        </Pressable>
      </View>

      {allOption ? renderOption(allOption, true) : null}

      {onlineOptions.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>{t('status.online')}</Text>
          {onlineOptions.map(option => renderOption(option))}
        </>
      ) : null}

      {offlineOptions.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>{t('status.offline')}</Text>
          {offlineOptions.map(option => renderOption(option))}
        </>
      ) : null}
    </View>
  );
}

export const SessionMachineScopeBar = React.memo(
  ({
    options,
    selectedMachineId,
    onSelect,
  }: {
    options: MachineFilterOption[];
    selectedMachineId: string | null;
    onSelect: (machineId: string | null) => void;
  }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();

    const selectedOption =
      options.find(option => option.id === selectedMachineId) ??
      options.find(option => option.id === null) ??
      null;
    const onlineCount = options.filter(option => option.id !== null && option.isOnline).length;

    if (!selectedOption) {
      return null;
    }

    return (
      <View style={styles.triggerWrap}>
        <Pressable
          style={({ pressed }) => [styles.trigger, pressed ? styles.triggerPressed : null]}
          onPress={() => {
            Modal.show({
              component: MachineScopePicker,
              props: {
                options,
                selectedMachineId,
                onSelect,
              },
            });
          }}
        >
          <View style={styles.triggerIcon}>
            <Ionicons name="funnel-outline" size={18} color={theme.colors.text} />
          </View>
          <View style={styles.triggerContent}>
            <Text style={styles.eyebrow}>{t('sidebar.scopeLabel')}</Text>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>
                {selectedOption.label}
              </Text>
            </View>
            <View style={styles.subtitleRow}>
              {selectedMachineId ? (
                <>
                  <StatusDot
                    color={
                      selectedOption.isOnline
                        ? theme.colors.status.connected
                        : theme.colors.status.disconnected
                    }
                    isPulsing={selectedOption.isOnline}
                    size={7}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {selectedOption.isOnline ? t('status.online') : t('status.offline')}
                    {selectedOption.host ? `  ${selectedOption.host}` : ''}
                  </Text>
                </>
              ) : (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {t('status.machinesOnline', { count: onlineCount })}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{selectedOption.count}</Text>
          </View>
          <Ionicons
            name="chevron-down"
            size={18}
            color={theme.colors.textSecondary}
            style={styles.chevron}
          />
        </Pressable>
      </View>
    );
  }
);
