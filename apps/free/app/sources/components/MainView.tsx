import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { View, ActivityIndicator, Text, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { EmptySessionsTablet } from './EmptySessionsTablet';
import { FABWide } from './FABWide';
import { hapticsLight } from './haptics';
import { Header } from './navigation/Header';
import { HeaderLogo } from './HeaderLogo';
import { SessionsList } from './SessionsList';
import { SessionsListWrapper } from './SessionsListWrapper';
import { SettingsViewWrapper } from './SettingsViewWrapper';
import { StatusDot } from './StatusDot';
import { TabBar, TabType } from './TabBar';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { Typography } from '@/constants/Typography';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { voiceHooks } from '@/realtime/hooks/voiceHooks';
import { startRealtimeSession, stopRealtimeSession } from '@/realtime/RealtimeSession';
import { isUsingCustomServer } from '@/sync/serverConfig';
import { useMachineStatus } from '@/hooks/useMachineStatus';
import { useLocalSetting, useSocketStatus, useRealtimeStatus, useRealtimeMode } from '@/sync/storage';
import { t } from '@/text';
import { useIsTablet } from '@/utils/responsive';
import { useSocketConnectionStatus } from '@/utils/socketConnectionStatus';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/components/MainView');

interface MainViewProps {
  variant: 'phone' | 'sidebar';
}

const styles = StyleSheet.create(theme => ({
  container: {
    flex: 1,
  },
  phoneContainer: {
    flex: 1,
  },
  sidebarContentContainer: {
    flex: 1,
    flexBasis: 0,
    flexGrow: 1,
  },
  loadingContainerWrapper: {
    flex: 1,
    flexBasis: 0,
    flexGrow: 1,
    backgroundColor: theme.colors.groupped.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 32,
  },
  tabletLoadingContainer: {
    flex: 1,
    flexBasis: 0,
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStateContainer: {
    flex: 1,
    flexBasis: 0,
    flexGrow: 1,
    flexDirection: 'column',
    backgroundColor: theme.colors.groupped.background,
  },
  emptyStateContentContainer: {
    flex: 1,
    flexBasis: 0,
    flexGrow: 1,
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  titleContent: {
    alignItems: 'center',
    gap: 6,
  },
  titleText: {
    fontSize: 17,
    color: theme.colors.header.tint,
    fontWeight: '600',
    ...Typography.default('semiBold'),
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  statusChip: {
    minHeight: 24,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
  },
  statusChipPressed: {
    backgroundColor: theme.colors.surfacePressedOverlay,
  },
  statusChipText: {
    fontSize: 11,
    lineHeight: 14,
    ...Typography.default('semiBold'),
  },
  statusDotInline: {
    marginRight: 6,
  },
  statusGhostText: {
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  headerButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

// Tab header configuration
const TAB_TITLES = {
  sessions: 'tabs.sessions',
  settings: 'tabs.settings',
} as const;

// Active tabs
type ActiveTabType = 'sessions' | 'settings';

// Header title component with connection status + machine count
const HeaderTitle = React.memo(({ activeTab }: { activeTab: ActiveTabType }) => {
  const router = useRouter();
  const { theme } = useUnistyles();
  const socketStatus = useSocketStatus();
  const { machineCount, onlineCount } = useMachineStatus();
  const connectionStatus = useSocketConnectionStatus();
  const focusAudioEnabled = useLocalSetting('focusAudioEnabled');

  const machineStatusText = t('status.machinesOnline', { count: onlineCount });
  const machineStatusColor =
    onlineCount > 0 ? theme.colors.status.connected : theme.colors.status.disconnected;
  const backgroundPlaybackText = focusAudioEnabled
    ? t('focusAudio.homeBackgroundPlaybackCompactEnabled')
    : null;

  const handleOpenServer = React.useCallback(() => {
    router.push('/server');
  }, [router]);

  const handleOpenSettings = React.useCallback(() => {
    router.push('/settings');
  }, [router]);

  const handleOpenFocusAudio = React.useCallback(() => {
    router.push('/settings/focus-audio');
  }, [router]);

  return (
    <View style={styles.titleContainer}>
      <View style={styles.titleContent}>
        <Text style={styles.titleText}>{t(TAB_TITLES[activeTab])}</Text>
      {!!connectionStatus.text && (
        <View style={styles.statusRow}>
          <Pressable
            onPress={handleOpenServer}
            hitSlop={8}
            style={({ pressed }) => [styles.statusChip, pressed ? styles.statusChipPressed : null]}
          >
            <StatusDot
              color={connectionStatus.color}
              isPulsing={connectionStatus.isPulsing}
              size={6}
              style={styles.statusDotInline}
            />
            <Text style={[styles.statusChipText, { color: connectionStatus.color }]}>
              {connectionStatus.text}
            </Text>
          </Pressable>
          {socketStatus.status === 'connected' && machineCount > 0 && (
            <Pressable
              onPress={handleOpenSettings}
              hitSlop={8}
              style={({ pressed }) => [styles.statusChip, pressed ? styles.statusChipPressed : null]}
            >
              <Text style={[styles.statusChipText, { color: machineStatusColor }]}>
                {machineStatusText}
              </Text>
            </Pressable>
          )}
          {activeTab === 'sessions' && backgroundPlaybackText && (
            <Pressable
              onPress={handleOpenFocusAudio}
              hitSlop={8}
              style={({ pressed }) => [styles.statusChip, pressed ? styles.statusChipPressed : null]}
            >
              <Text style={[styles.statusGhostText, { color: theme.colors.status.connected }]}>
                {backgroundPlaybackText}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      </View>
    </View>
  );
});

// Header right button - varies by tab
const HeaderRight = React.memo(({ activeTab }: { activeTab: ActiveTabType }) => {
  const router = useRouter();
  const { theme } = useUnistyles();
  const isCustomServer = isUsingCustomServer();

  if (activeTab === 'sessions') {
    return (
      <Pressable onPress={() => router.push('/new')} hitSlop={15} style={styles.headerButton}>
        <Ionicons name="add-outline" size={28} color={theme.colors.header.tint} />
      </Pressable>
    );
  }

  if (activeTab === 'settings') {
    if (!isCustomServer) {
      // Empty view to maintain header centering
      return <View style={styles.headerButton} />;
    }
    return (
      <Pressable onPress={() => router.push('/server')} hitSlop={15} style={styles.headerButton}>
        <Ionicons name="server-outline" size={24} color={theme.colors.header.tint} />
      </Pressable>
    );
  }

  return null;
});

export const MainView = React.memo(({ variant }: MainViewProps) => {
  const { theme } = useUnistyles();
  const sessionListViewData = useVisibleSessionListViewData();
  const isTablet = useIsTablet();
  const router = useRouter();
  const realtimeStatus = useRealtimeStatus();

  // Tab state management
  // NOTE: Zen tab removed - the feature never got to a useful state
  const [activeTab, setActiveTab] = React.useState<TabType>('sessions');

  const handleNewSession = React.useCallback(() => {
    router.push('/new');
  }, [router]);

  const handleTabPress = React.useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  // Regular phone mode with tabs - define this before any conditional returns
  const renderTabContent = React.useCallback(() => {
    switch (activeTab) {
      case 'settings':
        return <SettingsViewWrapper />;
      case 'sessions':
      default:
        return <SessionsListWrapper />;
    }
  }, [activeTab]);

  // Sidebar variant
  if (variant === 'sidebar') {
    // Loading state
    if (sessionListViewData === null) {
      return (
        <View style={styles.sidebarContentContainer}>
          <View style={styles.tabletLoadingContainer}>
            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
          </View>
        </View>
      );
    }

    // Empty state
    if (sessionListViewData.length === 0) {
      return (
        <View style={styles.sidebarContentContainer}>
          <View style={styles.emptyStateContainer}>
            <EmptySessionsTablet />
          </View>
        </View>
      );
    }

    // Sessions list
    return (
      <View style={styles.sidebarContentContainer}>
        <SessionsList />
      </View>
    );
  }

  // Phone variant
  // Tablet in phone mode - special case (when showing index view on tablets, show empty view)
  if (isTablet) {
    return <View style={styles.emptyStateContentContainer} />;
  }

  // Regular phone mode with tabs
  return (
    <>
      <View style={styles.phoneContainer}>
        <View style={{ backgroundColor: theme.colors.groupped.background }}>
          <Header
            title={<HeaderTitle activeTab={activeTab as ActiveTabType} />}
            headerRight={() => <HeaderRight activeTab={activeTab as ActiveTabType} />}
            headerLeft={() => <HeaderLogo />}
            headerShadowVisible={false}
            headerTransparent={true}
          />
          {realtimeStatus !== 'disconnected' && <VoiceAssistantStatusBar variant="full" />}
        </View>
        {renderTabContent()}
        {activeTab === 'sessions' && <VoiceFAB />}
      </View>
      <TabBar activeTab={activeTab} onTabPress={handleTabPress} />
    </>
  );
});

// Floating voice assistant button — self-contained with its own handler and icon logic
export function VoiceFAB() {
  const { theme } = useUnistyles();
  const realtimeStatus = useRealtimeStatus();
  const realtimeMode = useRealtimeMode();
  const isActive = realtimeStatus === 'connected' || realtimeStatus === 'connecting' || realtimeStatus === 'reconnecting';

  const handlePress = React.useCallback(async () => {
    if (realtimeStatus === 'connecting' || realtimeStatus === 'reconnecting') return;
    hapticsLight();
    if (realtimeStatus === 'disconnected' || realtimeStatus === 'error') {
      try {
        const initialPrompt = voiceHooks.onVoiceStarted('');
        await startRealtimeSession('', initialPrompt);
      } catch (error) {
        logger.error('Failed to start voice session:', toError(error));
      }
    } else if (realtimeStatus === 'connected') {
      await stopRealtimeSession();
      voiceHooks.onVoiceStopped();
    }
  }, [realtimeStatus]);

  // Icon reflects the current interaction state:
  //   disconnected/error  → mic-outline   (not active)
  //   connecting          → radio-outline  (activating)
  //   connected + idle    → radio          (active, listening)
  //   connected + speaking→ volume-high   (assistant is talking)
  const iconName: React.ComponentProps<typeof Ionicons>['name'] =
    !isActive
      ? 'mic-outline'
      : realtimeStatus === 'connected' && realtimeMode === 'speaking'
        ? 'volume-high'
        : realtimeStatus === 'connected'
          ? 'radio'
          : 'radio-outline';

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => ({
        position: 'absolute',
        bottom: 16,
        right: 20,
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: isActive
          ? theme.colors.button.primary.background
          : theme.colors.fab.background,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 4,
        shadowOpacity: theme.colors.shadow.opacity,
        elevation: 5,
        opacity: pressed ? 0.8 : 1,
      })}
      hitSlop={8}
    >
      <Ionicons
        name={iconName}
        size={22}
        color={isActive ? theme.colors.button.primary.tint : theme.colors.fab.icon}
      />
    </Pressable>
  );
}
