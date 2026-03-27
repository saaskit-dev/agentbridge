import { Ionicons, Octicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as React from 'react';
import {
  View,
  Platform,
  useWindowDimensions,
  ViewStyle,
  Text,
  ActivityIndicator,
  TouchableWithoutFeedback,
  Image as RNImage,
  Pressable,
} from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { AgentInputAutocomplete } from './AgentInputAutocomplete';
import { applySuggestion } from './autocomplete/applySuggestion';
import { useActiveSuggestions } from './autocomplete/useActiveSuggestions';
import { useActiveWord } from './autocomplete/useActiveWord';
import { AgentFlavorIcon } from './AgentFlavorIcon';
import { FloatingOverlay } from './FloatingOverlay';
import { GitStatusBadge, useHasMeaningfulGitStatus } from './GitStatusBadge';
import { hapticsLight, hapticsError } from './haptics';
import { layout } from './layout';
import { MultiTextInput, KeyPressEvent } from './MultiTextInput';
import { TextInputState, MultiTextInputHandle } from './MultiTextInput';
import type { ModelMode } from './PermissionModeSelector';
import { Typography } from '@/constants/Typography';
import { Shaker, ShakeInstance } from './Shaker';
import { StatusDot } from './StatusDot';
import {
  getAgentDescription,
  getAgentDisplayName,
  isExperimentalAgent,
  normalizeAgentFlavor,
  type AppAgentFlavor,
} from '@/sync/agentFlavor';
import { useSetting } from '@/sync/storage';
import { Metadata } from '@/sync/storageTypes';
import {
  getVisibleConfigOptions,
  PermissionMode,
  SessionCapabilities,
  usesDiscoveredCapabilitiesOnly,
} from '@/sync/sessionCapabilities';
import { t } from '@/text';
import { Theme } from '@/theme';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/components/AgentInput');

interface AgentInputProps {
  value: string;
  placeholder: string;
  onChangeText: (text: string) => void;
  sessionId?: string;
  onSend: () => void;
  sendIcon?: React.ReactNode;
  onMicPress?: () => void;
  isMicActive?: boolean;
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  modelMode?: ModelMode;
  onModelModeChange?: (mode: ModelMode) => void;
  capabilities?: SessionCapabilities | null;
  actualModelLabel?: string | null;
  actualModeLabel?: string | null;
  pendingCapabilityLabel?: string | null;
  onAgentModeChange?: (modeId: string) => void;
  onConfigOptionChange?: (optionId: string, value: string) => void;
  onRunCommand?: (commandId: string) => void;
  isSettingsBusy?: boolean;
  metadata?: Metadata | null;
  onAbort?: () => void | Promise<void>;
  showAbortButton?: boolean;
  connectionStatus?: {
    text: string;
    color: string;
    dotColor: string;
    isPulsing?: boolean;
    cliStatus?: {
      'claude-native': boolean | null;
      claude?: boolean | null;
      codex?: boolean | null;
      gemini?: boolean | null;
      opencode?: boolean | null;
      cursor?: boolean | null;
    };
  };
  autocompletePrefixes: string[];
  autocompleteSuggestions: (
    query: string
  ) => Promise<{ key: string; text: string; component: React.ElementType }[]>;
  usageData?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreation: number;
    cacheRead: number;
    contextSize: number;
  };
  alwaysShowContextSize?: boolean;
  onFileViewerPress?: () => void;
  agentType?: AppAgentFlavor;
  availableAgentTypes?: AppAgentFlavor[];
  onAgentChange?: (agent: AppAgentFlavor) => void;
  onAgentClick?: () => void;
  machineName?: string | null;
  onMachineClick?: () => void;
  currentPath?: string | null;
  onPathClick?: () => void;
  isSendDisabled?: boolean;
  isSending?: boolean;
  minHeight?: number;
  onPickImages?: () => void;
  pendingAttachments?: Array<{ localUri: string; uploading: boolean; error?: string }>;
  onRemoveAttachment?: (index: number) => void;
}

const MAX_CONTEXT_SIZE = 190000;

const stylesheet = StyleSheet.create((theme, runtime) => ({
  container: {
    alignItems: 'center',
    paddingBottom: 8,
    paddingTop: 8,
  },
  innerContainer: {
    width: '100%',
    position: 'relative',
  },
  unifiedPanel: {
    backgroundColor: theme.colors.input.background,
    borderRadius: Platform.select({ default: 16, android: 20 }),
    overflow: 'hidden',
    paddingVertical: 2,
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 4,
    minHeight: 40,
  },

  // Overlay styles
  autocompleteOverlay: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    marginBottom: 8,
    zIndex: 1000,
  },
  settingsOverlay: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    marginBottom: 8,
    zIndex: 1000,
  },
  overlayBackdrop: {
    position: 'absolute',
    top: -1000,
    left: -1000,
    right: -1000,
    bottom: -1000,
    zIndex: 999,
  },
  overlaySection: {
    paddingVertical: 8,
  },
  overlaySectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    paddingHorizontal: 16,
    paddingBottom: 4,
    ...Typography.default('semiBold'),
  },
  overlayDivider: {
    height: 1,
    backgroundColor: theme.colors.divider,
    marginHorizontal: 16,
  },

  // Selection styles
  selectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'transparent',
  },
  selectionItemPressed: {
    backgroundColor: theme.colors.surfacePressed,
  },
  radioButton: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioButtonActive: {
    borderColor: theme.colors.radio.active,
  },
  radioButtonInactive: {
    borderColor: theme.colors.radio.inactive,
  },
  radioButtonDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.radio.dot,
  },
  selectionLabel: {
    fontSize: 14,
    ...Typography.default(),
  },
  selectionLabelActive: {
    color: theme.colors.radio.active,
  },
  selectionLabelInactive: {
    color: theme.colors.text,
  },

  // Status styles
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 11,
    ...Typography.default(),
  },
  permissionModeContainer: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  permissionModeText: {
    fontSize: 11,
    ...Typography.default(),
  },
  contextWarningText: {
    fontSize: 11,
    marginLeft: 8,
    ...Typography.default(),
  },

  // Button styles
  actionButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 0,
  },
  actionButtonsLeft: {
    flexDirection: 'row',
    gap: 8,
    flex: 1,
    overflow: 'hidden',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Platform.select({ default: 16, android: 20 }),
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: 'center',
    height: 32,
  },
  actionButtonPressed: {
    opacity: 0.7,
  },
  actionButtonIcon: {
    color: theme.colors.button.secondary.tint,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    marginLeft: 8,
  },
  sendButtonActive: {
    backgroundColor: theme.colors.button.primary.background,
  },
  sendButtonInactive: {
    backgroundColor: theme.colors.button.primary.disabled,
  },
  sendButtonInner: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonInnerPressed: {
    opacity: 0.7,
  },
  sendButtonIcon: {
    color: theme.colors.button.primary.tint,
  },
}));

