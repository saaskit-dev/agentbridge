import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { useMemo } from 'react';
import { ActionSheetIOS, ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { AgentContentView } from '@/components/AgentContentView';
import { AgentInput } from '@/components/AgentInput';
import { getSuggestions } from '@/components/autocomplete/suggestions';
import { ChatHeaderView } from '@/components/ChatHeaderView';
import { ChatList } from '@/components/ChatList';
import { EmptyMessages } from '@/components/EmptyMessages';
import { VoiceAssistantStatusBar } from '@/components/VoiceAssistantStatusBar';
import { useDraft } from '@/hooks/useDraft';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import { Modal } from '@/modal';
import { voiceHooks } from '@/realtime/hooks/voiceHooks';
import { startRealtimeSession, stopRealtimeSession } from '@/realtime/RealtimeSession';
import { gitStatusSync } from '@/sync/gitStatusSync';
import {
  sessionAbort,
  sessionSetConfig,
  sessionSetMode,
  sessionSetModel,
} from '@/sync/ops';
import {
  storage,
  useIsDataReady,
  useLocalSetting,
  useRealtimeStatus,
  useSessionMessages,
  useSessionSendError,
  useSessionUsage,
  useSetting,
} from '@/sync/storage';
import { useSession } from '@/sync/storage';
import {
  getConfigOptionByCategory,
  getCurrentDiscoveredModeId,
  getDefaultDiscoveredModelId,
  getDisplayCapabilities,
} from '@/sync/sessionCapabilities';
import { Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { isRunningOnMac } from '@/utils/platform';
import { useDeviceType, useHeaderHeight, useIsLandscape, useIsTablet } from '@/utils/responsive';
import {
  formatPathRelativeToHome,
  getSessionAvatarId,
  getSessionName,
  useSessionStatus,
} from '@/utils/sessionUtils';
import { isVersionSupported, MINIMUM_CLI_VERSION } from '@/utils/versionUtils';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
import * as ImagePicker from 'expo-image-picker';
import {
  uploadAttachment,
  uploadClipboardImage,
  getClipboardImage,
  hasClipboardImage,
  type AttachmentRef,
} from '@/sync/attachmentUpload';
import { subscribePasteImage, type PastedImage } from '@/utils/pasteImageBridge';
const logger = new Logger('app/session/SessionView');

export const SessionView = React.memo((props: { id: string }) => {
  const sessionId = props.id;
  const router = useRouter();
  const session = useSession(sessionId);
  const isDataReady = useIsDataReady();
  const { theme } = useUnistyles();
  const safeArea = useSafeAreaInsets();
  const isLandscape = useIsLandscape();
  const deviceType = useDeviceType();
  const headerHeight = useHeaderHeight();
  const realtimeStatus = useRealtimeStatus();
  const isTablet = useIsTablet();
  const devModeEnabledForHeader = useLocalSetting('devModeEnabled') || __DEV__;
  const showDebugIds = useLocalSetting('showDebugIds');

  // Compute header props based on session state
  const headerProps = useMemo(() => {
    if (!isDataReady) {
      // Loading state - show empty header
      return {
        title: '',
        subtitle: undefined,
        avatarId: undefined,
        onAvatarPress: undefined,
        isConnected: false,
        flavor: null,
      };
    }

    if (!session) {
      // Deleted state - show deleted message in header
      return {
        title: t('errors.sessionDeleted'),
        subtitle: undefined,
        avatarId: undefined,
        onAvatarPress: undefined,
        isConnected: false,
        flavor: null,
      };
    }

    // Normal state - show session info
    const isConnected = session.presence === 'online';
    return {
      title: getSessionName(session),
      subtitle: session.metadata?.path
        ? formatPathRelativeToHome(session.metadata.path, session.metadata?.homeDir)
        : undefined,
      avatarId: getSessionAvatarId(session),
      onAvatarPress: () => router.push(`/session/${sessionId}/info`),
      isConnected: isConnected,
      flavor: session.metadata?.flavor || null,
      tintColor: isConnected ? '#000' : '#8E8E93',
    };
  }, [session, isDataReady, sessionId, router]);

  return (
    <>
      {/* Status bar shadow for landscape mode */}
      {isLandscape && deviceType === 'phone' && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: safeArea.top,
            backgroundColor: theme.colors.surface,
            zIndex: 1000,
            shadowColor: theme.colors.shadow.color,
            shadowOffset: {
              width: 0,
              height: 2,
            },
            shadowOpacity: theme.colors.shadow.opacity,
            shadowRadius: 3,
            elevation: 5,
          }}
        />
      )}

      {/* Header - always shown on desktop/Mac, hidden in landscape mode only on actual phones */}
      {!(isLandscape && deviceType === 'phone' && Platform.OS !== 'web') && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
          }}
        >
          <ChatHeaderView
            {...headerProps}
            onBackPress={() => router.back()}
            devSessionId={devModeEnabledForHeader && showDebugIds ? sessionId : null}
          />
          {/* Voice status bar below header - not on tablet (shown in sidebar) */}
          {!isTablet && realtimeStatus !== 'disconnected' && (
            <VoiceAssistantStatusBar variant="full" />
          )}
        </View>
      )}

      {/* Content based on state */}
      <View
        style={{
          flex: 1,
          paddingTop: !(isLandscape && deviceType === 'phone' && Platform.OS !== 'web')
            ? safeArea.top +
              headerHeight +
              (!isTablet && realtimeStatus !== 'disconnected' ? 48 : 0)
            : 0,
        }}
      >
        {!isDataReady ? (
          // Loading state
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
          </View>
        ) : !session ? (
          // Deleted state
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="trash-outline" size={48} color={theme.colors.textSecondary} />
            <Text
              style={{ color: theme.colors.text, fontSize: 20, marginTop: 16, fontWeight: '600' }}
            >
              {t('errors.sessionDeleted')}
            </Text>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: 15,
                marginTop: 8,
                textAlign: 'center',
                paddingHorizontal: 32,
              }}
            >
              {t('errors.sessionDeletedDescription')}
            </Text>
          </View>
        ) : (
          // Normal session view
          <SessionViewLoaded key={sessionId} sessionId={sessionId} session={session} />
        )}
      </View>
    </>
  );
});

