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
  Animated,
} from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { AgentInputAutocomplete } from './AgentInputAutocomplete';
import { applySuggestion } from './autocomplete/applySuggestion';
import { useActiveSuggestions } from './autocomplete/useActiveSuggestions';
import { useActiveWord } from './autocomplete/useActiveWord';
import { AgentFlavorIcon } from './AgentFlavorIcon';
import { ImagePreviewModal } from './ImagePreviewModal';
import { FloatingOverlay } from './FloatingOverlay';
import { GitStatusBadge, useHasMeaningfulGitStatus } from './GitStatusBadge';
import { hapticsLight, hapticsError } from './haptics';
import { VoiceBars } from './VoiceBars';
import { layout } from './layout';
import { MultiTextInput, KeyPressEvent } from './MultiTextInput';
import { TextInputSelection, MultiTextInputHandle } from './MultiTextInput';
import type { ModelMode } from './PermissionModeSelector';
import { Typography } from '@/constants/Typography';
import { Shaker, ShakeInstance } from './Shaker';
import { StatusDot } from './StatusDot';
import {
  getAgentDescription,
  getAgentDisplayName,
  isHiddenAgentOption,
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
import { Modal } from '@/modal/ModalManager';
import { t } from '@/text';
import { Theme } from '@/theme';
import type { Machine } from '@/sync/storageTypes';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/components/AgentInput');

interface AgentInputProps {
  value: string;
  placeholder: string;
  onChangeText: (text: string) => void;
  sessionId?: string;
  onSend: () => void;
  sendIcon?: React.ReactNode;
  onSpeechInputPress?: () => void;
  onSpeechInputCancel?: () => void;
  isSpeechInputActive?: boolean;
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
    contextWindowSize?: number;
  };
  alwaysShowContextSize?: boolean;
  onFileViewerPress?: () => void;
  agentType?: AppAgentFlavor;
  availableAgentTypes?: AppAgentFlavor[];
  onAgentChange?: (agent: AppAgentFlavor) => void;
  onAgentClick?: () => void;
  machineName?: string | null;
  machineOptions?: Machine[];
  selectedMachineId?: string | null;
  onMachineSelect?: (machineId: string) => void;
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

/** Max wait for `sessionAbort` RPC before showing timeout (stuck network / daemon). */
const ABORT_RPC_TIMEOUT_MS = 25_000;

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
    borderRadius: Platform.select({ default: 20, android: 20 }),
    overflow: 'hidden',
    paddingTop: Platform.OS === 'web' ? 8 : 2,
    paddingBottom: Platform.OS === 'web' ? 10 : 8,
    paddingHorizontal: Platform.OS === 'web' ? 10 : 8,
    borderWidth: Platform.OS === 'web' ? 1 : 0,
    borderColor: Platform.OS === 'web' ? 'rgba(18, 28, 45, 0.08)' : 'transparent',
    shadowColor: Platform.OS === 'web' ? '#0f172a' : 'transparent',
    shadowOpacity: Platform.OS === 'web' ? 0.08 : 0,
    shadowRadius: Platform.OS === 'web' ? 18 : 0,
    shadowOffset: Platform.OS === 'web' ? { width: 0, height: 10 } : { width: 0, height: 0 },
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
  contextLiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contextLiveText: {
    fontSize: 11,
    ...Typography.default(),
  },
  contextPill: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  contextPillText: {
    fontSize: 10,
    ...Typography.default('semiBold'),
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
    alignItems: 'center',
    gap: Platform.OS === 'web' ? 8 : 6,
    flex: 1,
    flexWrap: 'wrap',
  },
  actionButtonsTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  toolbarGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Platform.OS === 'web' ? 14 : 0,
    paddingHorizontal: Platform.OS === 'web' ? 4 : 0,
    paddingVertical: Platform.OS === 'web' ? 4 : 0,
    backgroundColor:
      Platform.OS === 'web'
        ? theme.dark
          ? 'rgba(255,255,255,0.04)'
          : 'rgba(15,23,42,0.04)'
        : 'transparent',
    borderWidth: Platform.OS === 'web' ? 1 : 0,
    borderColor:
      Platform.OS === 'web'
        ? theme.dark
          ? 'rgba(255,255,255,0.05)'
          : 'rgba(18, 28, 45, 0.06)'
        : 'transparent',
  },
  agentChipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Platform.select({ default: 16, android: 20 }),
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
    height: 32,
    gap: 6,
    backgroundColor:
      Platform.OS === 'web'
        ? theme.dark
          ? 'rgba(255,255,255,0.04)'
          : 'rgba(255,255,255,0.88)'
        : 'transparent',
  },
  agentChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    ...Typography.default('semiBold'),
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
    width: Platform.OS === 'web' ? 36 : 32,
    height: Platform.OS === 'web' ? 36 : 32,
    borderRadius: Platform.OS === 'web' ? 18 : 16,
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

