import Constants from 'expo-constants';
import { useRouter, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { View, Text, Platform, Pressable, useWindowDimensions } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { AgentInput } from '@/components/AgentInput';
import { ChatFooter } from '@/components/ChatFooter';
import { Typography } from '@/constants/Typography';
import { machineListSupportedAgents, machineSpawnNewSession } from '@/sync/ops';
import { useAllMachines, storage, useLocalSetting, useSetting, useSessions } from '@/sync/storage';
import { layout } from '@/components/layout';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { createWorktree } from '@/utils/createWorktree';
import { isMachineOnline } from '@/utils/machineUtils';
import { useHeaderHeight } from '@/utils/responsive';
import { Modal } from '@/modal';
import { SessionTypeSelector } from '@/components/SessionTypeSelector';
import { getTempData, type NewSessionData } from '@/utils/tempDataStore';
import { ModelMode } from '@/components/PermissionModeSelector';
import { StyleSheet } from 'react-native-unistyles';
import { useCLIDetection } from '@/hooks/useCLIDetection';
import { clearNewSessionDraft, loadNewSessionDraft, saveNewSessionDraft } from '@/sync/persistence';
import {
  coerceAgentType,
  isAcpAgent,
  isExperimentalAgent,
  type AppAgentFlavor,
} from '@/sync/agentFlavor';
import { hydrateCachedCapabilities, loadCachedCapabilities } from '@/sync/sessionCapabilitiesCache';
import {
  getConfigOptionByCategory,
  getLatestCapabilitiesForAgent,
  PermissionMode,
  resolveDraftCapabilities,
  SessionCapabilities,
  usesDiscoveredCapabilitiesOnly,
} from '@/sync/sessionCapabilities';
import { safeStringify } from '@saaskit-dev/agentbridge/common';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
import * as ImagePicker from 'expo-image-picker';
import {
  uploadAttachment,
  uploadClipboardImage,
  type AttachmentRef,
} from '@/sync/attachmentUpload';
import { subscribePasteImage, type PastedImage } from '@/utils/pasteImageBridge';
const logger = new Logger('app/new');

// Simple temporary state for passing selections back from picker screens
let onMachineSelected: (machineId: string) => void = () => {};

export const callbacks = {
  onMachineSelected: (machineId: string) => {
    onMachineSelected(machineId);
  },
};

// Helper function to get the most recent path for a machine
// Returns the path from the most recently CREATED session for this machine
const getRecentPathForMachine = (
  machineId: string | null,
  recentPaths: Array<{ machineId: string; path: string }>
): string => {
  if (!machineId) return '';

  const machine = storage.getState().machines[machineId];
  const defaultPath = machine?.metadata?.homeDir || '';

  // Get all sessions for this machine, sorted by creation time (most recent first)
  const sessions = Object.values(storage.getState().sessions);
  const pathsWithTimestamps: Array<{ path: string; timestamp: number }> = [];

  sessions.forEach(session => {
    if (session.metadata?.machineId === machineId && session.metadata?.path) {
      pathsWithTimestamps.push({
        path: session.metadata.path,
        timestamp: session.createdAt, // Use createdAt, not updatedAt
      });
    }
  });

  // Sort by creation time (most recently created first)
  pathsWithTimestamps.sort((a, b) => b.timestamp - a.timestamp);

  // Return the most recently created session's path, or default
  return pathsWithTimestamps[0]?.path || defaultPath;
};

// Configuration constants
const RECENT_PATHS_DEFAULT_VISIBLE = 5;
const DEV_INVALID_MODEL_ID = 'dev-invalid-model';

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    flex: 1,
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    paddingTop: Platform.OS === 'web' ? 0 : 40,
  },
  permissionButton: {
    width: '48%',
    backgroundColor: theme.colors.input.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  permissionButtonSelected: {
    borderColor: theme.colors.button.primary.background,
    backgroundColor: theme.colors.button.primary.background + '10',
  },
  permissionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    marginTop: 8,
    textAlign: 'center',
    ...Typography.default('semiBold'),
  },
  permissionButtonTextSelected: {
    color: theme.colors.button.primary.background,
  },
  permissionButtonDesc: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
    ...Typography.default(),
  },
}));

