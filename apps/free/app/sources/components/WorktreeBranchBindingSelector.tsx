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
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { listLocalGitBranches } from '@/utils/createWorktree';
import {
  defaultWorktreeBranchBinding,
  type WorktreeBranchBinding,
} from '@/utils/worktreeBranchBinding';

interface WorktreeBranchBindingSelectorProps {
  value: WorktreeBranchBinding;
  onChange: (value: WorktreeBranchBinding) => void;
  machineId: string | null;
  basePath: string;
}

/** Theme slice for native &lt;select&gt; / modal */
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
  configureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  configureRowPressed: {
    backgroundColor: theme.colors.surfacePressed,
  },
  configureTitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: 4,
    ...Typography.default('semiBold'),
  },
  configureSummary: {
    fontSize: 16,
    color: theme.colors.text,
    ...Typography.default('regular'),
  },
  chevron: {
    fontSize: 18,
    color: theme.colors.textSecondary,
    marginLeft: 8,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalSheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: 24,
  },
  modalHeader: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.divider,
  },
  modalTitle: {
    fontSize: 17,
    ...Typography.default('semiBold'),
  },
  modalBody: {
    paddingHorizontal: 16,
    paddingTop: 12,
    maxHeight: 340,
  },
  modalHint: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: 12,
    ...Typography.default(),
  },
  sectionLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 6,
    ...Typography.default('semiBold'),
  },
  orLabel: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginVertical: 12,
    textAlign: 'center',
    ...Typography.default(),
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
    marginTop: 8,
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
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.divider,
    marginTop: 8,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalBtnPrimary: {},
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
  branchSheet: {
    maxHeight: '55%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingBottom: 24,
  },
}));