const getContextWarning = (contextSize: number, alwaysShow: boolean = false, theme: Theme) => {
  const percentageUsed = (contextSize / MAX_CONTEXT_SIZE) * 100;
  const percentageRemaining = Math.max(0, Math.min(100, 100 - percentageUsed));

  if (percentageRemaining <= 5) {
    return {
      text: t('agentInput.context.remaining', { percent: Math.round(percentageRemaining) }),
      color: theme.colors.warningCritical,
    };
  } else if (percentageRemaining <= 10) {
    return {
      text: t('agentInput.context.remaining', { percent: Math.round(percentageRemaining) }),
      color: theme.colors.warning,
    };
  } else if (alwaysShow) {
    // Show context remaining in neutral color when not near limit
    return {
      text: t('agentInput.context.remaining', { percent: Math.round(percentageRemaining) }),
      color: theme.colors.warning,
    };
  }
  return null; // No display needed
};

export const AgentInput = React.memo(
  React.forwardRef<MultiTextInputHandle, AgentInputProps>((props, ref) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const screenWidth = useWindowDimensions().width;

    const hasText = props.value.trim().length > 0;
    const hasReadyAttachments = (props.pendingAttachments ?? []).some(a => !a.uploading && !a.error);
    const canSend = hasText || hasReadyAttachments;

    // Check if this is a Codex, Gemini, or OpenCode session
    // Use metadata.flavor for existing sessions, agentType prop for new sessions
    const isSandboxEnabled = React.useMemo(() => {
      const sandbox = props.metadata?.sandbox as unknown;
      if (!sandbox) {
        return false;
      }
      if (typeof sandbox === 'object' && sandbox !== null && 'enabled' in sandbox) {
        return Boolean((sandbox as { enabled?: unknown }).enabled);
      }
      return true;
    }, [props.metadata?.sandbox]);
    const withSandboxSuffix = React.useCallback(
      (label: string, mode: PermissionMode | undefined) => {
        if (!isSandboxEnabled) {
          return label;
        }
        if (mode === 'yolo') {
          return `${label} (sandboxed)`;
        }
        return label;
      },
      [isSandboxEnabled]
    );

    // Calculate context warning
    const contextWarning = props.usageData?.contextSize
      ? getContextWarning(props.usageData.contextSize, props.alwaysShowContextSize ?? false, theme)
      : null;
    const modelCapabilities = props.capabilities?.models;
    const modeCapabilities = props.capabilities?.modes;
    const hasAgentModeList = (modeCapabilities?.available?.length ?? 0) > 0;
    const usesDiscoveredCapabilities = usesDiscoveredCapabilitiesOnly(
      (props.metadata?.flavor ?? props.agentType) || 'claude'
    );
    const showLocalPermissionModeControls = !usesDiscoveredCapabilities;
    const currentModelId = props.modelMode ?? modelCapabilities?.current;
    const extraConfigOptions = React.useMemo(
      () => getVisibleConfigOptions(props.capabilities),
      [props.capabilities]
    );
    const uniqueCapabilityCommands = React.useMemo(() => {
      const commands = props.capabilities?.commands ?? [];
      const deduped = new Map<string, (typeof commands)[number]>();
      for (const command of commands) {
        const key = command.id || command.name;
        if (!deduped.has(key)) {
          deduped.set(key, command);
        }
      }
      return Array.from(deduped.values());
    }, [props.capabilities?.commands]);
    const hasDiscoveredCapabilities =
      hasAgentModeList ||
      (modelCapabilities?.available?.length ?? 0) > 0 ||
      extraConfigOptions.length > 0 ||
      uniqueCapabilityCommands.length > 0;
    const cliStatus = props.connectionStatus?.cliStatus;
    const cliStatusItems = React.useMemo(
      () => [
        { key: 'claude-native', available: cliStatus?.['claude-native'] },
        ...(cliStatus?.claude !== undefined
          ? [{ key: 'claude', available: cliStatus.claude }]
          : []),
        ...(cliStatus?.['codex'] !== undefined
          ? [{ key: 'codex', available: cliStatus['codex'] }]
          : []),
        ...(cliStatus?.gemini !== undefined
          ? [{ key: 'gemini', available: cliStatus.gemini }]
          : []),
        ...(cliStatus?.opencode !== undefined
          ? [{ key: 'opencode', available: cliStatus.opencode }]
          : []),
        ...(cliStatus?.cursor !== undefined
          ? [{ key: 'cursor', available: cliStatus.cursor }]
          : []),
      ],
      [
        cliStatus?.['claude-native'],
        cliStatus?.claude,
        cliStatus?.['codex'],
        cliStatus?.gemini,
        cliStatus?.opencode,
        cliStatus?.cursor,
      ]
    );
    const hasCapabilityStatus = !!(props.actualModeLabel || props.actualModelLabel);

    const agentInputEnterToSend = useSetting('agentInputEnterToSend');

    // Abort button state
    const [isAborting, setIsAborting] = React.useState(false);
    const shakerRef = React.useRef<ShakeInstance>(null);
    const inputRef = React.useRef<MultiTextInputHandle>(null);

    // Forward ref to the MultiTextInput
    React.useImperativeHandle(ref, () => inputRef.current!, []);

    // Autocomplete state - track text and selection together
    const [inputState, setInputState] = React.useState<TextInputState>({
      text: props.value,
      selection: { start: 0, end: 0 },
    });

    // Handle combined text and selection state changes
    const handleInputStateChange = React.useCallback((newState: TextInputState) => {
      // logger.debug('📝 Input state changed:', JSON.stringify(newState));
      setInputState(newState);
    }, []);

    // Use the tracked selection from inputState
    const activeWord = useActiveWord(
      inputState.text,
      inputState.selection,
      props.autocompletePrefixes
    );
    // Using default options: clampSelection=true, autoSelectFirst=true, wrapAround=true
    // To customize: useActiveSuggestions(activeWord, props.autocompleteSuggestions, { clampSelection: false, wrapAround: false })
    const [suggestions, selected, moveUp, moveDown] = useActiveSuggestions(
      activeWord,
      props.autocompleteSuggestions,
      { clampSelection: true, wrapAround: true }
    );

    // Debug logging
    // React.useEffect(() => {
    //     logger.debug('🔍 Autocomplete Debug:', JSON.stringify({
    //         value: props.value,
    //         inputState,
    //         activeWord,
    //         suggestionsCount: suggestions.length,
    //         selected,
    //         prefixes: props.autocompletePrefixes
    //     }, null, 2));
    // }, [props.value, inputState, activeWord, suggestions.length, selected]);

    // Handle suggestion selection
    const handleSuggestionSelect = React.useCallback(
      (index: number) => {
        if (!suggestions[index] || !inputRef.current) return;

        const suggestion = suggestions[index];

        // Apply the suggestion
        const result = applySuggestion(
          inputState.text,
          inputState.selection,
          suggestion.text,
          props.autocompletePrefixes,
          true // add space after
        );

        // Use imperative API to set text and selection
        inputRef.current.setTextAndSelection(result.text, {
          start: result.cursorPosition,
          end: result.cursorPosition,
        });

        // logger.debug('Selected suggestion:', suggestion.text);

        // Small haptic feedback
        hapticsLight();
      },
      [suggestions, inputState, props.autocompletePrefixes]
    );

    // Settings modal state
    const [showSettings, setShowSettings] = React.useState(false);

    // Agent picker overlay state
    const [showAgentPicker, setShowAgentPicker] = React.useState(false);

    // Handle settings button press
    const handleSettingsPress = React.useCallback(() => {
      if (props.isSettingsBusy) {
        return;
      }
      hapticsLight();
      setShowSettings(prev => !prev);
    }, [props.isSettingsBusy]);

    // Handle settings selection
    const handleSettingsSelect = React.useCallback(
      (mode: PermissionMode) => {
        hapticsLight();
        props.onPermissionModeChange?.(mode);
        // Don't close the settings overlay - let users see the change and potentially switch again
      },
      [props.onPermissionModeChange]
    );

    // Handle abort button press
    const handleAbortPress = React.useCallback(async () => {
      if (!props.onAbort) return;

      hapticsError();
      setIsAborting(true);
      const startTime = Date.now();

      try {
        await props.onAbort?.();

        // Ensure minimum 300ms loading time
        const elapsed = Date.now() - startTime;
        if (elapsed < 300) {
          await new Promise(resolve => setTimeout(resolve, 300 - elapsed));
        }
      } catch (error) {
        // Shake on error
        shakerRef.current?.shake();
        logger.error('Abort RPC call failed:', toError(error));
      } finally {
        setIsAborting(false);
      }
    }, [props.onAbort]);

    // Handle keyboard navigation
    const handleKeyPress = React.useCallback(
      (event: KeyPressEvent): boolean => {
        // Handle autocomplete navigation first
        if (suggestions.length > 0) {
          if (event.key === 'ArrowUp') {
            moveUp();
            return true;
          } else if (event.key === 'ArrowDown') {
            moveDown();
            return true;
          } else if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
            // Both Enter and Tab select the current suggestion
            // If none selected (selected === -1), select the first one
            const indexToSelect = selected >= 0 ? selected : 0;
            handleSuggestionSelect(indexToSelect);
            return true;
          } else if (event.key === 'Escape') {
            // Clear suggestions by collapsing selection (triggers activeWord to clear)
            if (inputRef.current) {
              const cursorPos = inputState.selection.start;
              inputRef.current.setTextAndSelection(inputState.text, {
                start: cursorPos,
                end: cursorPos,
              });
            }
            return true;
          }
        }

        // Handle Escape for abort when no suggestions are visible
        if (event.key === 'Escape' && props.showAbortButton && props.onAbort && !isAborting) {
          handleAbortPress();
          return true;
        }

        // Original key handling
        if (Platform.OS === 'web') {
          if (agentInputEnterToSend && event.key === 'Enter' && !event.shiftKey) {
            if (props.value.trim()) {
              props.onSend();
              return true; // Key was handled
            }
          }
          // Handle Shift+Tab for mode switching
          if (event.key === 'Tab' && event.shiftKey) {
            if (props.isSettingsBusy) {
              return true;
            }

            if (hasAgentModeList && props.onAgentModeChange && modeCapabilities) {
              const currentIndex = modeCapabilities.available.findIndex(
                mode => mode.id === modeCapabilities.current
              );
              const nextIndex =
                currentIndex >= 0 ? (currentIndex + 1) % modeCapabilities.available.length : 0;
              const nextMode = modeCapabilities.available[nextIndex];
              if (nextMode) {
                props.onAgentModeChange(nextMode.id);
                hapticsLight();
              }
              return true; // Key was handled, prevent default tab behavior
            }

            if (showLocalPermissionModeControls && props.onPermissionModeChange) {
              const modeOrder: PermissionMode[] = ['read-only', 'accept-edits', 'yolo'];
              const currentIndex = modeOrder.indexOf(props.permissionMode || 'accept-edits');
              const nextIndex = (currentIndex + 1) % modeOrder.length;
              props.onPermissionModeChange(modeOrder[nextIndex]);
              hapticsLight();
              return true; // Key was handled, prevent default tab behavior
            }
          }
        }
        return false; // Key was not handled
      },
      [
        suggestions,
        moveUp,
        moveDown,
        selected,
        handleSuggestionSelect,
        props.showAbortButton,
        props.onAbort,
        isAborting,
        handleAbortPress,
        agentInputEnterToSend,
        props.value,
        props.onSend,
        hasAgentModeList,
        modeCapabilities,
        props.onAgentModeChange,
        props.permissionMode,
        props.onPermissionModeChange,
        props.isSettingsBusy,
        showLocalPermissionModeControls,
      ]
    );

    return (
      <View style={[styles.container, { paddingHorizontal: screenWidth > 700 ? 16 : 8 }]}>
        <View style={[styles.innerContainer, { maxWidth: layout.maxWidth }]}>
          {/* Autocomplete suggestions overlay */}
          {suggestions.length > 0 && (
            <View
              style={[styles.autocompleteOverlay, { paddingHorizontal: screenWidth > 700 ? 0 : 8 }]}
            >
              <AgentInputAutocomplete
                suggestions={suggestions.map(s => {
                  const Component = s.component;
                  return <Component key={s.key} />;
                })}
                selectedIndex={selected}
                onSelect={handleSuggestionSelect}
                itemHeight={48}
              />
            </View>
          )}

          {/* Settings overlay */}
          {showSettings && (
            <>
              <TouchableWithoutFeedback onPress={() => setShowSettings(false)}>
                <View style={styles.overlayBackdrop} />
              </TouchableWithoutFeedback>
              <View
                style={[styles.settingsOverlay, { paddingHorizontal: screenWidth > 700 ? 0 : 8 }]}
              >
                <FloatingOverlay maxHeight={400} keyboardShouldPersistTaps="always">
                  {/* Permission Mode Section */}
                  {showLocalPermissionModeControls && !hasAgentModeList && (
                    <>
                      <View style={styles.overlaySection}>
                        <Text style={styles.overlaySectionTitle}>
                          {t('agentInput.permissionMode.title')}
                        </Text>
                        {(['read-only', 'accept-edits', 'yolo'] as const).map(mode => {
                          const modeConfig: Record<PermissionMode, { label: string }> = {
                            'read-only': { label: t('agentInput.permissionMode.readOnly') },
                            'accept-edits': { label: t('agentInput.permissionMode.acceptEdits') },
                            yolo: { label: t('agentInput.permissionMode.yolo') },
                          };
                          const config = modeConfig[mode];
                          if (!config) return null;
                          const isSelected = props.permissionMode === mode;

                          return (
                            <Pressable
                              key={mode}
                              onPress={() => handleSettingsSelect(mode)}
                              disabled={props.isSettingsBusy}
                              style={({ pressed }) => ({
                                flexDirection: 'row',
                                alignItems: 'center',
                                paddingHorizontal: 16,
                                paddingVertical: 8,
                                backgroundColor: pressed
                                  ? theme.colors.surfacePressed
                                  : 'transparent',
                                opacity: props.isSettingsBusy ? 0.5 : 1,
                              })}
                            >
                              <View
                                style={{
                                  width: 16,
                                  height: 16,
                                  borderRadius: 8,
                                  borderWidth: 2,
                                  borderColor: isSelected
                                    ? theme.colors.radio.active
                                    : theme.colors.radio.inactive,
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  marginRight: 12,
                                }}
                              >
                                {isSelected && (
                                  <View
                                    style={{
                                      width: 6,
                                      height: 6,
                                      borderRadius: 3,
                                      backgroundColor: theme.colors.radio.dot,
                                    }}
                                  />
                                )}
                              </View>
                              <Text
                                style={{
                                  fontSize: 14,
                                  color: isSelected ? theme.colors.radio.active : theme.colors.text,
                                  ...Typography.default(),
                                }}
                              >
                                {withSandboxSuffix(config.label, mode as PermissionMode)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      {/* Divider */}
                      <View
                        style={{
                          height: 1,
                          backgroundColor: theme.colors.divider,
                          marginHorizontal: 16,
                        }}
                      />
                    </>
                  )}

                  {/* Model Section */}
                  {modeCapabilities?.available?.length ? (
                    <View style={styles.overlaySection}>
                      <Text style={styles.overlaySectionTitle}>
                        {t('agentInput.agentModeTitle')}
                      </Text>
                      {modeCapabilities.available.map(mode => {
                        const isSelected = modeCapabilities.current === mode.id;
                        return (
                          <Pressable
                            key={mode.id}
                            onPress={() => {
                              hapticsLight();
                              props.onAgentModeChange?.(mode.id);
                            }}
                            disabled={props.isSettingsBusy}
                            style={({ pressed }) => ({
                              flexDirection: 'row',
                              alignItems: 'center',
                              paddingHorizontal: 16,
                              paddingVertical: 8,
                              backgroundColor: pressed
                                ? theme.colors.surfacePressed
                                : 'transparent',
                              opacity: props.isSettingsBusy ? 0.5 : 1,
                            })}
                          >
                            <View
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: 8,
                                borderWidth: 2,
                                borderColor: isSelected
                                  ? theme.colors.radio.active
                                  : theme.colors.radio.inactive,
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginRight: 12,
                              }}
                            >
                              {isSelected && <View style={styles.radioButtonDot} />}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text
                                style={{
                                  fontSize: 14,
                                  color: isSelected ? theme.colors.radio.active : theme.colors.text,
                                  ...Typography.default(),
                                }}
                              >
                                {mode.name}
                              </Text>
                              {!!mode.description && (
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: theme.colors.textSecondary,
                                    ...Typography.default(),
                                  }}
                                >
                                  {mode.description}
                                </Text>
                              )}
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}

                  {modelCapabilities?.available?.length ? (
                    <View style={styles.overlaySection}>
                      <Text style={styles.overlaySectionTitle}>{t('agentInput.model.title')}</Text>
                      {modelCapabilities.available.map(model => {
                        const isSelected = currentModelId === model.id;
                        return (
                          <Pressable
                            key={model.id}
                            onPress={() => {
                              hapticsLight();
                              props.onModelModeChange?.(model.id);
                            }}
                            disabled={props.isSettingsBusy}
                            style={({ pressed }) => ({
                              flexDirection: 'row',
                              alignItems: 'center',
                              paddingHorizontal: 16,
                              paddingVertical: 8,
                              backgroundColor: pressed
                                ? theme.colors.surfacePressed
                                : 'transparent',
                              opacity: props.isSettingsBusy ? 0.5 : 1,
                            })}
                          >
                            <View
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: 8,
                                borderWidth: 2,
                                borderColor: isSelected
                                  ? theme.colors.radio.active
                                  : theme.colors.radio.inactive,
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginRight: 12,
                              }}
                            >
                              {isSelected && <View style={styles.radioButtonDot} />}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text
                                style={{
                                  fontSize: 14,
                                  color: isSelected ? theme.colors.radio.active : theme.colors.text,
                                  ...Typography.default(),
                                }}
                              >
                                {model.name}
                              </Text>
                              {!!model.description && (
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: theme.colors.textSecondary,
                                    ...Typography.default(),
                                  }}
                                >
                                  {model.description}
                                </Text>
                              )}
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}

                  {extraConfigOptions.map(option => (
                    <View key={option.id} style={styles.overlaySection}>
                      <Text style={styles.overlaySectionTitle}>{option.name}</Text>
                      {option.options.map(choice => {
                        const isSelected = option.currentValue === choice.value;
                        return (
                          <Pressable
                            key={choice.value}
                            onPress={() => {
                              hapticsLight();
                              props.onConfigOptionChange?.(option.id, choice.value);
                            }}
                            disabled={props.isSettingsBusy}
                            style={({ pressed }) => ({
                              flexDirection: 'row',
                              alignItems: 'center',
                              paddingHorizontal: 16,
                              paddingVertical: 8,
                              backgroundColor: pressed
                                ? theme.colors.surfacePressed
                                : 'transparent',
                              opacity: props.isSettingsBusy ? 0.5 : 1,
                            })}
                          >
                            <View
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: 8,
                                borderWidth: 2,
                                borderColor: isSelected
                                  ? theme.colors.radio.active
                                  : theme.colors.radio.inactive,
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginRight: 12,
                              }}
                            >
                              {isSelected && <View style={styles.radioButtonDot} />}
                            </View>
                            <Text
                              style={{
                                fontSize: 14,
                                color: isSelected ? theme.colors.radio.active : theme.colors.text,
                                ...Typography.default(),
                              }}
                            >
                              {choice.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}

                  {uniqueCapabilityCommands.length ? (
                    <View style={styles.overlaySection}>
                      <Text style={styles.overlaySectionTitle}>Commands</Text>
                      {uniqueCapabilityCommands.map(command => (
                        <Pressable
                          key={command.id}
                          onPress={() => {
                            hapticsLight();
                            props.onRunCommand?.(command.id);
                            setShowSettings(false);
                          }}
                          disabled={props.isSettingsBusy}
                          style={({ pressed }) => ({
                            paddingHorizontal: 16,
                            paddingVertical: 8,
                            backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
                            opacity: props.isSettingsBusy ? 0.5 : 1,
                          })}
                        >
                          <Text
                            style={{
                              fontSize: 14,
                              color: theme.colors.text,
                              ...Typography.default(),
                            }}
                          >
                            {command.name}
                          </Text>
                          {!!command.description && (
                            <Text
                              style={{
                                fontSize: 11,
                                color: theme.colors.textSecondary,
                                ...Typography.default(),
                              }}
                            >
                              {command.description}
                            </Text>
                          )}
                        </Pressable>
                      ))}
                    </View>
                  ) : null}

                  {!hasDiscoveredCapabilities ? (
                    <View style={{ paddingVertical: 8 }}>
                      <Text
                        style={{
                          fontSize: 13,
                          color: theme.colors.textSecondary,
                          paddingHorizontal: 16,
                          paddingVertical: 8,
                          ...Typography.default(),
                        }}
                      >
                        {usesDiscoveredCapabilities
                          ? 'Capabilities will be discovered automatically after your first message.'
                          : t('agentInput.model.configureInCli')}
                      </Text>
                    </View>
                  ) : null}
                </FloatingOverlay>
              </View>
            </>
          )}

          {/* Agent picker overlay */}
          {showAgentPicker && props.availableAgentTypes && props.onAgentChange && (
            <>
              <TouchableWithoutFeedback onPress={() => setShowAgentPicker(false)}>
                <View style={styles.overlayBackdrop} />
              </TouchableWithoutFeedback>
              <View
                style={[styles.settingsOverlay, { paddingHorizontal: screenWidth > 700 ? 0 : 8 }]}
              >
                <FloatingOverlay maxHeight={400} keyboardShouldPersistTaps="always">
                  <View style={styles.overlaySection}>
                    <Text style={styles.overlaySectionTitle}>{t('agentInput.agentTitle')}</Text>
                    {(() => {
                      const stableAgents = props.availableAgentTypes!.filter(
                        a => !isExperimentalAgent(a)
                      );
                      const experimentalAgents = props.availableAgentTypes!.filter(a =>
                        isExperimentalAgent(a)
                      );

                      const renderAgentRow = (agent: AppAgentFlavor) => {
                        const isSelected = agent === props.agentType;
                        return (
                          <Pressable
                            key={agent}
                            onPress={() => {
                              hapticsLight();
                              props.onAgentChange?.(agent);
                              setShowAgentPicker(false);
                            }}
                            style={({ pressed }) => ({
                              flexDirection: 'row',
                              alignItems: 'center',
                              paddingHorizontal: 16,
                              paddingVertical: 8,
                              backgroundColor: pressed
                                ? theme.colors.surfacePressed
                                : 'transparent',
                            })}
                          >
                            <View
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: 8,
                                borderWidth: 2,
                                borderColor: isSelected
                                  ? theme.colors.radio.active
                                  : theme.colors.radio.inactive,
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginRight: 12,
                              }}
                            >
                              {isSelected && (
                                <View
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: 3,
                                    backgroundColor: theme.colors.radio.dot,
                                  }}
                                />
                              )}
                            </View>
                            <View style={{ marginRight: 8 }}>
                              <AgentFlavorIcon flavor={agent} size={14} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text
                                style={{
                                  fontSize: 14,
                                  color: isSelected ? theme.colors.radio.active : theme.colors.text,
                                  ...Typography.default(),
                                }}
                              >
                                {getAgentDisplayName(agent)}
                              </Text>
                              <Text
                                style={{
                                  fontSize: 11,
                                  color: theme.colors.textSecondary,
                                  ...Typography.default(),
                                }}
                                numberOfLines={1}
                              >
                                {getAgentDescription(agent)}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      };

                      return (
                        <>
                          {stableAgents.map(renderAgentRow)}
                          {experimentalAgents.length > 0 && (
                            <>
                              <Text
                                style={{
                                  fontSize: 11,
                                  color: theme.colors.textSecondary,
                                  paddingHorizontal: 16,
                                  paddingTop: 12,
                                  paddingBottom: 4,
                                  ...Typography.default('semiBold'),
                                }}
                              >
                                {t('agentInput.experimentalSection')}
                              </Text>
                              {experimentalAgents.map(renderAgentRow)}
                            </>
                          )}
                        </>
                      );
                    })()}
                  </View>
                </FloatingOverlay>
              </View>
            </>
          )}

          {/* Connection status, context warning, and permission mode */}
          {(props.connectionStatus ||
            contextWarning ||
            hasCapabilityStatus ||
            props.pendingCapabilityLabel) && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
                paddingBottom: 4,
                minHeight: 20, // Fixed minimum height to prevent jumping
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  flex: 1,
                  flexWrap: 'wrap',
                  gap: 11,
                  rowGap: 2,
                }}
              >
                {props.connectionStatus && (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <StatusDot
                        color={props.connectionStatus.dotColor}
                        isPulsing={props.connectionStatus.isPulsing}
                        size={6}
                      />
                      <Text
                        style={{
                          fontSize: 11,
                          color: props.connectionStatus.color,
                          ...Typography.default(),
                        }}
                      >
                        {props.connectionStatus.text}
                      </Text>
                    </View>
                    {/* CLI Status - only shown when provided (wizard only) */}
                    {props.connectionStatus.cliStatus && (
                      <>
                        {cliStatusItems.map(item => {
                          const color = item.available
                            ? theme.colors.success
                            : theme.colors.textDestructive;

                          return (
                            <View
                              key={item.key}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                            >
                              <Text
                                style={{
                                  fontSize: 11,
                                  color,
                                  ...Typography.default(),
                                }}
                              >
                                {item.available ? '✓' : '✗'}
                              </Text>
                              <Text
                                style={{
                                  fontSize: 11,
                                  color,
                                  ...Typography.default(),
                                }}
                              >
                                {item.key}
                              </Text>
                            </View>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
                {contextWarning && (
                  <Text
                    style={{
                      fontSize: 11,
                      color: contextWarning.color,
                      marginLeft: props.connectionStatus ? 8 : 0,
                      ...Typography.default(),
                    }}
                  >
                    {props.connectionStatus ? '• ' : ''}
                    {contextWarning.text}
                  </Text>
                )}
              </View>
              <View
                style={{
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  flexShrink: 1,
                  gap: 1,
                }}
              >
                {props.pendingCapabilityLabel ? (
                  <Text
                    style={{
                      fontSize: 11,
                      color: theme.colors.textSecondary,
                      ...Typography.default(),
                    }}
                  >
                    {props.pendingCapabilityLabel}
                  </Text>
                ) : null}
                {props.actualModeLabel ? (
                  <Text
                    style={{
                      fontSize: 11,
                      color: theme.colors.textSecondary,
                      ...Typography.default(),
                    }}
                  >
                    Mode: {props.actualModeLabel}
                  </Text>
                ) : null}
                {props.actualModelLabel ? (
                  <Text
                    style={{
                      fontSize: 11,
                      color: theme.colors.textSecondary,
                      ...Typography.default(),
                    }}
                  >
                    Model: {props.actualModelLabel}
                  </Text>
                ) : null}
              </View>
            </View>
          )}

          {/* Box 1: Context Information (Machine + Path) - Only show if either exists */}
          {(props.machineName !== undefined || props.currentPath) && (
            <View
              style={{
                backgroundColor: theme.colors.surfacePressed,
                borderRadius: 12,
                padding: 8,
                marginBottom: 8,
                gap: 4,
              }}
            >
              {/* Machine chip */}
              {props.machineName !== undefined && props.onMachineClick && (
                <Pressable
                  onPress={() => {
                    hapticsLight();
                    props.onMachineClick?.();
                  }}
                  hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                  style={p => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderRadius: Platform.select({ default: 16, android: 20 }),
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    height: 32,
                    opacity: p.pressed ? 0.7 : 1,
                    gap: 6,
                  })}
                >
                  <Ionicons name="desktop-outline" size={14} color={theme.colors.textSecondary} />
                  <Text
                    style={{
                      fontSize: 13,
                      color: theme.colors.text,
                      fontWeight: '600',
                      ...Typography.default('semiBold'),
                    }}
                  >
                    {props.machineName === null
                      ? t('agentInput.noMachinesAvailable')
                      : props.machineName}
                  </Text>
                </Pressable>
              )}

              {/* Path chip */}
              {props.currentPath && props.onPathClick && (
                <Pressable
                  onPress={() => {
                    hapticsLight();
                    props.onPathClick?.();
                  }}
                  hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                  style={p => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderRadius: Platform.select({ default: 16, android: 20 }),
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    height: 32,
                    opacity: p.pressed ? 0.7 : 1,
                    gap: 6,
                  })}
                >
                  <Ionicons name="folder-outline" size={14} color={theme.colors.textSecondary} />
                  <Text
                    style={{
                      fontSize: 13,
                      color: theme.colors.text,
                      fontWeight: '600',
                      ...Typography.default('semiBold'),
                    }}
                  >
                    {props.currentPath}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Box 2: Action Area (Input + Send) */}
          <View style={styles.unifiedPanel}>
            {/* Input field */}
            <View
              style={[
                styles.inputContainer,
                props.minHeight ? { minHeight: props.minHeight } : undefined,
              ]}
            >
              <MultiTextInput
                ref={inputRef}
                value={props.value}
                paddingTop={Platform.OS === 'web' ? 10 : 8}
                paddingBottom={Platform.OS === 'web' ? 10 : 8}
                onChangeText={props.onChangeText}
                placeholder={props.placeholder}
                onKeyPress={handleKeyPress}
                onStateChange={handleInputStateChange}
                maxHeight={120}
              />
            </View>

            {/* Attachment preview strip */}
            {props.pendingAttachments && props.pendingAttachments.length > 0 && (
              <View
                style={{
                  flexDirection: 'row',
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                {props.pendingAttachments.map((att, idx) => (
                  <View
                    key={`${att.localUri}-${idx}`}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 8,
                      overflow: 'hidden',
                      backgroundColor: theme.colors.input.background,
                    }}
                  >
                    <Image
                      source={{ uri: att.localUri }}
                      style={{ width: 56, height: 56 }}
                      contentFit="cover"
                    />
                    {att.uploading && (
                      <View
                        style={{
                          ...StyleSheet.absoluteFillObject,
                          backgroundColor: 'rgba(0,0,0,0.4)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <ActivityIndicator size="small" color="#fff" />
                      </View>
                    )}
                    {att.error && (
                      <View
                        style={{
                          ...StyleSheet.absoluteFillObject,
                          backgroundColor: 'rgba(255,59,48,0.5)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons name="alert-circle" size={20} color="#fff" />
                      </View>
                    )}
                    {!att.uploading && (
                      <Pressable
                        onPress={() => props.onRemoveAttachment?.(idx)}
                        style={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          width: 18,
                          height: 18,
                          borderRadius: 9,
                          backgroundColor: 'rgba(0,0,0,0.6)',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons name="close" size={12} color="#fff" />
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Action buttons below input */}
            <View style={styles.actionButtonsContainer}>
              <View style={{ flexDirection: 'column', flex: 1, gap: 2 }}>
                {/* Row 1: Settings, Profile (FIRST), Agent, Abort, Git Status */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <View style={styles.actionButtonsLeft}>
                    {/* Image picker button */}
                    {props.onPickImages && (
                      <Pressable
                        onPress={() => {
                          hapticsLight();
                          props.onPickImages?.();
                        }}
                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                        style={p => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          borderRadius: Platform.select({ default: 16, android: 20 }),
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          justifyContent: 'center',
                          height: 32,
                          opacity: p.pressed ? 0.7 : 1,
                        })}
                      >
                        <Ionicons
                          name="image-outline"
                          size={18}
                          color={theme.colors.button.secondary.tint}
                        />
                      </Pressable>
                    )}

                    {/* Settings button */}
                    {(showLocalPermissionModeControls || hasDiscoveredCapabilities) && (
                      <Pressable
                        onPress={handleSettingsPress}
                        disabled={props.isSettingsBusy}
                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                        style={p => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          borderRadius: Platform.select({ default: 16, android: 20 }),
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          justifyContent: 'center',
                          height: 32,
                          opacity: props.isSettingsBusy ? 0.4 : p.pressed ? 0.7 : 1,
                        })}
                      >
                        <Octicons
                          name={'gear'}
                          size={16}
                          color={theme.colors.button.secondary.tint}
                        />
                      </Pressable>
                    )}

                    {/* Agent selector button */}
                    {props.agentType && (props.onAgentChange || props.onAgentClick) && (
                      <Pressable
                        onPress={() => {
                          hapticsLight();
                          if (props.availableAgentTypes && props.onAgentChange) {
                            setShowAgentPicker(prev => !prev);
                            setShowSettings(false);
                          } else {
                            props.onAgentClick?.();
                          }
                        }}
                        hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                        style={p => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          borderRadius: Platform.select({ default: 16, android: 20 }),
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          justifyContent: 'center',
                          height: 32,
                          opacity: p.pressed ? 0.7 : 1,
                          gap: 6,
                        })}
                      >
                        <AgentFlavorIcon flavor={props.agentType} size={14} />
                        <Text
                          style={{
                            fontSize: 13,
                            color: theme.colors.button.secondary.tint,
                            fontWeight: '600',
                            ...Typography.default('semiBold'),
                          }}
                        >
                          {getAgentDisplayName(props.agentType)}
                        </Text>
                      </Pressable>
                    )}

                    {/* Abort button */}
                    {props.onAbort && (
                      <Shaker ref={shakerRef}>
                        <Pressable
                          style={p => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            borderRadius: Platform.select({ default: 16, android: 20 }),
                            paddingHorizontal: 8,
                            paddingVertical: 6,
                            justifyContent: 'center',
                            height: 32,
                            opacity: p.pressed ? 0.7 : 1,
                          })}
                          hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                          onPress={handleAbortPress}
                          disabled={isAborting}
                        >
                          {isAborting ? (
                            <ActivityIndicator
                              size="small"
                              color={theme.colors.button.secondary.tint}
                            />
                          ) : (
                            <Octicons
                              name={'stop'}
                              size={16}
                              color={theme.colors.button.secondary.tint}
                            />
                          )}
                        </Pressable>
                      </Shaker>
                    )}

                    {/* Git Status Badge */}
                    <GitStatusButton
                      sessionId={props.sessionId}
                      onPress={props.onFileViewerPress}
                    />
                  </View>

                  {/* Send/Voice button - aligned with first row */}
                  <View
                    style={[
                      styles.sendButton,
                      canSend || props.isSending || (props.onMicPress && !props.isMicActive)
                        ? styles.sendButtonActive
                        : styles.sendButtonInactive,
                    ]}
                  >
                    <Pressable
                      style={p => ({
                        width: '100%',
                        height: '100%',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: p.pressed ? 0.7 : 1,
                      })}
                      hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                      onPress={() => {
                        hapticsLight();
                        if (canSend) {
                          props.onSend();
                        } else {
                          props.onMicPress?.();
                        }
                      }}
                      disabled={
                        props.isSendDisabled || props.isSending || (!canSend && !props.onMicPress)
                      }
                    >
                      {props.isSending ? (
                        <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                      ) : canSend ? (
                        <Octicons
                          name="arrow-up"
                          size={16}
                          color={theme.colors.button.primary.tint}
                          style={[
                            styles.sendButtonIcon,
                            { marginTop: Platform.OS === 'web' ? 2 : 0 },
                          ]}
                        />
                      ) : props.onMicPress && !props.isMicActive ? (
                        <Image
                          source={require('@/assets/images/icon-voice-white.png')}
                          style={{
                            width: 24,
                            height: 24,
                          }}
                          tintColor={theme.colors.button.primary.tint}
                        />
                      ) : (
                        <Octicons
                          name="arrow-up"
                          size={16}
                          color={theme.colors.button.primary.tint}
                          style={[
                            styles.sendButtonIcon,
                            { marginTop: Platform.OS === 'web' ? 2 : 0 },
                          ]}
                        />
                      )}
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>
    );
  })
);

// Git Status Button Component
function GitStatusButton({ sessionId, onPress }: { sessionId?: string; onPress?: () => void }) {
  const hasMeaningfulGitStatus = useHasMeaningfulGitStatus(sessionId || '');
  const styles = stylesheet;
  const { theme } = useUnistyles();

  if (!sessionId || !onPress) {
    return null;
  }

  return (
    <Pressable
      style={p => ({
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: Platform.select({ default: 16, android: 20 }),
        paddingHorizontal: 8,
        paddingVertical: 6,
        height: 32,
        opacity: p.pressed ? 0.7 : 1,
        flex: 1,
        overflow: 'hidden',
      })}
      hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
      onPress={() => {
        hapticsLight();
        onPress?.();
      }}
    >
      {hasMeaningfulGitStatus ? (
        <GitStatusBadge sessionId={sessionId} />
      ) : (
        <Octicons name="git-branch" size={16} color={theme.colors.button.secondary.tint} />
      )}
    </Pressable>
  );
}