const getContextWarning = (
  contextSize: number,
  contextWindowSize: number = MAX_CONTEXT_SIZE,
  alwaysShow: boolean = false,
  theme: Theme
) => {
  const percentageUsed = (contextSize / contextWindowSize) * 100;
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

const formatTokenCompact = (value: number) => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  }
  return `${Math.round(value)}`;
};

export const AgentInput = React.memo(
  React.forwardRef<MultiTextInputHandle, AgentInputProps>((props, ref) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const screenWidth = useWindowDimensions().width;
    const isWideLayout = screenWidth > 700;

    const hasText = props.value.trim().length > 0;
    const hasReadyAttachments = (props.pendingAttachments ?? []).some(
      a => !a.uploading && !a.error
    );
    const canSend = hasText || hasReadyAttachments;
    const [previewUri, setPreviewUri] = React.useState<string | null>(null);

    // Recording mode animation
    const recordingAnim = React.useRef(new Animated.Value(0)).current;
    React.useEffect(() => {
      Animated.timing(recordingAnim, {
        toValue: props.isSpeechInputActive ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }, [props.isSpeechInputActive, recordingAnim]);

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
      ? getContextWarning(
          props.usageData.contextSize,
          props.usageData.contextWindowSize ?? MAX_CONTEXT_SIZE,
          props.alwaysShowContextSize ?? false,
          theme
        )
      : null;
    const contextUsageDisplay = React.useMemo(() => {
      if (!props.usageData?.contextSize) {
        return null;
      }

      const contextWindowSize = props.usageData.contextWindowSize ?? MAX_CONTEXT_SIZE;
      const used = props.usageData.contextSize;
      const percent = Math.max(0, Math.min(100, Math.round((used / contextWindowSize) * 100)));

      if (percent >= 95) {
        return {
          label: `${formatTokenCompact(used)} / ${formatTokenCompact(contextWindowSize)}`,
          percent,
          textColor: theme.colors.warningCritical,
          pillBackground: `${theme.colors.warningCritical}20`,
          pillTextColor: theme.colors.warningCritical,
        };
      }

      if (percent >= 90) {
        return {
          label: `${formatTokenCompact(used)} / ${formatTokenCompact(contextWindowSize)}`,
          percent,
          textColor: theme.colors.warning,
          pillBackground: `${theme.colors.warning}18`,
          pillTextColor: theme.colors.warning,
        };
      }

      return {
        label: `${formatTokenCompact(used)} / ${formatTokenCompact(contextWindowSize)}`,
        percent,
        textColor: theme.colors.textSecondary,
        pillBackground: theme.colors.surface,
        pillTextColor: theme.colors.textSecondary,
      };
    }, [
      props.usageData,
      theme.colors.surface,
      theme.colors.textSecondary,
      theme.colors.warning,
      theme.colors.warningCritical,
    ]);
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
    /**
     * True while the outbound message RPC is in flight or abort RPC is running — disables text, attachments,
     * and toolbar controls. Abort stays tappable while sending (see toolbar layout); only `isAborting` disables it.
     */
    const composerChromeLocked = Boolean(props.isSending) || isAborting;
    const shakerRef = React.useRef<ShakeInstance>(null);
    const inputRef = React.useRef<MultiTextInputHandle>(null);

    // Forward ref to the MultiTextInput
    React.useImperativeHandle(ref, () => inputRef.current!, []);

    const [selection, setSelection] = React.useState<TextInputSelection>({ start: 0, end: 0 });
    const [isComposing, setIsComposing] = React.useState(false);

    const handleSelectionChange = React.useCallback((nextSelection: TextInputSelection) => {
      setSelection(prev => {
        if (prev.start === nextSelection.start && prev.end === nextSelection.end) {
          return prev;
        }
        return nextSelection;
      });
    }, []);

    const handleCompositionStateChange = React.useCallback((nextIsComposing: boolean) => {
      setIsComposing(prev => (prev === nextIsComposing ? prev : nextIsComposing));
    }, []);

    /**
     * Clamp stale selections after programmatic value changes such as send/clear.
     * This avoids keeping an out-of-bounds cursor after the controlled value shrinks.
     */
    React.useEffect(() => {
      setSelection(prev => {
        const len = props.value.length;
        if (prev.start <= len && prev.end <= len) {
          return prev;
        }
        return { start: len, end: len };
      });
    }, [props.value]);

    const activeWord = useActiveWord(
      isComposing ? '' : props.value,
      selection,
      props.autocompletePrefixes
    );
    // Using default options: clampSelection=true, autoSelectFirst=true, wrapAround=true
    // To customize: useActiveSuggestions(activeWord, props.autocompleteSuggestions, { clampSelection: false, wrapAround: false })
    const [suggestions, selected, moveUp, moveDown] = useActiveSuggestions(
      activeWord,
      props.autocompleteSuggestions,
      {
        clampSelection: true,
        wrapAround: true,
        debounceMs: Platform.OS === 'web' ? 280 : 450,
        suspend: isComposing,
      }
    );
    const renderedSuggestions = React.useMemo(
      () =>
        suggestions.map(suggestion => {
          const Component = suggestion.component;
          return <Component key={suggestion.key} />;
        }),
      [suggestions]
    );

    // Handle suggestion selection
    const handleSuggestionSelect = React.useCallback(
      (index: number) => {
        if (!suggestions[index] || !inputRef.current) return;

        const suggestion = suggestions[index];

        // Apply the suggestion
        const result = applySuggestion(
          props.value,
          selection,
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
      [props.autocompletePrefixes, props.value, selection, suggestions]
    );

    /**
     * Dismisses the autocomplete sheet when the user taps outside (same idea as settings overlays).
     * Inserts a space at the cursor so the `/` or `@` token is no longer "active" per `findActiveWord`.
     */
    const handleDismissAutocompleteBackdrop = React.useCallback(() => {
      if (composerChromeLocked || suggestions.length === 0 || !inputRef.current) {
        return;
      }
      const pos = selection.start;
      const newText = props.value.slice(0, pos) + ' ' + props.value.slice(pos);
      inputRef.current.setTextAndSelection(newText, { start: pos + 1, end: pos + 1 });
      hapticsLight();
    }, [composerChromeLocked, props.value, selection, suggestions.length]);

    // Settings modal state
    const [showSettings, setShowSettings] = React.useState(false);

    // Agent picker overlay state
    const [showAgentPicker, setShowAgentPicker] = React.useState(false);
    const [showMachinePicker, setShowMachinePicker] = React.useState(false);

    // Close settings overlays and dismiss keyboard while the composer chrome is locked (send in flight or abort).
    React.useEffect(() => {
      if (composerChromeLocked) {
        setShowSettings(false);
        setShowAgentPicker(false);
        setShowMachinePicker(false);
        inputRef.current?.blur();
      }
    }, [composerChromeLocked]);

    // Handle settings button press
    const handleSettingsPress = React.useCallback(() => {
      if (props.isSettingsBusy || composerChromeLocked) {
        return;
      }
      inputRef.current?.blur();
      hapticsLight();
      setShowSettings(prev => !prev);
    }, [props.isSettingsBusy, composerChromeLocked]);

    // Handle settings selection
    const handleSettingsSelect = React.useCallback(
      (mode: PermissionMode) => {
        hapticsLight();
        props.onPermissionModeChange?.(mode);
        // Don't close the settings overlay - let users see the change and potentially switch again
      },
      [props.onPermissionModeChange]
    );

    /**
     * Runs the abort RPC after confirmation: haptics, loading state, min visible duration, and a hard timeout.
     */
    const performAbort = React.useCallback(async () => {
      if (!props.onAbort) return;

      inputRef.current?.blur();
      hapticsError();
      setIsAborting(true);
      const startTime = Date.now();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      try {
        await Promise.race([
          props.onAbort(),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error('abort_rpc_timeout')),
              ABORT_RPC_TIMEOUT_MS
            );
          }),
        ]);

        const elapsed = Date.now() - startTime;
        if (elapsed < 300) {
          await new Promise(resolve => setTimeout(resolve, 300 - elapsed));
        }
      } catch (error) {
        shakerRef.current?.shake();
        const err = toError(error);
        if (err.message === 'abort_rpc_timeout') {
          logger.error('Abort RPC timed out', err);
          void Modal.alert(t('common.error'), t('agentInput.abortTimedOut'));
        } else {
          logger.error('Abort RPC call failed:', err);
        }
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        setIsAborting(false);
      }
    }, [props.onAbort]);

    /**
     * Asks for confirmation before stopping the current agent response (button and Escape).
     */
    const handleAbortPress = React.useCallback(() => {
      if (!props.onAbort || isAborting) return;

      void Modal.confirm(t('agentInput.abortConfirmTitle'), t('agentInput.abortConfirmMessage'), {
        cancelText: t('common.cancel'),
        confirmText: t('agentInput.abortConfirmAction'),
        destructive: true,
      }).then(confirmed => {
        if (confirmed) void performAbort();
      });
    }, [props.onAbort, isAborting, performAbort]);

    // Handle keyboard navigation
    const handleKeyPress = React.useCallback(
      (event: KeyPressEvent): boolean => {
        if (isAborting) {
          return false;
        }
        // While sending, only Escape may trigger abort (typing and other keys are blocked via editable={false}).
        if (props.isSending) {
          if (
            event.key === 'Escape' &&
            props.showAbortButton &&
            props.onAbort &&
            suggestions.length === 0
          ) {
            handleAbortPress();
            return true;
          }
          return false;
        }
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
              const cursorPos = selection.start;
              inputRef.current.setTextAndSelection(props.value, {
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
        props.value,
        selection,
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
        props.isSending,
      ]
    );

    return (
      <View style={[styles.container, { paddingHorizontal: isWideLayout ? 16 : 8 }]}>
        <View style={[styles.innerContainer, { maxWidth: layout.maxWidth }]}>
          {/* Autocomplete suggestions overlay + tap-outside to dismiss */}
          {suggestions.length > 0 && (
            <>
              <TouchableWithoutFeedback onPress={handleDismissAutocompleteBackdrop}>
                <View
                  pointerEvents={composerChromeLocked ? 'none' : 'auto'}
                  style={styles.overlayBackdrop}
                />
              </TouchableWithoutFeedback>
              <View
                pointerEvents={composerChromeLocked ? 'none' : 'auto'}
                style={[styles.autocompleteOverlay, { paddingHorizontal: isWideLayout ? 0 : 8 }]}
              >
                <AgentInputAutocomplete
                  suggestions={renderedSuggestions}
                  selectedIndex={selected}
                  onSelect={handleSuggestionSelect}
                  itemHeight={48}
                />
              </View>
            </>
          )}

          {/* Settings overlay */}
          {showSettings && (
            <>
              <TouchableWithoutFeedback onPress={() => setShowSettings(false)}>
                <View style={styles.overlayBackdrop} />
              </TouchableWithoutFeedback>
              <View style={[styles.settingsOverlay, { paddingHorizontal: isWideLayout ? 0 : 8 }]}>
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
              <View style={[styles.settingsOverlay, { paddingHorizontal: isWideLayout ? 0 : 8 }]}>
                <FloatingOverlay maxHeight={400} keyboardShouldPersistTaps="always">
                  <View style={styles.overlaySection}>
                    <Text style={styles.overlaySectionTitle}>{t('agentInput.agentTitle')}</Text>
                    {(() => {
                      const stableAgents = props.availableAgentTypes!.filter(
                        a => !isHiddenAgentOption(a) && !isExperimentalAgent(a)
                      );
                      const experimentalAgents = props.availableAgentTypes!.filter(
                        a => !isHiddenAgentOption(a) && isExperimentalAgent(a)
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

          {showMachinePicker && props.machineOptions && props.onMachineSelect && (
            <>
              <TouchableWithoutFeedback onPress={() => setShowMachinePicker(false)}>
                <View style={styles.overlayBackdrop} />
              </TouchableWithoutFeedback>
              <View style={[styles.settingsOverlay, { paddingHorizontal: isWideLayout ? 0 : 8 }]}>
                <FloatingOverlay maxHeight={400} keyboardShouldPersistTaps="always">
                  <View style={styles.overlaySection}>
                    <Text style={styles.overlaySectionTitle}>{t('machinePicker.headerTitle')}</Text>
                    {props.machineOptions.length > 0 ? (
                      props.machineOptions.map(machine => {
                        const machineLabel =
                          machine.metadata?.displayName || machine.metadata?.host || machine.id;
                        const secondaryLabel =
                          machine.metadata?.displayName && machine.metadata?.host
                            ? machine.metadata.host
                            : null;
                        const isSelected = machine.id === props.selectedMachineId;

                        return (
                          <Pressable
                            key={machine.id}
                            onPress={() => {
                              hapticsLight();
                              props.onMachineSelect?.(machine.id);
                              setShowMachinePicker(false);
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
                                {machineLabel}
                              </Text>
                              {secondaryLabel ? (
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: theme.colors.textSecondary,
                                    ...Typography.default(),
                                  }}
                                >
                                  {secondaryLabel}
                                </Text>
                              ) : null}
                            </View>
                          </Pressable>
                        );
                      })
                    ) : (
                      <Text
                        style={{
                          fontSize: 13,
                          color: theme.colors.textSecondary,
                          paddingHorizontal: 16,
                          paddingVertical: 8,
                          ...Typography.default(),
                        }}
                      >
                        {t('machinePicker.noMachinesAvailable')}
                      </Text>
                    )}
                  </View>
                </FloatingOverlay>
              </View>
            </>
          )}

          {/* Connection status, context warning, and permission mode */}
          {(props.connectionStatus ||
            contextWarning ||
            contextUsageDisplay ||
            hasCapabilityStatus ||
            props.pendingCapabilityLabel) && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                paddingHorizontal: Platform.OS === 'web' ? 14 : 16,
                paddingTop: Platform.OS === 'web' ? 2 : 0,
                paddingBottom: Platform.OS === 'web' ? 10 : 4,
                minHeight: 20,
                gap: Platform.OS === 'web' ? 12 : 0,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  flex: 1,
                  flexWrap: 'wrap',
                  gap: Platform.OS === 'web' ? 8 : 11,
                  rowGap: Platform.OS === 'web' ? 6 : 2,
                }}
              >
                {props.connectionStatus && (
                  <>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5,
                        paddingHorizontal: Platform.OS === 'web' ? 8 : 0,
                        paddingVertical: Platform.OS === 'web' ? 4 : 0,
                        borderRadius: Platform.OS === 'web' ? 999 : 0,
                        backgroundColor:
                          Platform.OS === 'web'
                            ? theme.dark
                              ? 'rgba(255,255,255,0.05)'
                              : 'rgba(15,23,42,0.05)'
                            : 'transparent',
                      }}
                    >
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
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 4,
                                paddingHorizontal: Platform.OS === 'web' ? 8 : 0,
                                paddingVertical: Platform.OS === 'web' ? 4 : 0,
                                borderRadius: Platform.OS === 'web' ? 999 : 0,
                                backgroundColor:
                                  Platform.OS === 'web'
                                    ? theme.dark
                                      ? 'rgba(255,255,255,0.04)'
                                      : 'rgba(15,23,42,0.04)'
                                    : 'transparent',
                              }}
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
                {contextWarning && !contextUsageDisplay && (
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
                  gap: Platform.OS === 'web' ? 4 : 1,
                }}
              >
                {contextUsageDisplay ? (
                  <View style={styles.contextLiveRow}>
                    <Text
                      style={[
                        styles.contextLiveText,
                        {
                          color: contextUsageDisplay.textColor,
                        },
                      ]}
                    >
                      {contextUsageDisplay.label}
                    </Text>
                    <View
                      style={[
                        styles.contextPill,
                        {
                          backgroundColor: contextUsageDisplay.pillBackground,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.contextPillText,
                          {
                            color: contextUsageDisplay.pillTextColor,
                          },
                        ]}
                      >
                        {contextUsageDisplay.percent}%
                      </Text>
                    </View>
                  </View>
                ) : null}
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
                {(props.actualModeLabel || props.actualModelLabel) && (
                  <View
                    style={{
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: Platform.OS === 'web' ? 2 : 6,
                    }}
                  >
                    {props.actualModeLabel ? (
                      <View>
                        <Text
                          style={{
                            fontSize: 11,
                            color: theme.colors.textSecondary,
                            ...Typography.default(),
                          }}
                        >
                          Mode: {props.actualModeLabel}
                        </Text>
                      </View>
                    ) : null}
                    {props.actualModelLabel ? (
                      <View>
                        <Text
                          style={{
                            fontSize: 11,
                            color: theme.colors.textSecondary,
                            ...Typography.default(),
                          }}
                        >
                          Model: {props.actualModelLabel}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Box 1: Context Information (Machine + Path) - Only show if either exists */}
          {(props.machineName !== undefined || props.currentPath) && (
            <View
              pointerEvents={composerChromeLocked ? 'none' : 'auto'}
              style={{
                backgroundColor: theme.colors.surfacePressed,
                borderRadius: 12,
                padding: 8,
                marginBottom: 8,
                gap: 4,
              }}
            >
              {/* Machine chip */}
              {props.machineName !== undefined &&
                (props.onMachineSelect || props.onMachineClick) && (
                  <Pressable
                    onPress={() => {
                      hapticsLight();
                      if (props.onMachineSelect) {
                        inputRef.current?.blur();
                        setShowSettings(false);
                        setShowAgentPicker(false);
                        setShowMachinePicker(prev => !prev);
                        return;
                      }
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
                    {props.onMachineSelect ? (
                      <Ionicons
                        name={showMachinePicker ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={theme.colors.textSecondary}
                      />
                    ) : null}
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
                editable={!composerChromeLocked}
                onKeyPress={handleKeyPress}
                onSelectionChange={handleSelectionChange}
                onCompositionStateChange={handleCompositionStateChange}
                maxHeight={120}
              />
            </View>

            {/* Attachment preview strip */}
            {props.pendingAttachments && props.pendingAttachments.length > 0 && (
              <View
                pointerEvents={composerChromeLocked ? 'none' : 'auto'}
                style={{
                  flexDirection: 'row',
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                {props.pendingAttachments.map((att, idx) => (
                  <Pressable
                    key={`${att.localUri}-${idx}`}
                    onPress={() => !att.uploading && setPreviewUri(att.localUri)}
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
                  </Pressable>
                ))}
              </View>
            )}
            {previewUri && (
              <ImagePreviewModal uri={previewUri} onClose={() => setPreviewUri(null)} />
            )}

            {/* Action buttons below input */}
            <View
              style={[
                styles.actionButtonsContainer,
                {
                  position: 'relative',
                  minHeight: Platform.OS === 'web' ? 44 : 40,
                  marginTop: 2,
                  paddingTop: Platform.OS === 'web' ? 8 : 4,
                  paddingHorizontal: Platform.OS === 'web' ? 4 : 0,
                  paddingBottom: Platform.OS === 'web' ? 2 : 0,
                  borderTopWidth: 1,
                  borderTopColor:
                    Platform.OS === 'web'
                      ? theme.dark
                        ? 'rgba(255,255,255,0.06)'
                        : 'rgba(18, 28, 45, 0.08)'
                      : 'transparent',
                },
              ]}
            >
              {/* Recording bar - fades in when isSpeechInputActive */}
              <Animated.View
                pointerEvents={props.isSpeechInputActive ? 'auto' : 'none'}
                style={{
                  opacity: recordingAnim,
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: 0,
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 4,
                  gap: 4,
                }}
              >
                <VoiceBars isActive color={theme.colors.button.primary.background} size="medium" />
                <Text
                  style={{
                    flex: 1,
                    marginLeft: 4,
                    fontSize: 13,
                    color: theme.colors.textSecondary,
                    ...Typography.default(),
                  }}
                  numberOfLines={1}
                >
                  {t('agentInput.speechInput.recording')}
                </Text>
                {/* Cancel - restores original text */}
                <Pressable
                  onPress={() => {
                    hapticsLight();
                    props.onSpeechInputCancel?.();
                  }}
                  hitSlop={10}
                  style={p => ({ opacity: p.pressed ? 0.6 : 1, padding: 4 })}
                >
                  <Ionicons name="close-circle" size={26} color={theme.colors.textSecondary} />
                </Pressable>
                {/* Done - keeps transcript */}
                <Pressable
                  onPress={() => {
                    hapticsLight();
                    props.onSpeechInputPress?.();
                  }}
                  hitSlop={10}
                  style={p => ({ opacity: p.pressed ? 0.6 : 1, padding: 4 })}
                >
                  <Ionicons
                    name="checkmark-circle"
                    size={26}
                    color={theme.colors.button.primary.background}
                  />
                </Pressable>
              </Animated.View>

              {/* Normal buttons - fades out when recording */}
              <Animated.View
                pointerEvents={props.isSpeechInputActive ? 'none' : 'auto'}
                style={{
                  opacity: recordingAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                  flexDirection: 'row',
                  flex: 1,
                  alignItems: 'center',
                }}
              >
                <View style={[styles.actionButtonsContainer, { flex: 1 }]}>
                  <View
                    pointerEvents={composerChromeLocked ? 'none' : 'auto'}
                    style={styles.actionButtonsLeft}
                  >
                    {(props.agentType && (props.onAgentChange || props.onAgentClick)) ||
                    showLocalPermissionModeControls ||
                    hasDiscoveredCapabilities ? (
                      <View style={styles.toolbarGroup}>
                        {props.agentType && (props.onAgentChange || props.onAgentClick) && (
                          <Pressable
                            onPress={() => {
                              inputRef.current?.blur();
                              hapticsLight();
                              if (props.availableAgentTypes && props.onAgentChange) {
                                setShowAgentPicker(prev => !prev);
                                setShowSettings(false);
                              } else {
                                props.onAgentClick?.();
                              }
                            }}
                            hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                            style={p => [styles.agentChipButton, { opacity: p.pressed ? 0.7 : 1 }]}
                          >
                            <AgentFlavorIcon flavor={props.agentType} size={14} />
                            <Text
                              style={[
                                styles.agentChipLabel,
                                { color: theme.colors.button.secondary.tint },
                              ]}
                            >
                              {getAgentDisplayName(props.agentType)}
                            </Text>
                          </Pressable>
                        )}

                        {(showLocalPermissionModeControls || hasDiscoveredCapabilities) && (
                          <Pressable
                            onPress={handleSettingsPress}
                            disabled={props.isSettingsBusy || composerChromeLocked}
                            hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                            style={p => ({
                              flexDirection: 'row',
                              alignItems: 'center',
                              borderRadius: Platform.select({ default: 16, android: 20 }),
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              justifyContent: 'center',
                              height: 32,
                              opacity: props.isSettingsBusy ? 0.4 : p.pressed ? 0.7 : 1,
                              flexShrink: 0,
                              backgroundColor:
                                Platform.OS === 'web'
                                  ? theme.dark
                                    ? 'rgba(255,255,255,0.04)'
                                    : 'rgba(255,255,255,0.88)'
                                  : 'transparent',
                            })}
                          >
                            <Octicons
                              name={'gear'}
                              size={16}
                              color={theme.colors.button.secondary.tint}
                            />
                          </Pressable>
                        )}
                      </View>
                    ) : null}

                    {props.onPickImages || (props.sessionId && props.onFileViewerPress) ? (
                      <View style={styles.toolbarGroup}>
                        {props.onPickImages && (
                          <Pressable
                            onPress={() => {
                              inputRef.current?.blur();
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
                              backgroundColor:
                                Platform.OS === 'web'
                                  ? theme.dark
                                    ? 'rgba(255,255,255,0.04)'
                                    : 'rgba(255,255,255,0.88)'
                                  : 'transparent',
                            })}
                          >
                            <Ionicons
                              name="image-outline"
                              size={18}
                              color={theme.colors.button.secondary.tint}
                            />
                          </Pressable>
                        )}

                        <View
                          pointerEvents={composerChromeLocked ? 'none' : 'auto'}
                          style={{ flexShrink: 0 }}
                        >
                          <GitStatusButton
                            sessionId={props.sessionId}
                            onPress={() => {
                              inputRef.current?.blur();
                              props.onFileViewerPress?.();
                            }}
                          />
                        </View>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.actionButtonsTrailing}>
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
                            backgroundColor:
                              Platform.OS === 'web'
                                ? theme.dark
                                  ? 'rgba(255,255,255,0.04)'
                                  : 'rgba(255,255,255,0.88)'
                                : 'transparent',
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
                  </View>

                  <View
                    style={[
                      styles.sendButton,
                      canSend || props.isSending || props.onSpeechInputPress
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
                          props.onSpeechInputPress?.();
                        }
                      }}
                      disabled={
                        props.isSendDisabled ||
                        composerChromeLocked ||
                        (!canSend && !props.onSpeechInputPress)
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
                      ) : props.onSpeechInputPress ? (
                        <Ionicons
                          name={props.isSpeechInputActive ? 'stop' : 'mic'}
                          size={16}
                          color={theme.colors.button.primary.tint}
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
              </Animated.View>
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
  const { theme } = useUnistyles();

  if (!sessionId || !onPress) {
    return null;
  }

  return (
    <Pressable
      style={p => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Platform.select({ default: 16, android: 20 }),
        paddingHorizontal: 8,
        paddingVertical: 6,
        height: 32,
        opacity: p.pressed ? 0.7 : 1,
        flexShrink: 0,
        minWidth: 32,
        backgroundColor:
          Platform.OS === 'web'
            ? theme.dark
              ? 'rgba(255,255,255,0.04)'
              : 'rgba(255,255,255,0.88)'
            : 'transparent',
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