/**
 * Web: &lt;select&gt;. Android: dropdown. iOS: row + modal list.
 */
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
      ...branches.map(b => ({ key: b, label: b, value: b })),
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
      ...branches.map(b => React.createElement('option', { key: b, value: b }, b))
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
          {branches.map(b => (
            <Picker.Item key={b} label={b} value={b} color={theme.colors.text} />
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

/**
 * One-line summary of the binding for the collapsed row.
 */
function bindingSummaryLine(binding: WorktreeBranchBinding): string {
  const ex = binding.existingBranch.trim();
  const nn = binding.newBranchName.trim();
  const sp = binding.startPoint.trim();
  if (ex) {
    return t('newSession.worktree.branchSummaryExisting', { branch: ex });
  }
  if (nn && sp) {
    return t('newSession.worktree.branchSummaryNewWithStart', { name: nn, start: sp });
  }
  if (nn) {
    return t('newSession.worktree.branchSummaryNew', { name: nn });
  }
  if (sp) {
    return t('newSession.worktree.branchSummaryAutoFrom', { start: sp });
  }
  return t('newSession.worktree.branchSummaryAuto');
}

/**
 * Single card: tap opens a modal to pick existing branch and/or new branch; all empty → auto.
 */
export const WorktreeBranchBindingSelector: React.FC<WorktreeBranchBindingSelectorProps> = ({
  value,
  onChange,
  machineId,
  basePath,
}) => {
  const { theme } = useUnistyles();
  const styles = stylesheet;

  const [modalOpen, setModalOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<WorktreeBranchBinding>(() => defaultWorktreeBranchBinding());

  const [branches, setBranches] = React.useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = React.useState(false);
  const [branchLoadError, setBranchLoadError] = React.useState<string | null>(null);

  /**
   * Load local branches for the dropdown inside the modal.
   */
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
      if (list.length === 0) {
        setBranchLoadError(t('newSession.worktree.branchBindingNoBranches'));
      }
    } catch {
      setBranchLoadError(t('newSession.worktree.branchBindingLoadFailed'));
      setBranches([]);
    } finally {
      setLoadingBranches(false);
    }
  }, [machineId, basePath]);

  React.useEffect(() => {
    if (!machineId || !basePath.trim()) {
      return;
    }
    void handleRefreshBranches();
  }, [machineId, basePath, handleRefreshBranches]);

  const openModal = React.useCallback(() => {
    setDraft({
      existingBranch: value.existingBranch,
      newBranchName: value.newBranchName,
      startPoint: value.startPoint,
    });
    setModalOpen(true);
  }, [value]);

  /**
   * Apply draft and close. Empty draft → auto-create on the server.
   */
  const commitModal = React.useCallback(() => {
    onChange({ ...draft });
    setModalOpen(false);
  }, [draft, onChange]);

  const cancelModal = React.useCallback(() => {
    setModalOpen(false);
  }, []);

  const summary = React.useMemo(() => bindingSummaryLine(value), [value]);

  return (
    <View style={styles.card}>
      <Pressable
        onPress={openModal}
        style={({ pressed }) => [styles.configureRow, pressed && styles.configureRowPressed]}
      >
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={styles.configureTitle}>{t('newSession.worktree.branchConfigureTitle')}</Text>
          <Text style={styles.configureSummary} numberOfLines={2}>
            {summary}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <Modal
        visible={modalOpen}
        transparent
        animationType="slide"
        onRequestClose={cancelModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.modalRoot}>
            <Pressable style={{ flex: 1 }} onPress={cancelModal} />
            <View
              style={[
                styles.modalSheet,
                { backgroundColor: theme.colors.surface },
                Platform.OS === 'web' ? ({ maxHeight: '90vh' } as object) : { maxHeight: '88%' },
              ]}
            >
              <View style={[styles.modalHeader, { borderBottomColor: theme.colors.divider }]}>
                <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                  {t('newSession.worktree.branchModalTitle')}
                </Text>
              </View>

              <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
                <Text style={styles.modalHint}>{t('newSession.worktree.branchModalEmptyHint')}</Text>
                <Text style={styles.modalHint}>{t('newSession.worktree.branchModalPriorityHint')}</Text>

                <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                  {t('newSession.worktree.branchPickerHint')}
                </Text>
                <ExistingBranchSelect
                  existingBranch={draft.existingBranch}
                  branches={branches}
                  placeholder={t('newSession.worktree.branchPickerPlaceholder')}
                  theme={theme}
                  onSelect={branch =>
                    setDraft(d => ({ ...d, existingBranch: branch }))
                  }
                />
                <View style={styles.refreshRow}>
                  <Pressable onPress={() => void handleRefreshBranches()}>
                    <Text style={{ fontSize: 14, color: theme.colors.button.primary.background }}>
                      {t('newSession.worktree.branchBindingRefresh')}
                    </Text>
                  </Pressable>
                  {loadingBranches && (
                    <ActivityIndicator size="small" color={theme.colors.button.primary.background} />
                  )}
                </View>
                {branchLoadError ? (
                  <Text style={[styles.modalHint, { marginTop: 6 }]}>{branchLoadError}</Text>
                ) : null}

                <Text style={styles.orLabel}>{t('newSession.worktree.branchModalOr')}</Text>

                <TextInput
                  style={styles.textInput}
                  value={draft.newBranchName}
                  onChangeText={text => setDraft(d => ({ ...d, newBranchName: text }))}
                  placeholder={t('newSession.worktree.newBranchNamePlaceholder')}
                  placeholderTextColor={theme.colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextInput
                  style={[styles.textInput, { marginTop: 10 }]}
                  value={draft.startPoint}
                  onChangeText={text => setDraft(d => ({ ...d, startPoint: text }))}
                  placeholder={t('newSession.worktree.startPointPlaceholder')}
                  placeholderTextColor={theme.colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </ScrollView>

              <View style={[styles.modalFooter, { borderTopColor: theme.colors.divider }]}>
                <Pressable style={styles.modalBtn} onPress={cancelModal}>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 16 }}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable style={styles.modalBtn} onPress={commitModal}>
                  <Text style={{ color: theme.colors.button.primary.background, fontSize: 16, ...Typography.default('semiBold') }}>
                    {t('common.save')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};
