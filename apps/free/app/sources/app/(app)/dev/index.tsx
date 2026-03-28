import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { setLastViewedVersion, getLatestVersion } from '@/changelog';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Switch } from '@/components/Switch';
import { Modal } from '@/modal';
import { getServerUrl, setServerUrl, validateServerUrl } from '@/sync/serverConfig';
import { useLocalSettingMutable, useSocketStatus } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { Logger } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('app/dev/index');

export default function DevScreen() {
  const router = useRouter();
  const [showDebugIds, setShowDebugIds] = useLocalSettingMutable('showDebugIds');
  const buildTime = Updates.createdAt;
  const runtimeVersion = Updates.runtimeVersion;
  const shortRuntime = runtimeVersion
    ? runtimeVersion.length > 10
      ? runtimeVersion.slice(0, 7)
      : runtimeVersion
    : null;
  const packageSource = Updates.isEmbeddedLaunch === false ? 'OTA' : 'Built-in';
  const buildTimeDetail = buildTime
    ? buildTime.toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : t('dev.notAvailable');
  const socketStatus = useSocketStatus();
  const anonymousId = sync.encryption?.anonId ?? 'N/A';
  const { theme } = useUnistyles();

  const handleEditServerUrl = async () => {
    const currentUrl = getServerUrl();

    const newUrl = await Modal.prompt(t('dev.editApiEndpoint'), t('dev.enterServerUrl'), {
      defaultValue: currentUrl,
      confirmText: t('common.save'),
    });

    if (newUrl && newUrl !== currentUrl) {
      const validation = validateServerUrl(newUrl);
      if (validation.valid) {
        setServerUrl(newUrl);
        Modal.alert(t('common.success'), t('dev.serverUrlUpdated'));
      } else {
        Modal.alert(t('dev.invalidUrl'), validation.error || t('dev.invalidUrlDefault'));
      }
    }
  };

  const handleClearCache = async () => {
    const confirmed = await Modal.confirm(
      t('dev.clearCacheConfirmTitle'),
      t('dev.clearCacheConfirmMessage'),
      { confirmText: t('dev.clear'), destructive: true }
    );
    if (confirmed) {
      try {
        await sync.clearMessageCache();
        Modal.alert(t('common.success'), t('dev.cacheCleared'));
      } catch (e) {
        Modal.alert(t('common.error'), t('dev.failedToClearCache', { error: String(e) }));
      }
    }
  };

  // Helper function to format time ago
  const formatTimeAgo = (timestamp: number | null): string => {
    if (!timestamp) return '';

    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 10) return t('dev.justNow');
    if (seconds < 60) return t('dev.secondsAgo', { seconds });
    if (minutes < 60) return t('dev.minutesAgo', { minutes });
    if (hours < 24) return t('dev.hoursAgo', { hours });
    if (days < 7) return t('dev.daysAgo', { days });

    return new Date(timestamp).toLocaleDateString();
  };

  // Helper function to get socket status subtitle
  const getSocketStatusSubtitle = (): string => {
    const { status, lastConnectedAt, lastDisconnectedAt } = socketStatus;

    if (status === 'connected' && lastConnectedAt) {
      return t('dev.connectedAgo', { time: formatTimeAgo(lastConnectedAt) });
    } else if ((status === 'disconnected' || status === 'error') && lastDisconnectedAt) {
      return t('dev.lastConnectedAgo', { time: formatTimeAgo(lastDisconnectedAt) });
    } else if (status === 'connecting') {
      return t('dev.connectingToServer');
    }

    return t('dev.noConnectionInfo');
  };

  // Socket status indicator component
  const SocketStatusIndicator = () => {
    switch (socketStatus.status) {
      case 'connected':
        return <Ionicons name="checkmark-circle" size={22} color="#34C759" />;
      case 'connecting':
        return <ActivityIndicator size="small" color={theme.colors.textSecondary} />;
      case 'error':
        return <Ionicons name="close-circle" size={22} color="#FF3B30" />;
      case 'disconnected':
        return <Ionicons name="close-circle" size={22} color="#FF9500" />;
      default:
        return <Ionicons name="help-circle" size={22} color="#8E8E93" />;
    }
  };

  return (
    <ItemList>
      {/* App Information */}
      <ItemGroup title={t('dev.appInformation')}>
        <Item title={t('dev.version')} detail={Constants.expoConfig?.version || '1.0.0'} />
        <Item title={t('dev.buildNumber')} detail={Application.nativeBuildVersion || 'N/A'} />
        <Item title={t('dev.runtimeVersion')} detail={shortRuntime || t('dev.notAvailable')} />
        <Item title={t('dev.packageSource')} detail={packageSource} />
        <Item title={t('dev.buildTime')} detail={buildTimeDetail} />
        <Item title={t('dev.sdkVersion')} detail={Constants.expoConfig?.sdkVersion || 'Unknown'} />
        <Item
          title={t('dev.platform')}
          detail={
            Platform.OS === 'ios'
              ? `iOS ${Constants.systemVersion || ''}`.trim()
              : Platform.OS === 'android'
                ? `Android ${Constants.systemVersion || ''}`.trim()
                : 'Web'
          }
        />
        <Item title={t('dev.anonymousId')} detail={anonymousId} />
      </ItemGroup>

      {/* Debug Options */}
      <ItemGroup title={t('dev.debugOptions')}>
        <Item
          title={t('dev.showDebugIds')}
          subtitle={t('dev.showDebugIdsSubtitle')}
          rightElement={<Switch value={showDebugIds} onValueChange={setShowDebugIds} />}
          showChevron={false}
        />
      </ItemGroup>

      {/* Component Demos */}
      <ItemGroup title={t('dev.componentDemos')}>
        <Item
          title={t('dev.deviceInfo')}
          subtitle={t('dev.deviceInfoSubtitle')}
          icon={<Ionicons name="phone-portrait-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/device-info')}
        />
        <Item
          title={t('dev.listComponents')}
          subtitle={t('dev.listComponentsSubtitle')}
          icon={<Ionicons name="list-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/list-demo')}
        />
        <Item
          title={t('dev.typography')}
          subtitle={t('dev.typographySubtitle')}
          icon={<Ionicons name="text-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/typography')}
        />
        <Item
          title={t('dev.colors')}
          subtitle={t('dev.colorsSubtitle')}
          icon={<Ionicons name="color-palette-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/colors')}
        />
        <Item
          title={t('dev.messageDemos')}
          subtitle={t('dev.messageDemosSubtitle')}
          icon={<Ionicons name="chatbubbles-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/messages-demo')}
        />
        <Item
          title={t('dev.invertedListTest')}
          subtitle={t('dev.invertedListTestSubtitle')}
          icon={<Ionicons name="swap-vertical-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/inverted-list')}
        />
        <Item
          title={t('dev.toolViews')}
          subtitle={t('dev.toolViewsSubtitle')}
          icon={<Ionicons name="construct-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/tools2')}
        />
        <Item
          title={t('dev.shimmerView')}
          subtitle={t('dev.shimmerViewSubtitle')}
          icon={<Ionicons name="sparkles-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/shimmer-demo')}
        />
        <Item
          title={t('dev.multiTextInput')}
          subtitle={t('dev.multiTextInputSubtitle')}
          icon={<Ionicons name="create-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/multi-text-input')}
        />
        <Item
          title={t('dev.inputStyles')}
          subtitle={t('dev.inputStylesSubtitle')}
          icon={<Ionicons name="color-palette-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/input-styles')}
        />
        <Item
          title={t('dev.modalSystem')}
          subtitle={t('dev.modalSystemSubtitle')}
          icon={<Ionicons name="albums-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/modal-demo')}
        />
        <Item
          title={t('dev.unitTests')}
          subtitle={t('dev.unitTestsSubtitle')}
          icon={<Ionicons name="flask-outline" size={28} color="#34C759" />}
          onPress={() => router.push('/dev/tests')}
        />
        <Item
          title={t('dev.unistylesDemo')}
          subtitle={t('dev.unistylesDemoSubtitle')}
          icon={<Ionicons name="brush-outline" size={28} color="#FF6B6B" />}
          onPress={() => router.push('/dev/unistyles-demo')}
        />
        <Item
          title={t('dev.qrCodeTest')}
          subtitle={t('dev.qrCodeTestSubtitle')}
          icon={<Ionicons name="qr-code-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/qr-test')}
        />
      </ItemGroup>

      {/* Test Features */}
      <ItemGroup title={t('dev.testFeatures')} footer={t('dev.testFeaturesFooter')}>
        <Item
          title={t('dev.claudeOAuthTest')}
          subtitle={t('dev.claudeOAuthTestSubtitle')}
          icon={<Ionicons name="key-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/settings/connect/claude')}
        />
        <Item
          title={t('dev.testCrash')}
          subtitle={t('dev.testCrashSubtitle')}
          destructive={true}
          icon={<Ionicons name="warning-outline" size={28} color="#FF3B30" />}
          onPress={async () => {
            const confirmed = await Modal.confirm(
              t('dev.testCrashConfirmTitle'),
              t('dev.testCrashConfirmMessage'),
              { confirmText: t('dev.crash'), destructive: true }
            );
            if (confirmed) {
              throw new Error('Test crash triggered from dev menu');
            }
          }}
        />
        <Item
          title={t('dev.clearCache')}
          subtitle={t('dev.clearCacheSubtitle')}
          icon={<Ionicons name="trash-outline" size={28} color="#FF9500" />}
          onPress={handleClearCache}
        />
        <Item
          title={t('dev.resetChangelog')}
          subtitle={t('dev.resetChangelogSubtitle')}
          icon={<Ionicons name="sparkles-outline" size={28} color="#007AFF" />}
          onPress={() => {
            // Set to latest - 1 so it shows as unread
            // (setting to 0 triggers first-install logic that auto-marks as read)
            const latest = getLatestVersion();
            setLastViewedVersion(Math.max(0, latest - 1));
            Modal.alert(t('dev.done'), t('dev.changelogReset'));
          }}
        />
        <Item
          title={t('dev.resetAppState')}
          subtitle={t('dev.resetAppStateSubtitle')}
          destructive={true}
          icon={<Ionicons name="refresh-outline" size={28} color="#FF3B30" />}
          onPress={async () => {
            const confirmed = await Modal.confirm(
              t('dev.resetApp'),
              t('dev.resetAppConfirmMessage'),
              { confirmText: t('common.reset'), destructive: true }
            );
            if (confirmed) {
              logger.info('App state reset');
            }
          }}
        />
      </ItemGroup>

      {/* System */}
      <ItemGroup title={t('dev.system')}>
        <Item
          title={t('dev.purchases')}
          subtitle={t('dev.purchasesSubtitle')}
          icon={<Ionicons name="card-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/purchases')}
        />
        <Item
          title={t('dev.expoConstants')}
          subtitle={t('dev.expoConstantsSubtitle')}
          icon={<Ionicons name="information-circle-outline" size={28} color="#007AFF" />}
          onPress={() => router.push('/dev/expo-constants')}
        />
      </ItemGroup>

      {/* Network */}
      <ItemGroup title={t('dev.network')}>
        <Item
          title={t('dev.apiEndpoint')}
          detail={getServerUrl()}
          onPress={handleEditServerUrl}
          detailStyle={{ flex: 1, textAlign: 'right', minWidth: '70%' }}
        />
        <Item
          title={t('dev.socketIoStatus')}
          subtitle={getSocketStatusSubtitle()}
          detail={socketStatus.status}
          rightElement={<SocketStatusIndicator />}
          showChevron={false}
        />
      </ItemGroup>
    </ItemList>
  );
}