function SessionViewLoaded({ sessionId, session }: { sessionId: string; session: Session }) {
  const { theme } = useUnistyles();
  const router = useRouter();
  const safeArea = useSafeAreaInsets();
  const isLandscape = useIsLandscape();
  const deviceType = useDeviceType();
  const [message, setMessage] = React.useState('');
  const { isListening: isSpeechActive, start: startSpeech, stop: stopSpeech, cancel: cancelSpeech } = useSpeechInput(setMessage);
  const handleSpeechInputPress = React.useCallback(() => {
    if (isSpeechActive) stopSpeech();
    else startSpeech(message);
  }, [isSpeechActive, startSpeech, stopSpeech, message]);
  const handleSpeechInputCancel = React.useCallback(() => {
    cancelSpeech();
  }, [cancelSpeech]);
  const realtimeStatus = useRealtimeStatus();

  const handleMicrophonePress = React.useCallback(async () => {
    if (realtimeStatus === 'connecting') return;
    if (realtimeStatus === 'disconnected' || realtimeStatus === 'error') {
      try {
        const initialPrompt = voiceHooks.onVoiceStarted(sessionId);
        await startRealtimeSession(sessionId, initialPrompt);
      } catch (error) {
        Modal.alert(t('common.error'), t('errors.voiceSessionFailed'));
      }
    } else if (realtimeStatus === 'connected') {
      await stopRealtimeSession();
      voiceHooks.onVoiceStopped();
    }
  }, [realtimeStatus, sessionId]);
  const { messages, isLoaded } = useSessionMessages(sessionId);
  const sendError = useSessionSendError(sessionId);
  const [isSettingsBusy, setIsSettingsBusy] = React.useState(false);
  const [pendingCapabilityChange, setPendingCapabilityChange] = React.useState<{
    kind: 'model' | 'mode';
    target: string;
  } | null>(null);
  const acknowledgedCliVersions = useLocalSetting('acknowledgedCliVersions');

  // Check if CLI version is outdated and not already acknowledged
  const cliVersion = session.metadata?.version;
  const machineId = session.metadata?.machineId;
  const isCliOutdated = cliVersion && !isVersionSupported(cliVersion, MINIMUM_CLI_VERSION);
  const isAcknowledged = machineId && acknowledgedCliVersions[machineId] === cliVersion;
  const shouldShowCliWarning = isCliOutdated && !isAcknowledged;
  // Get permission mode from session object
  const permissionMode = session.permissionMode || 'accept-edits';
  const desiredModelMode =
    session.modelMode ||
    (session.metadata?.flavor === 'gemini'
      ? 'gemini-2.5-pro'
      : session.metadata?.flavor === 'opencode'
        ? 'default'
        : 'default');
  const confirmedModelId = session.capabilities?.models?.current ?? null;
  const desiredAgentMode = session.desiredAgentMode ?? null;
  const currentAgentMode = getCurrentDiscoveredModeId(session.capabilities);
  const displayCapabilities = React.useMemo(() => {
    return getDisplayCapabilities({
      capabilities: session.capabilities,
      desiredConfigOptions: session.desiredConfigOptions,
    });
  }, [session.capabilities, session.desiredConfigOptions]);
  const modelConfigOption = React.useMemo(
    () => getConfigOptionByCategory(session.capabilities, 'model'),
    [session.capabilities]
  );
  const desiredModelSelection =
    (modelConfigOption ? session.desiredConfigOptions?.[modelConfigOption.id] : null) ??
    session.modelMode ??
    desiredModelMode;
  const actualModelLabel = React.useMemo(() => {
    if (!confirmedModelId) {
      return null;
    }
    return (
      session.capabilities?.models?.available?.find(model => model.id === confirmedModelId)?.name ??
      confirmedModelId
    );
  }, [confirmedModelId, session.capabilities?.models?.available]);
  const actualModeLabel = React.useMemo(() => {
    if (!currentAgentMode) return null;
    return (
      displayCapabilities?.modes?.available?.find(mode => mode.id === currentAgentMode)?.name ??
      currentAgentMode
    );
  }, [currentAgentMode, displayCapabilities?.modes?.available]);
  const pendingCapabilityLabel = React.useMemo(() => {
    const getModeLabel = (modeId: string) =>
      displayCapabilities?.modes?.available?.find(mode => mode.id === modeId)?.name ?? modeId;
    const getModelLabel = (modelId: string) =>
      displayCapabilities?.models?.available?.find(model => model.id === modelId)?.name ?? modelId;

    if (pendingCapabilityChange?.kind === 'mode') {
      return `Switching to ${getModeLabel(pendingCapabilityChange.target)}...`;
    }

    if (pendingCapabilityChange?.kind === 'model') {
      return `Switching to ${getModelLabel(pendingCapabilityChange.target)}...`;
    }

    if (desiredAgentMode && currentAgentMode && desiredAgentMode !== currentAgentMode) {
      // Only show "Switching to..." after the initial mode has been confirmed (modes matched
      // at least once). If capabilities just arrived after mount and haven't settled yet,
      // suppress the label — otherwise it gets permanently stuck on resume because the
      // useEffect sync is also guarded by initialModeConfirmedRef.
      if (!initialModeConfirmedRef.current) return null;
      return `Switching to ${getModeLabel(desiredAgentMode)}...`;
    }

    // When confirmedModelId exists but doesn't match desired, the user explicitly
    // changed model and backend hasn't confirmed yet.
    if (desiredModelSelection && confirmedModelId && desiredModelSelection !== confirmedModelId) {
      return `Switching to ${getModelLabel(desiredModelSelection)}...`;
    }

    // Don't show "Switching to..." during initial capability discovery when
    // confirmedModelId/currentAgentMode are not yet populated. The initial default
    // selection is not a user-initiated change and shouldn't flash a switching label.

    return null;
  }, [
    confirmedModelId,
    currentAgentMode,
    desiredAgentMode,
    desiredModelSelection,
    displayCapabilities?.models?.available,
    displayCapabilities?.modes?.available,
    pendingCapabilityChange,
  ]);
  const lastModelCorrectionRef = React.useRef<string | null>(null);
  const [footerNotice, setFooterNotice] = React.useState<string | null>(null);
  const sessionStatus = useSessionStatus(session);
  const sessionUsage = useSessionUsage(sessionId);
  const alwaysShowContextSize = useSetting('alwaysShowContextSize');
  const devModeEnabled = useLocalSetting('devModeEnabled') || __DEV__;

  React.useEffect(() => {
    const availableModels = session.capabilities?.models?.available ?? [];
    if (!desiredModelSelection || availableModels.length === 0) {
      return;
    }

    const isCurrentModelValid = availableModels.some(model => model.id === desiredModelSelection);
    if (isCurrentModelValid) {
      return;
    }

    // When desiredModelSelection is a generic placeholder like 'default', the backend has
    // already resolved it to a real model. Silently adopt the backend's choice without
    // showing a "model list changed" notice — this is not a user-initiated change.
    const isGenericPlaceholder = desiredModelSelection === 'default';

    const fallbackModelId = getDefaultDiscoveredModelId(session.capabilities);
    if (!fallbackModelId) {
      return;
    }

    const correctionKey = `${sessionId}:${desiredModelSelection}:${fallbackModelId}`;
    if (lastModelCorrectionRef.current === correctionKey) {
      return;
    }
    lastModelCorrectionRef.current = correctionKey;

    if (modelConfigOption) {
      storage
        .getState()
        .updateSessionDesiredConfigOption(sessionId, modelConfigOption.id, fallbackModelId);
    } else {
      storage.getState().updateSessionModelMode(sessionId, fallbackModelId);
    }
    sync.applySettings({ lastUsedModelMode: fallbackModelId });
    if (!isGenericPlaceholder) {
      setFooterNotice(`Model list changed. Switched to the default model '${fallbackModelId}'.`);
    }
  }, [desiredModelSelection, modelConfigOption, session.capabilities, sessionId]);

  // Track whether the initial requested mode has been confirmed by the backend.
  // Only after confirmation, agent-driven mode changes (e.g. ExitPlanMode) sync back.
  //
  // Initialize to true if capabilities are already loaded at mount time (cached from server).
  // This prevents "Switching to..." from showing permanently when desiredAgentMode (from
  // localStorage) diverges from currentAgentMode (from cached capabilities) — the modes
  // have already settled; they just need a one-time sync rather than waiting for a match
  // that will never happen.
  const initialModeConfirmedRef = React.useRef(currentAgentMode !== null);
  React.useEffect(() => {
    if (!currentAgentMode || !desiredAgentMode) return;
    if (currentAgentMode === desiredAgentMode) {
      initialModeConfirmedRef.current = true;
      return;
    }
    // Don't sync during initial capability discovery (mode settling)
    if (!initialModeConfirmedRef.current) return;
    // Don't sync if the user initiated this change
    if (pendingCapabilityChange?.kind === 'mode') return;
    // Agent changed mode (e.g. ExitPlanMode) — sync desiredAgentMode to match
    storage.getState().updateSessionDesiredAgentMode(sessionId, currentAgentMode);
  }, [currentAgentMode, desiredAgentMode, pendingCapabilityChange, sessionId]);

  React.useEffect(() => {
    if (!pendingCapabilityChange) {
      return;
    }

    if (
      pendingCapabilityChange.kind === 'model' &&
      session.capabilities?.models?.current === pendingCapabilityChange.target
    ) {
      setPendingCapabilityChange(null);
      setIsSettingsBusy(false);
      return;
    }

    if (
      pendingCapabilityChange.kind === 'mode' &&
      currentAgentMode === pendingCapabilityChange.target
    ) {
      setPendingCapabilityChange(null);
      setIsSettingsBusy(false);
      return;
    }

    const timeout = setTimeout(() => {
      setPendingCapabilityChange(current => {
        if (
          !current ||
          current.kind !== pendingCapabilityChange.kind ||
          current.target !== pendingCapabilityChange.target
        ) {
          return current;
        }
        return null;
      });
      setIsSettingsBusy(false);
      Modal.alert(
        t('common.error'),
        pendingCapabilityChange.kind === 'model'
          ? 'Model change could not be confirmed.'
          : 'Mode change could not be confirmed.'
      );
    }, 8000);

    return () => {
      clearTimeout(timeout);
    };
  }, [currentAgentMode, pendingCapabilityChange, session.capabilities, sessionId]);

  // Use draft hook for auto-saving message drafts
  const { clearDraft } = useDraft(sessionId, message, setMessage);

  // --- Image attachment state ---
  const [pendingAttachments, setPendingAttachments] = React.useState<
    Array<{ localUri: string; uploading: boolean; error?: string; ref?: AttachmentRef }>
  >([]);
  const isUploading = pendingAttachments.some(a => a.uploading);

  // Handle image paste from clipboard (web paste event or native clipboard)
  const handlePasteImage = React.useCallback(
    async (images: PastedImage[]) => {
      if (images.length === 0) return;

      // Add placeholders
      setPendingAttachments(prev => [
        ...prev,
        ...images.map(img => ({ localUri: img.uri, uploading: true })),
      ]);

      // Serial upload to avoid OOM
      for (const image of images) {
        try {
          const result = await uploadClipboardImage(image, sessionId);
          // Revoke the blob URL now that the upload pipeline has read it
          if (Platform.OS === 'web' && image.uri.startsWith('blob:')) {
            URL.revokeObjectURL(image.uri);
          }
          setPendingAttachments(prev =>
            prev.map(a =>
              a.localUri === image.uri
                ? { localUri: result.localUri, uploading: false, ref: result.attachmentRef }
                : a
            )
          );
        } catch (err) {
          logger.error('Clipboard image upload failed', toError(err), { sessionId });
          const errorMsg = err instanceof Error ? err.message : String(err);
          setPendingAttachments(prev =>
            prev.map(a =>
              a.localUri === image.uri ? { ...a, uploading: false, error: errorMsg } : a
            )
          );
          Modal.alert(t('common.error'), `Image upload failed: ${errorMsg}`);
        }
      }
    },
    [sessionId]
  );

  // Subscribe to global paste-image bridge (registered in _layout.tsx)
  React.useEffect(() => subscribePasteImage(handlePasteImage), [handlePasteImage]);

  const pickFromLibrary = React.useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;

    // Add placeholders
    setPendingAttachments(prev => [
      ...prev,
      ...result.assets.map(asset => ({ localUri: asset.uri, uploading: true })),
    ]);

    // Serial upload to avoid OOM
    for (const asset of result.assets) {
      try {
        const uploadResult = await uploadAttachment(asset, sessionId);
        setPendingAttachments(prev =>
          prev.map(a =>
            a.localUri === asset.uri
              ? { localUri: uploadResult.localUri, uploading: false, ref: uploadResult.attachmentRef }
              : a
          )
        );
      } catch (err) {
        logger.error('Attachment upload failed', toError(err), { sessionId });
        const errorMsg = err instanceof Error ? err.message : String(err);
        setPendingAttachments(prev =>
          prev.map(a =>
            a.localUri === asset.uri
              ? { ...a, uploading: false, error: errorMsg }
              : a
          )
        );
        Modal.alert(t('common.error'), `Image upload failed: ${errorMsg}`);
      }
    }
  }, [sessionId]);

  const pasteFromClipboard = React.useCallback(async () => {
    const clipImg = await getClipboardImage();
    if (!clipImg) return;
    await handlePasteImage([clipImg]);
  }, [handlePasteImage]);

  const handlePickImages = React.useCallback(async () => {
    // On web, paste is handled by the paste event listener — just open library
    if (Platform.OS === 'web') {
      await pickFromLibrary();
      return;
    }

    // On native, check if clipboard has an image and offer both options
    const hasClip = await hasClipboardImage();
    if (!hasClip) {
      await pickFromLibrary();
      return;
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [t('common.cancel'), t('session.pasteFromClipboard'), t('session.chooseFromLibrary')],
          cancelButtonIndex: 0,
        },
        buttonIndex => {
          if (buttonIndex === 1) void pasteFromClipboard();
          else if (buttonIndex === 2) void pickFromLibrary();
        }
      );
    } else {
      // Android: use Modal.alert with buttons
      Modal.alert(t('session.addImage'), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('session.pasteFromClipboard'), onPress: () => void pasteFromClipboard() },
        { text: t('session.chooseFromLibrary'), onPress: () => void pickFromLibrary() },
      ]);
    }
  }, [pickFromLibrary, pasteFromClipboard]);

  const handleRemoveAttachment = React.useCallback((index: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Clear attachments on session change
  React.useEffect(() => {
    setPendingAttachments([]);
  }, [sessionId]);

  // Handle dismissing CLI version warning
  const handleDismissCliWarning = React.useCallback(() => {
    if (machineId && cliVersion) {
      storage.getState().applyLocalSettings({
        acknowledgedCliVersions: {
          ...acknowledgedCliVersions,
          [machineId]: cliVersion,
        },
      });
    }
  }, [machineId, cliVersion, acknowledgedCliVersions]);

  // Function to update permission mode
  const updatePermissionMode = React.useCallback(
    (mode: 'read-only' | 'accept-edits' | 'yolo') => {
      storage.getState().updateSessionPermissionMode(sessionId, mode);
    },
    [sessionId]
  );

  // Function to update model mode (for Gemini sessions)
  const updateModelMode = React.useCallback(
    async (mode: string | null) => {
      if (!mode || confirmedModelId === mode) return;
      try {
        setIsSettingsBusy(true);
        setPendingCapabilityChange({ kind: 'model', target: mode });
        if (modelConfigOption) {
          await sessionSetConfig(sessionId, modelConfigOption.id, mode);
          storage
            .getState()
            .updateSessionDesiredConfigOption(sessionId, modelConfigOption.id, mode);
        } else {
          await sessionSetModel(sessionId, mode);
          storage.getState().updateSessionModelMode(sessionId, mode);
        }
        sync.applySettings({ lastUsedModelMode: mode });
      } catch (error) {
        logger.error('Failed to switch model', toError(error), { sessionId, mode });
        setPendingCapabilityChange(null);
        setIsSettingsBusy(false);
        Modal.alert(t('common.error'), 'Failed to switch model');
      }
    },
    [confirmedModelId, modelConfigOption, sessionId]
  );

  const updateAgentMode = React.useCallback(
    async (modeId: string) => {
      if (!displayCapabilities?.modes || currentAgentMode === modeId) return;
      try {
        setIsSettingsBusy(true);
        setPendingCapabilityChange({ kind: 'mode', target: modeId });
        await sessionSetMode(sessionId, modeId);
        storage.getState().updateSessionDesiredAgentMode(sessionId, modeId);
      } catch (error) {
        logger.error('Failed to switch agent mode', toError(error), { sessionId, modeId });
        setPendingCapabilityChange(null);
        setIsSettingsBusy(false);
        Modal.alert(t('common.error'), 'Failed to switch mode');
      }
    },
    [currentAgentMode, displayCapabilities?.modes, sessionId]
  );

  const updateConfigOption = React.useCallback(
    async (optionId: string, value: string) => {
      if (!session.capabilities?.configOptions) return;
      const previousCapabilities = session.capabilities;
      try {
        setIsSettingsBusy(true);
        storage.getState().updateSessionCapabilities(sessionId, {
          ...session.capabilities,
          configOptions: session.capabilities.configOptions.map(option =>
            option.id === optionId ? { ...option, currentValue: value } : option
          ),
        });
        await sessionSetConfig(sessionId, optionId, value);
        storage.getState().updateSessionDesiredConfigOption(sessionId, optionId, value);
      } catch (error) {
        logger.error('Failed to update config option', toError(error), {
          sessionId,
          optionId,
          value,
        });
        storage.getState().updateSessionCapabilities(sessionId, previousCapabilities ?? null);
        Modal.alert(t('common.error'), 'Failed to update setting');
      } finally {
        setIsSettingsBusy(false);
      }
    },
    [sessionId, session.capabilities]
  );

  // Memoize header-dependent styles to prevent re-renders
  const headerDependentStyles = React.useMemo(
    () => ({
      contentContainer: {
        flex: 1,
      },
      flatListStyle: {
        marginTop: 0, // No marginTop needed since header is handled by parent
      },
    }),
    []
  );

  // Trigger session visibility and initialize git status sync
  React.useLayoutEffect(() => {
    // Trigger session sync
    sync.onSessionVisible(sessionId);

    // Initialize git status sync for this session
    gitStatusSync.getSync(sessionId);
  }, [sessionId]);

  const content = (
    <>{messages.length > 0 && <ChatList session={session} footerNotice={footerNotice} />}</>
  );
  const placeholder =
    messages.length === 0 ? (
      <>
        {isLoaded ? (
          <EmptyMessages session={session} />
        ) : (
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        )}
      </>
    ) : null;

  const input = (
    <>
      {sendError && (
        <View
          style={[
            sendErrorStyles.container,
            { backgroundColor: theme.dark ? 'rgba(220,38,38,0.15)' : '#FEF2F2' },
          ]}
        >
          <Text style={[sendErrorStyles.text, { color: theme.dark ? '#FCA5A5' : '#991B1B' }]}>
            {t('session.sendFailed')}
          </Text>
          <Pressable onPress={() => sync.retrySend(sessionId)} hitSlop={8}>
            <Ionicons name="refresh" size={16} color={theme.dark ? '#FCA5A5' : '#991B1B'} />
          </Pressable>
          <Pressable onPress={() => sync.discardPendingMessages(sessionId)} hitSlop={8}>
            <Ionicons name="close" size={16} color={theme.dark ? '#FCA5A5' : '#991B1B'} />
          </Pressable>
        </View>
      )}
      <AgentInput
        placeholder={t('session.inputPlaceholder')}
        value={message}
        onChangeText={setMessage}
        sessionId={sessionId}
        permissionMode={permissionMode}
        onPermissionModeChange={updatePermissionMode}
        modelMode={(confirmedModelId ?? undefined) as any}
        onModelModeChange={updateModelMode as any}
        capabilities={displayCapabilities}
        actualModelLabel={actualModelLabel}
        actualModeLabel={actualModeLabel}
        pendingCapabilityLabel={pendingCapabilityLabel}
        onAgentModeChange={updateAgentMode}
        onConfigOptionChange={updateConfigOption}
        isSettingsBusy={isSettingsBusy}
        onRunCommand={commandId => {
          void sync
            .sendMessage(sessionId, `/${commandId}`)
            .then(result => {
              if (!result.ok) {
                Modal.alert(
                  t('common.error'),
                  result.reason === 'server_disconnected'
                    ? t('session.sendBlockedServerDisconnected')
                    : t('session.sendBlockedDaemonOffline')
                );
              }
            });
        }}
        metadata={session.metadata}
        connectionStatus={{
          text: sessionStatus.statusText,
          color: sessionStatus.statusColor,
          dotColor: sessionStatus.statusDotColor,
          isPulsing: sessionStatus.isPulsing,
        }}
        onSend={() => {
          const hasAttachments = pendingAttachments.some(a => a.ref && !a.error);
          if (message.trim() || hasAttachments) {
            const trimmedMessage = message.trim();
            // Slash commands are sent as regular messages so the user sees their own
            // message bubble (e.g. "/compact") and the agent receives the text naturally.
            // No special RPC path needed — ACP agents handle "/" commands in prompts.
            // Collect successfully uploaded attachment refs
            const attachmentRefs = pendingAttachments
              .filter(a => a.ref && !a.error)
              .map(a => a.ref!);
            void sync
              .sendMessage(sessionId, trimmedMessage, undefined, {
                ...(attachmentRefs.length > 0 && { attachments: attachmentRefs }),
              })
              .then(result => {
                if (!result.ok) {
                  Modal.alert(
                    t('common.error'),
                    result.reason === 'server_disconnected'
                      ? t('session.sendBlockedServerDisconnected')
                      : t('session.sendBlockedDaemonOffline')
                  );
                  return;
                }
                // Only clear input on successful send
                setMessage('');
                clearDraft();
                setFooterNotice(null);
                setPendingAttachments([]);
              });
          }
        }}
        onPickImages={handlePickImages}
        pendingAttachments={pendingAttachments}
        onRemoveAttachment={handleRemoveAttachment}
        isSendDisabled={isUploading}
        onSpeechInputPress={handleSpeechInputPress}
        onSpeechInputCancel={handleSpeechInputCancel}
        isSpeechInputActive={isSpeechActive}
        onMicPress={handleMicrophonePress}
        isMicActive={realtimeStatus === 'connected' || realtimeStatus === 'connecting'}
        onAbort={() => sessionAbort(sessionId)}
        showAbortButton={sessionStatus.state === 'thinking' || sessionStatus.state === 'waiting'}
        onFileViewerPress={() => router.push(`/session/${sessionId}/files`)}
        // Autocomplete configuration
        autocompletePrefixes={['@', '/']}
        autocompleteSuggestions={query => getSuggestions(sessionId, query)}
        usageData={
          sessionUsage
            ? {
                inputTokens: sessionUsage.inputTokens,
                outputTokens: sessionUsage.outputTokens,
                cacheCreation: sessionUsage.cacheCreation,
                cacheRead: sessionUsage.cacheRead,
                contextSize: sessionUsage.contextSize,
              }
            : session.latestUsage
              ? {
                  inputTokens: session.latestUsage.inputTokens,
                  outputTokens: session.latestUsage.outputTokens,
                  cacheCreation: session.latestUsage.cacheCreation,
                  cacheRead: session.latestUsage.cacheRead,
                  contextSize: session.latestUsage.contextSize,
                }
              : undefined
        }
        alwaysShowContextSize={alwaysShowContextSize}
      />
    </>
  );

  return (
    <>
      {/* CLI Version Warning Overlay - Subtle centered pill */}
      {shouldShowCliWarning && !(isLandscape && deviceType === 'phone') && (
        <Pressable
          onPress={handleDismissCliWarning}
          style={{
            position: 'absolute',
            top: 8, // Position at top of content area (padding handled by parent)
            alignSelf: 'center',
            backgroundColor: '#FFF3CD',
            borderRadius: 100, // Fully rounded pill
            paddingHorizontal: 14,
            paddingVertical: 7,
            flexDirection: 'row',
            alignItems: 'center',
            zIndex: 998, // Below voice bar but above content
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.15,
            shadowRadius: 4,
            elevation: 4,
          }}
        >
          <Ionicons name="warning-outline" size={14} color="#FF9500" style={{ marginRight: 6 }} />
          <Text
            style={{
              fontSize: 12,
              color: '#856404',
              fontWeight: '600',
            }}
          >
            {t('sessionInfo.cliVersionOutdated')}
          </Text>
          <Ionicons name="close" size={14} color="#856404" style={{ marginLeft: 8 }} />
        </Pressable>
      )}

      {/* Main content area - no padding since header is overlay */}
      <View
        style={{
          flexBasis: 0,
          flexGrow: 1,
          paddingBottom: safeArea.bottom + (isRunningOnMac() || Platform.OS === 'web' ? 32 : 0),
        }}
      >
        <AgentContentView content={content} input={input} placeholder={placeholder} />
      </View>

      {/* Back button for landscape phone mode when header is hidden */}
      {isLandscape && deviceType === 'phone' && (
        <Pressable
          onPress={() => router.back()}
          style={{
            position: 'absolute',
            top: safeArea.top + 8,
            left: 16,
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: `rgba(${theme.dark ? '28, 23, 28' : '255, 255, 255'}, 0.9)`,
            alignItems: 'center',
            justifyContent: 'center',
            ...Platform.select({
              ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 4,
              },
              android: {
                elevation: 2,
              },
            }),
          }}
          hitSlop={15}
        >
          <Ionicons
            name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
            size={Platform.select({ ios: 28, default: 24 })}
            color="#000"
          />
        </Pressable>
      )}
    </>
  );
}

const sendErrorStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  text: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    textAlign: 'center',
  },
});
