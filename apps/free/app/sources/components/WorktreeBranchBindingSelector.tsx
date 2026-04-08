import React from 'react';
import {
  View,
  Text,
  Pressable,
  Platform,
  TextInput,
  ActivityIndicator,
  Modal,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { listLocalGitBranches } from '@/utils/createWorktree';
import { type WorktreeBranchBinding } from '@/utils/worktreeBranchBinding';

interface WorktreeBranchBindingSelectorProps {
  value: WorktreeBranchBinding;
  onChange: (value: WorktreeBranchBinding) => void;
  machineId: string | null;
  basePath: string;
  homeDir?: string;
  onCreateBranchInputFocus?: () => void;
}

interface BranchSelectThemeColors {
  divider: string;
  input: { background: string };
  text: string;
  textSecondary: string;
  surface: string;
}

const stylesheet = StyleSheet.create(theme => ({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: Platform.select({ default: 12, android: 16 }),
    marginBottom: 12,
    overflow: 'hidden',
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  title: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    ...Typography.default('semiBold'),
  },
  pathHint: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    ...Typography.default('regular'),
  },
  sectionLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 6,
    ...Typography.default('semiBold'),
  },
  textInput: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    color: theme.colors.text,
    fontSize: 15,
    ...Typography.default('regular'),
  },
  selectRow: {
    borderWidth: 1,
    borderColor: theme.colors.divider,
    borderRadius: 8,
    backgroundColor: theme.colors.input.background,
    minHeight: 44,
    justifyContent: 'center',
  },
  selectRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectRowText: {
    fontSize: 15,
    flex: 1,
    ...Typography.default('regular'),
  },
  selectRowChevron: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginLeft: 8,
  },
  androidPicker: {
    width: '100%',
    minHeight: 44,
  },
  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  helperText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 6,
    ...Typography.default(),
  },
  branchSheet: {
    maxHeight: '55%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingBottom: 24,
  },
  modalItem: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.divider,
  },
  modalItemText: {
    fontSize: 16,
    ...Typography.default('regular'),
  },
}));