function NewSessionWizard() {
  const { theme, rt } = useUnistyles();
  const router = useRouter();
  const safeArea = useSafeAreaInsets();
  const {
    prompt,
    dataId,
    machineId: machineIdParam,
    path: pathParam,
    agent: agentParam,
  } = useLocalSearchParams<{
    prompt?: string;
    dataId?: string;
    machineId?: string;
    path?: string;
    agent?: string;
  }>();

  // Try to get data from temporary store first
  const tempSessionData = React.useMemo(() => {
    if (dataId) {
      return getTempData<NewSessionData>(dataId);
    }
    return null;
  }, [dataId]);

  // Load persisted draft state (survives remounts/screen navigation)
  const persistedDraft = React.useRef(loadNewSessionDraft()).current;

  // Settings and state
  const recentMachinePaths = useSetting('recentMachinePaths');
  const lastUsedAgent = useSetting('lastUsedAgent');

  const devModeEnabled = useLocalSetting('devModeEnabled') || __DEV__;
  const lastUsedPermissionMode = useSetting('lastUsedPermissionMode');
  const lastUsedModelMode = useSetting('lastUsedModelMode');
  const lastUsedAgentMode = useSetting('lastUsedAgentMode');
  const experimentsEnabled = useSetting('experiments');
  const machines = useAllMachines();
  const sessions = useSessions();

  // Wizard state
  const [agentType, setAgentType] = React.useState<AppAgentFlavor>(() => {
    // Check if agent type was provided in temp data
    if (tempSessionData?.agentType) {
      const requestedAgentType = coerceAgentType(tempSessionData.agentType);
      if (isExperimentalAgent(requestedAgentType) && !experimentsEnabled) {
        return 'claude';
      }
      return requestedAgentType;
    }
    if (typeof lastUsedAgent === 'string') {
      const savedAgentType = coerceAgentType(lastUsedAgent);
      if (!isExperimentalAgent(savedAgentType) || experimentsEnabled) {
        return savedAgentType;
      }
    }
    return 'claude';
  });
  const [supportedAgentTypes, setSupportedAgentTypes] = React.useState<AppAgentFlavor[]>([
    'claude',
    'codex',
    'gemini',
    'opencode',
    'claude-native',
  ]);

  // Persist agent selection changes (separate from setState to avoid race condition)
  // This runs after agentType state is updated, ensuring the value is stable
  React.useEffect(() => {
    sync.applySettings({ lastUsedAgent: agentType });
  }, [agentType]);

  const [sessionType, setSessionType] = React.useState<'simple' | 'worktree'>('simple');
  const [permissionMode, setPermissionMode] = React.useState<PermissionMode>(() => {
    const validModes: PermissionMode[] = ['read-only', 'accept-edits', 'yolo'];
    if (lastUsedPermissionMode && validModes.includes(lastUsedPermissionMode as PermissionMode)) {
      return lastUsedPermissionMode as PermissionMode;
    }
    return 'accept-edits';
  });

  // Session details state
  const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(() => {
    if (machines.length > 0) {
      if (recentMachinePaths.length > 0) {
        for (const recent of recentMachinePaths) {
          if (machines.find(m => m.id === recent.machineId)) {
            return recent.machineId;
          }
        }
      }
      return machines[0].id;
    }
    return null;
  });
  const [cachedCapabilities, setCachedCapabilities] = React.useState<SessionCapabilities | null>(
    null
  );
  const [cacheHydrated, setCacheHydrated] = React.useState(false);

  // NOTE: Permission mode reset on agentType change is handled by the validation useEffect below.
  React.useEffect(() => {
    let cancelled = false;
    setCacheHydrated(false);

    // Load from local SQLite first (fast), then hydrate from remote KV (may be newer).
    // Sequential: local provides instant UI, remote overwrites only if it has data.
    void (async () => {
      const local = await loadCachedCapabilities(selectedMachineId, agentType);
      if (cancelled) return;
      if (local) setCachedCapabilities(local);

      const remote = await hydrateCachedCapabilities(selectedMachineId, agentType);
      if (cancelled) return;
      if (remote) setCachedCapabilities(remote);

      setCacheHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedMachineId, agentType]);

  // Capabilities are "loaded" when BOTH the cache has been hydrated AND session data is available.
  // Sessions carry capabilities too — we must wait for them before concluding "no capabilities found".
  const capabilitiesLoaded = cacheHydrated && sessions !== null;

  const draftCapabilities = React.useMemo(() => {
    const latestCapabilities = getLatestCapabilitiesForAgent(
      sessions as any[],
      selectedMachineId,
      agentType
    );
    return resolveDraftCapabilities({
      agentType,
      cachedCapabilities,
      latestCapabilities,
    });
  }, [cachedCapabilities, sessions, selectedMachineId, agentType]);
  const displayCapabilities = React.useMemo(() => {
    if (
      !devModeEnabled ||
      !usesDiscoveredCapabilitiesOnly(agentType) ||
      !draftCapabilities.models
    ) {
      return draftCapabilities;
    }

    const hasDevInvalidModel = draftCapabilities.models.available.some(
      model => model.id === DEV_INVALID_MODEL_ID
    );
    if (hasDevInvalidModel) {
      return draftCapabilities;
    }

    return {
      ...draftCapabilities,
      models: {
        ...draftCapabilities.models,
        available: [
          ...draftCapabilities.models.available,
          {
            id: DEV_INVALID_MODEL_ID,
            name: 'Dev Invalid Model',
            description: 'Developer-only test model that should trigger fallback on first send',
          },
        ],
      },
    };
  }, [agentType, devModeEnabled, draftCapabilities]);
  const availableModelIds = React.useMemo(
    () => displayCapabilities.models?.available.map(model => model.id) ?? ['default'],
    [displayCapabilities]
  );
  const defaultModelId = displayCapabilities.models?.current ?? 'default';

  const [modelMode, setModelMode] = React.useState<ModelMode>(() => {
    if (lastUsedModelMode && availableModelIds.includes(lastUsedModelMode)) {
      return lastUsedModelMode;
    }
    return defaultModelId;
  });
  const [draftAgentMode, setDraftAgentMode] = React.useState<string | null>(
    () => lastUsedAgentMode ?? null
  );
  const shouldShowCapabilityDiscoveryNotice = React.useMemo(
    () =>
      capabilitiesLoaded &&
      usesDiscoveredCapabilitiesOnly(agentType) &&
      !displayCapabilities.models &&
      !displayCapabilities.modes &&
      !(displayCapabilities.configOptions?.length ?? 0) &&
      !(displayCapabilities.commands?.length ?? 0),
    [agentType, capabilitiesLoaded, displayCapabilities]
  );
  const displayCapabilitiesWithDraftMode = React.useMemo(() => {
    if (!draftAgentMode || !displayCapabilities.modes) {
      return displayCapabilities;
    }
    if (!displayCapabilities.modes.available.some(mode => mode.id === draftAgentMode)) {
      return displayCapabilities;
    }
    return {
      ...displayCapabilities,
      modes: {
        ...displayCapabilities.modes,
        current: draftAgentMode,
      },
    };
  }, [displayCapabilities, draftAgentMode]);
  React.useEffect(() => {
    if (!draftAgentMode) {
      return;
    }
    const availableModes = displayCapabilities.modes?.available;
    // Don't clear draftAgentMode if modes haven't loaded yet —
    // wait until we have actual mode data before deciding if the saved mode is invalid
    if (!availableModes) {
      return;
    }
    if (!availableModes.some(mode => mode.id === draftAgentMode)) {
      setDraftAgentMode(null);
    }
  }, [displayCapabilities.modes, draftAgentMode]);

  // Persist agent mode selection
  React.useEffect(() => {
    if (draftAgentMode) {
      sync.applySettings({ lastUsedAgentMode: draftAgentMode });
    }
  }, [draftAgentMode]);

  const handlePermissionModeChange = React.useCallback((mode: PermissionMode) => {
    setPermissionMode(mode);
    sync.applySettings({ lastUsedPermissionMode: mode });
  }, []);

  //
  // Path selection
  //

  const [selectedPath, setSelectedPath] = React.useState<string>(() => {
    return getRecentPathForMachine(selectedMachineId, recentMachinePaths);
  });
  const [sessionPrompt, setSessionPrompt] = React.useState(() => {
    return tempSessionData?.prompt || prompt || persistedDraft?.input || '';
  });
  const [isCreating, setIsCreating] = React.useState(false);

  // --- Image attachment state (pending before session is created) ---
  const [pendingAttachments, setPendingAttachments] = React.useState<
    Array<{ localUri: string; uploading: boolean; error?: string; ref?: AttachmentRef; pastedImage?: PastedImage; asset?: ImagePicker.ImagePickerAsset }>
  >([]);
  const isUploading = pendingAttachments.some(a => a.uploading);

  const handlePasteImage = React.useCallback((images: PastedImage[]) => {
    if (images.length === 0) return;
    // Store locally — upload happens after session creation
    setPendingAttachments(prev => [
      ...prev,
      ...images.map(img => ({ localUri: img.uri, uploading: false, pastedImage: img })),
    ]);
  }, []);

  // Subscribe to global paste-image bridge (registered in _layout.tsx)
  React.useEffect(() => subscribePasteImage(handlePasteImage), [handlePasteImage]);

  const handlePickImages = React.useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    setPendingAttachments(prev => [
      ...prev,
      ...result.assets.map(asset => ({ localUri: asset.uri, uploading: false, asset })),
    ]);
  }, []);

  const handleRemoveAttachment = React.useCallback((index: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  // When machines arrive after initial mount (e.g. direct URL navigation before sync completes),
  // auto-select the first machine if none is selected yet.
  React.useEffect(() => {
    if (selectedMachineId !== null || machines.length === 0) return;
    let machineId: string | null = null;
    if (recentMachinePaths.length > 0) {
      for (const recent of recentMachinePaths) {
        if (machines.find(m => m.id === recent.machineId)) {
          machineId = recent.machineId;
          break;
        }
      }
    }
    if (!machineId) machineId = machines[0].id;
    setSelectedMachineId(machineId);
    setSelectedPath(getRecentPathForMachine(machineId, recentMachinePaths));
  }, [machines, selectedMachineId, recentMachinePaths]);

  // Handle machineId route param from picker screens (main's navigation pattern)
  React.useEffect(() => {
    if (typeof machineIdParam !== 'string' || machines.length === 0) {
      return;
    }
    if (!machines.some(m => m.id === machineIdParam)) {
      return;
    }
    if (machineIdParam !== selectedMachineId) {
      setSelectedMachineId(machineIdParam);
      const bestPath = getRecentPathForMachine(machineIdParam, recentMachinePaths);
      setSelectedPath(bestPath);
    }
  }, [machineIdParam, machines, recentMachinePaths, selectedMachineId]);

  // Handle path route param from picker screens (main's navigation pattern)
  React.useEffect(() => {
    if (typeof pathParam !== 'string') {
      return;
    }
    const trimmedPath = pathParam.trim();
    if (trimmedPath && trimmedPath !== selectedPath) {
      setSelectedPath(trimmedPath);
    }
  }, [pathParam, selectedPath]);

  React.useEffect(() => {
    if (typeof agentParam !== 'string') {
      return;
    }
    const nextAgentType = coerceAgentType(agentParam);
    if (nextAgentType !== agentType) {
      setAgentType(nextAgentType);
    }
  }, [agentParam, agentType]);

  // CLI Detection - automatic, non-blocking detection of installed CLIs on selected machine
  const cliAvailability = useCLIDetection(selectedMachineId);

  React.useEffect(() => {
    if (!selectedMachineId) {
      return;
    }
    let cancelled = false;
    void machineListSupportedAgents(selectedMachineId).then(agentTypes => {
      if (cancelled || agentTypes.length === 0) {
        return;
      }
      const discoveredAgentTypes = agentTypes.map(agentType => coerceAgentType(agentType));
      setSupportedAgentTypes(discoveredAgentTypes);
      if (!discoveredAgentTypes.includes(agentType)) {
        setAgentType(discoveredAgentTypes[0] ?? 'claude');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedMachineId, agentType]);

  const isAgentAvailable = React.useCallback(
    (candidate: string): boolean => {
      if (candidate === 'claude-native') return cliAvailability.claudeNative !== false;
      if (candidate === 'claude') return cliAvailability.claude !== false;
      if (candidate === 'codex') return cliAvailability.codex !== false;
      if (candidate === 'gemini') return experimentsEnabled && cliAvailability.gemini !== false;
      if (candidate === 'opencode') return experimentsEnabled && cliAvailability.opencode !== false;
      if (candidate === 'cursor') return experimentsEnabled && cliAvailability.cursor !== false;
      return true;
    },
    [
      cliAvailability.claudeNative,
      cliAvailability.claude,
      cliAvailability.codex,
      cliAvailability.gemini,
      cliAvailability.opencode,
      cliAvailability.cursor,
      experimentsEnabled,
    ]
  );

  // Auto-correct invalid agent selection after CLI detection completes
  // This handles the case where lastUsedAgent was 'codex' but codex is not installed
  React.useEffect(() => {
    // Only act when detection has completed (timestamp > 0)
    if (cliAvailability.timestamp === 0) return;

    // Check if currently selected agent is available
    const agentAvailable = isAgentAvailable(agentType);

    if (agentAvailable === false) {
      // Current agent not available - find first available
      const availableAgent =
        supportedAgentTypes.find(candidate => isAgentAvailable(candidate)) ?? 'claude';

      logger.warn(`[AgentSelection] ${agentType} not available, switching to ${availableAgent}`);
      setAgentType(availableAgent);
    }
  }, [
    cliAvailability.timestamp,
    cliAvailability.claudeNative,
    cliAvailability.claude,
    cliAvailability.codex,
    cliAvailability.gemini,
    cliAvailability.opencode,
    cliAvailability.cursor,
    agentType,
    experimentsEnabled,
    isAgentAvailable,
    supportedAgentTypes,
  ]);

  // Visible agent types (filtered by experiments setting)
  const visibleAgentTypes = React.useMemo(
    () => supportedAgentTypes.filter(a => experimentsEnabled || !isExperimentalAgent(a)),
    [supportedAgentTypes, experimentsEnabled]
  );

  const selectedMachine = React.useMemo(() => {
    if (!selectedMachineId) return null;
    return machines.find(m => m.id === selectedMachineId);
  }, [selectedMachineId, machines]);

  const recentPaths = React.useMemo(() => {
    if (!selectedMachineId) return [];

    const paths: string[] = [];
    const pathSet = new Set<string>();

    // First, add paths from recentMachinePaths (these are the most recent)
    recentMachinePaths.forEach(entry => {
      if (entry.machineId === selectedMachineId && !pathSet.has(entry.path)) {
        paths.push(entry.path);
        pathSet.add(entry.path);
      }
    });

    // Then add paths from sessions if we need more
    if (sessions) {
      const pathsWithTimestamps: Array<{ path: string; timestamp: number }> = [];

      sessions.forEach(item => {
        if (typeof item === 'string') return; // Skip section headers

        const session = item as any;
        if (session.metadata?.machineId === selectedMachineId && session.metadata?.path) {
          const path = session.metadata.path;
          if (!pathSet.has(path)) {
            pathSet.add(path);
            pathsWithTimestamps.push({
              path,
              timestamp: session.updatedAt || session.createdAt,
            });
          }
        }
      });

      // Sort session paths by most recent first and add them
      pathsWithTimestamps
        .sort((a, b) => b.timestamp - a.timestamp)
        .forEach(item => paths.push(item.path));
    }

    return paths;
  }, [sessions, selectedMachineId, recentMachinePaths]);

  // Validation
  const canCreate = React.useMemo(() => {
    if (selectedMachineId === null || selectedPath.trim() === '') {
      return false;
    }
    // For ACP agents, block send until capabilities have been loaded from cache/remote.
    // Only truly first-time users (no cache, no sessions) will see the discovery notice.
    if (usesDiscoveredCapabilitiesOnly(agentType) && !capabilitiesLoaded) {
      return false;
    }
    return true;
  }, [selectedMachineId, selectedPath, agentType, capabilitiesLoaded]);

  // Permission modes are now unified across all agents - no reset needed on agent type change

  // Reset model mode when agent type changes to appropriate default
  React.useEffect(() => {
    if (!modelMode || !availableModelIds.includes(modelMode)) {
      setModelMode(defaultModelId);
    }
  }, [agentType, modelMode, availableModelIds, defaultModelId]);

  // Handle machine and path selection callbacks
  React.useEffect(() => {
    const handler = (machineId: string) => {
      const machine = storage.getState().machines[machineId];
      if (machine) {
        setSelectedMachineId(machineId);
        const bestPath = getRecentPathForMachine(machineId, recentMachinePaths);
        setSelectedPath(bestPath);
      }
    };
    onMachineSelected = handler;
    return () => {
      onMachineSelected = () => {};
    };
  }, [recentMachinePaths]);

  const handleMachineClick = React.useCallback(() => {
    router.push('/new/pick/machine');
  }, [router]);

  const handlePathClick = React.useCallback(() => {
    if (selectedMachineId) {
      router.push({
        pathname: '/new/pick/path',
        params: {
          machineId: selectedMachineId,
          selectedPath,
        },
      });
    }
  }, [selectedMachineId, selectedPath, router]);

  // Session creation
  const handleCreateSession = React.useCallback(async () => {
    if (!selectedMachineId) {
      Modal.alert(t('common.error'), t('newSession.noMachineSelected'));
      return;
    }
    if (!selectedPath) {
      Modal.alert(t('common.error'), t('newSession.noPathSelected'));
      return;
    }

    setIsCreating(true);

    try {
      let actualPath = selectedPath;

      // Handle worktree creation
      if (sessionType === 'worktree' && experimentsEnabled) {
        const worktreeResult = await createWorktree(selectedMachineId, selectedPath);

        if (!worktreeResult.success) {
          if (worktreeResult.error === 'Not a Git repository') {
            Modal.alert(t('common.error'), t('newSession.worktree.notGitRepo'));
          } else {
            Modal.alert(
              t('common.error'),
              t('newSession.worktree.failed', { error: worktreeResult.error || 'Unknown error' })
            );
          }
          setIsCreating(false);
          return;
        }

        actualPath = worktreeResult.worktreePath;
      }

      // Save settings
      const updatedPaths = [
        { machineId: selectedMachineId, path: selectedPath },
        ...recentMachinePaths.filter(rp => rp.machineId !== selectedMachineId),
      ].slice(0, 10);
      sync.applySettings({
        recentMachinePaths: updatedPaths,
        lastUsedAgent: agentType,
        lastUsedPermissionMode: permissionMode,
        lastUsedModelMode: modelMode,
        lastUsedAgentMode: displayCapabilitiesWithDraftMode.modes?.current ?? null,
      });

      const result = await machineSpawnNewSession({
        machineId: selectedMachineId,
        directory: actualPath,
        approvedNewDirectoryCreation: true,
        agent: agentType,
        model: modelMode && modelMode !== 'default' ? modelMode : undefined,
        mode: displayCapabilitiesWithDraftMode.modes?.current || undefined,
      });

      if ('sessionId' in result && result.sessionId) {
        const modelConfigOption = getConfigOptionByCategory(displayCapabilities, 'model');
        // Clear draft state on successful session creation
        clearNewSessionDraft();

        await sync.refreshSessions();

        // Set permission mode and model mode on the session
        storage.getState().updateSessionPermissionMode(result.sessionId, permissionMode);
        if (displayCapabilitiesWithDraftMode.modes?.current) {
          storage
            .getState()
            .updateSessionDesiredAgentMode(
              result.sessionId,
              displayCapabilitiesWithDraftMode.modes.current
            );
        }
        if (modelMode && modelMode !== 'default') {
          if (modelConfigOption) {
            storage
              .getState()
              .updateSessionDesiredConfigOption(result.sessionId, modelConfigOption.id, modelMode);
          } else {
            storage.getState().updateSessionModelMode(result.sessionId, modelMode);
          }
        }

        // Upload pending attachments now that we have a sessionId
        const attachmentRefs: AttachmentRef[] = [];
        for (const att of pendingAttachments) {
          try {
            if (att.pastedImage) {
              const uploaded = await uploadClipboardImage(att.pastedImage, result.sessionId);
              attachmentRefs.push(uploaded.attachmentRef);
            } else if (att.asset) {
              const uploaded = await uploadAttachment(att.asset, result.sessionId);
              attachmentRefs.push(uploaded.attachmentRef);
            }
          } catch (err) {
            logger.error('Failed to upload attachment during session creation', toError(err));
          }
        }

        // Send initial message if provided (or if there are attachments).
        // skipPresenceCheck: daemon was just spawned, keepAlive hasn't arrived yet.
        if (sessionPrompt.trim() || attachmentRefs.length > 0) {
          await sync.sendMessage(result.sessionId, sessionPrompt, undefined, {
            skipPresenceCheck: true,
            ...(attachmentRefs.length > 0 && { attachments: attachmentRefs }),
          });
        }

        router.replace(`/session/${result.sessionId}`, {
          dangerouslySingular() {
            return 'session';
          },
        });
      } else {
        throw new Error('Session spawning failed - no session ID returned.');
      }
    } catch (error) {
      logger.error('Failed to start session', toError(error));
      let errorMessage = t('newSession.failedToStart');
      const errMsg = safeStringify(error);
      if (errMsg.includes('timeout')) {
        errorMessage = t('newSession.sessionTimeout');
      } else if (errMsg.includes('Socket not connected')) {
        errorMessage = t('newSession.notConnectedToServer');
      }
      Modal.alert(t('common.error'), errorMessage);
      setIsCreating(false);
    }
  }, [
    selectedMachineId,
    selectedPath,
    sessionPrompt,
    sessionType,
    experimentsEnabled,
    agentType,
    permissionMode,
    modelMode,
    recentMachinePaths,
    router,
  ]);

  const screenWidth = useWindowDimensions().width;

  // Machine online status for AgentInput (DRY - reused in info box too)
  const connectionStatus = React.useMemo(() => {
    if (!selectedMachine) return undefined;
    const isOnline = isMachineOnline(selectedMachine);

    // Include CLI status only when in wizard AND detection completed
    const includeCLI = selectedMachineId && cliAvailability.timestamp > 0;

    return {
      text: isOnline ? 'online' : 'offline',
      color: isOnline ? theme.colors.success : theme.colors.textDestructive,
      dotColor: isOnline ? theme.colors.success : theme.colors.textDestructive,
      isPulsing: isOnline,
      cliStatus: includeCLI
        ? {
            'claude-native': cliAvailability.claudeNative,
            claude: cliAvailability.claude,
            codex: cliAvailability.codex,
            ...(experimentsEnabled && {
              gemini: cliAvailability.gemini,
              opencode: cliAvailability.opencode,
              cursor: cliAvailability.cursor,
            }),
          }
        : undefined,
    };
  }, [selectedMachine, selectedMachineId, cliAvailability, experimentsEnabled, theme]);

  // Persist the current wizard state so it survives remounts and screen navigation
  // Uses debouncing to avoid excessive writes
  const draftSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = setTimeout(() => {
      saveNewSessionDraft({
        input: sessionPrompt,
        selectedMachineId,
        selectedPath,
        agentType,
        permissionMode,
        sessionType,
        updatedAt: Date.now(),
      });
    }, 250);
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
      }
    };
  }, [sessionPrompt, selectedMachineId, selectedPath, agentType, permissionMode, sessionType]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={
        Platform.OS === 'ios' ? Constants.statusBarHeight + useHeaderHeight() : 0
      }
      style={styles.container}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Session type selector only if experiments enabled */}
        {experimentsEnabled && (
          <View style={{ paddingHorizontal: screenWidth > 700 ? 16 : 8, marginBottom: 16 }}>
            <View style={{ maxWidth: layout.maxWidth, width: '100%', alignSelf: 'center' }}>
              <SessionTypeSelector value={sessionType} onChange={setSessionType} />
            </View>
          </View>
        )}

        {/* AgentInput with inline chips - sticky at bottom */}
        <View
          style={{
            paddingHorizontal: screenWidth > 700 ? 16 : 8,
            paddingBottom: Math.max(16, safeArea.bottom),
          }}
        >
          <View style={{ maxWidth: layout.maxWidth, width: '100%', alignSelf: 'center' }}>
            {shouldShowCapabilityDiscoveryNotice && (
              <ChatFooter notice={t('newSession.capabilityDiscoveryNotice')} />
            )}
            <AgentInput
              value={sessionPrompt}
              onChangeText={setSessionPrompt}
              onSend={handleCreateSession}
              isSendDisabled={!canCreate || isUploading}
              isSending={isCreating}
              placeholder={t('newSession.inputPlaceholder')}
              onPickImages={handlePickImages}
              pendingAttachments={pendingAttachments}
              onRemoveAttachment={handleRemoveAttachment}
              autocompletePrefixes={[]}
              autocompleteSuggestions={async () => []}
              agentType={agentType}
              availableAgentTypes={visibleAgentTypes}
              onAgentChange={setAgentType}
              permissionMode={permissionMode}
              onPermissionModeChange={handlePermissionModeChange}
              modelMode={modelMode}
              onModelModeChange={setModelMode}
              capabilities={displayCapabilitiesWithDraftMode}
              onAgentModeChange={setDraftAgentMode}
              connectionStatus={connectionStatus}
              machineName={
                selectedMachine?.metadata?.displayName || selectedMachine?.metadata?.host
              }
              onMachineClick={handleMachineClick}
              currentPath={selectedPath}
              onPathClick={handlePathClick}
            />
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export default React.memo(NewSessionWizard);