function ExistingBranchSelect(props: {
  existingBranch: string;
  branches: string[];
  placeholder: string;
  theme: { colors: BranchSelectThemeColors };
  onSelect: (branch: string) => void;
}) {
  const { existingBranch, branches, placeholder, theme, onSelect } = props;
  const styles = stylesheet;
  const [iosOpen, setIosOpen] = React.useState(false);

  const displayLabel = existingBranch.trim().length > 0 ? existingBranch : placeholder;
  const iosListData = React.useMemo(
    () => [
      { key: '__placeholder__', label: placeholder, value: '' },
      ...branches.map(branch => ({ key: branch, label: branch, value: branch })),
    ],
    [branches, placeholder]
  );

  if (Platform.OS === 'web') {
    return React.createElement(
      'select' as any,
      {
        value: existingBranch,
        onChange: (e: { target: { value: string } }) => onSelect(e.target.value),
        style: {
          width: '100%',
          minHeight: 44,
          padding: '10px 12px',
          fontSize: 15,
          borderRadius: 8,
          border: `1px solid ${theme.colors.divider}`,
          backgroundColor: theme.colors.input.background,
          color: existingBranch ? theme.colors.text : theme.colors.textSecondary,
          cursor: 'pointer',
        },
      },
      React.createElement('option', { value: '' }, placeholder),
      ...branches.map(branch => React.createElement('option', { key: branch, value: branch }, branch))
    );
  }

  if (Platform.OS === 'android') {
    return (
      <View style={styles.selectRow}>
        <Picker
          mode="dropdown"
          selectedValue={existingBranch}
          onValueChange={onSelect}
          style={styles.androidPicker}
          dropdownIconColor={theme.colors.textSecondary}
        >
          <Picker.Item label={placeholder} value="" color={theme.colors.textSecondary} />
          {branches.map(branch => (
            <Picker.Item key={branch} label={branch} value={branch} color={theme.colors.text} />
          ))}
        </Picker>
      </View>
    );
  }

  return (
    <>
      <Pressable
        style={styles.selectRow}
        onPress={() => setIosOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={placeholder}
      >
        <View style={styles.selectRowInner}>
          <Text
            style={[styles.selectRowText, !existingBranch && { color: theme.colors.textSecondary }]}
            numberOfLines={1}
          >
            {displayLabel}
          </Text>
          <Text style={styles.selectRowChevron}>▼</Text>
        </View>
      </Pressable>
      <Modal visible={iosOpen} transparent animationType="slide" onRequestClose={() => setIosOpen(false)}>
        <View style={{ flex: 1 }}>
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
            onPress={() => setIosOpen(false)}
          />
          <View style={[styles.branchSheet, { backgroundColor: theme.colors.surface }]}>
            <FlatList
              data={iosListData}
              keyExtractor={item => item.key}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalItem}
                  onPress={() => {
                    onSelect(item.value);
                    setIosOpen(false);
                  }}
                >
                  <Text style={[styles.modalItemText, { color: theme.colors.text }]}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

function formatWorktreeRootPreview(homeDir?: string): string | null {
  if (!homeDir?.trim()) {
    return null;
  }
  return '~/free-worktree/...';
}

function getPreferredBranch(branches: string[], currentBranch: string): string {
  const trimmedCurrentBranch = currentBranch.trim();

  if (trimmedCurrentBranch && branches.includes(trimmedCurrentBranch)) {
    return trimmedCurrentBranch;
  }
  if (branches.includes('main')) {
    return 'main';
  }
  if (branches.includes('master')) {
    return 'master';
  }
  return branches[0] ?? '';
}

export const WorktreeBranchBindingSelector: React.FC<WorktreeBranchBindingSelectorProps> = ({
  value,
  onChange,
  machineId,
  basePath,
  homeDir,
  onCreateBranchInputFocus,
}) => {
  const { theme } = useUnistyles();
  const styles = stylesheet;
  const [branches, setBranches] = React.useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = React.useState(false);
  const [branchLoadError, setBranchLoadError] = React.useState<string | null>(null);

  const storagePreview = React.useMemo(() => formatWorktreeRootPreview(homeDir), [homeDir]);

  const handleRefreshBranches = React.useCallback(async () => {
    if (!machineId || !basePath.trim()) {
      setBranches([]);
      setBranchLoadError(null);
      return;
    }
    setLoadingBranches(true);
    setBranchLoadError(null);
    try {
      const list = await listLocalGitBranches(machineId, basePath);
      setBranches(list);
      const preferredBranch = getPreferredBranch(list, value.existingBranch);

      if (preferredBranch && preferredBranch !== value.existingBranch.trim()) {
        const isCreatingNewBranch = value.newBranchName.trim().length > 0;
        onChange({
          mode: isCreatingNewBranch ? 'new' : 'auto',
          existingBranch: preferredBranch,
          newBranchName: value.newBranchName,
          startPoint: isCreatingNewBranch ? value.startPoint.trim() || preferredBranch : '',
        });
      }
      if (list.length === 0) {
        setBranchLoadError(t('newSession.worktree.branchBindingNoBranches'));
      }
    } catch {
      setBranchLoadError(t('newSession.worktree.branchBindingLoadFailed'));
      setBranches([]);
    } finally {
      setLoadingBranches(false);
    }
  }, [
    basePath,
    machineId,
    onChange,
    value.existingBranch,
    value.newBranchName,
    value.startPoint,
  ]);

  React.useEffect(() => {
    if (!machineId || !basePath.trim()) {
      return;
    }
    void handleRefreshBranches();
  }, [machineId, basePath, handleRefreshBranches]);

  return (
    <View style={styles.card}>
      <View style={styles.content}>
        <Text style={styles.title}>{t('newSession.worktree.branchConfigureTitle')}</Text>
        {storagePreview ? <Text style={styles.pathHint}>{storagePreview}</Text> : null}

        <View>
          <Text style={styles.sectionLabel}>{t('newSession.worktree.branchPickerHint')}</Text>
          <ExistingBranchSelect
            existingBranch={value.existingBranch}
            branches={branches}
            placeholder={t('newSession.worktree.branchPickerPlaceholder')}
            theme={theme}
            onSelect={branch =>
              onChange({
                mode: value.newBranchName.trim() ? 'new' : 'auto',
                existingBranch: branch,
                newBranchName: value.newBranchName,
                startPoint: value.newBranchName.trim() ? branch || value.startPoint : '',
              })
            }
          />
          <View style={styles.refreshRow}>
            <Pressable onPress={() => void handleRefreshBranches()}>
              <Text style={{ fontSize: 14, color: theme.colors.button.primary.background }}>
                {t('newSession.worktree.branchBindingRefresh')}
              </Text>
            </Pressable>
            {loadingBranches ? (
              <ActivityIndicator size="small" color={theme.colors.button.primary.background} />
            ) : null}
          </View>
          {branchLoadError ? <Text style={styles.helperText}>{branchLoadError}</Text> : null}
        </View>

        <View>
          <Text style={styles.sectionLabel}>{t('newSession.worktree.branchModalOr')}</Text>
          <TextInput
            style={styles.textInput}
            value={value.newBranchName}
            onChangeText={text =>
              onChange({
                mode: text.trim() ? 'new' : 'auto',
                existingBranch: value.existingBranch,
                newBranchName: text,
                startPoint: text.trim() ? value.existingBranch || value.startPoint : '',
              })
            }
            onFocus={onCreateBranchInputFocus}
            placeholder={t('newSession.worktree.newBranchNamePlaceholder')}
            placeholderTextColor={theme.colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>
    </View>
  );
};
