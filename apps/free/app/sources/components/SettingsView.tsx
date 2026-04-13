import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { View, ScrollView, Pressable, Platform, Linking } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { getFocusAudioSound } from '@/audio/focusAudioCatalog';
import { Avatar } from '@/components/Avatar';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { layout } from '@/components/layout';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useConnectTerminal } from '@/hooks/useConnectTerminal';
import { useFreeAction } from '@/hooks/useFreeAction';
import { useMultiClick } from '@/hooks/useMultiClick';
import { Modal } from '@/modal';
import { getGitHubOAuthParams, disconnectGitHub } from '@/sync/apiGithub';
import { disconnectService } from '@/sync/apiServices';
import { getDisplayName, getAvatarUrl, getBio } from '@/sync/profile';
import { isUsingCustomServer } from '@/sync/serverConfig';
import { sync } from '@/sync/sync';
import { useLocalSetting, useLocalSettingMutable, useSetting, useEntitlement } from '@/sync/storage';
import { useAllMachines } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { useProfile } from '@/sync/storage';
import { t } from '@/text';

export const SettingsView = React.memo(function SettingsView() {
  const { theme } = useUnistyles();
  const router = useRouter();
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const auth = useAuth();
  const [devModeEnabled, setDevModeEnabled] = useLocalSettingMutable('devModeEnabled');
  const [, setShowDebugIds] = useLocalSettingMutable('showDebugIds');
  const [, setDebugIdsInitializedForDevMode] = useLocalSettingMutable(
    'debugIdsInitializedForDevMode'
  );
  const focusAudioEnabled = useLocalSetting('focusAudioEnabled');
  const focusAudioSound = useLocalSetting('focusAudioSound');
  const isPro = useEntitlement('pro');
  const experiments = useSetting('experiments');
  const isCustomServer = isUsingCustomServer();
  const allMachines = useAllMachines();
  const profile = useProfile();
  const displayName = getDisplayName(profile);
  const avatarUrl = getAvatarUrl(profile);
  const bio = getBio(profile);

  const { connectTerminal, connectWithUrl, isLoading } = useConnectTerminal();
  const focusAudioSoundLabel = getFocusAudioSound(focusAudioSound).label;

  const handleGitHub = async () => {
    const url = 'https://github.com/saaskit-dev/agentbridge';
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    }
  };

  const handleReportIssue = async () => {
    const url = 'https://github.com/saaskit-dev/agentbridge/issues';
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    }
  };

  const handleSubscribe = async () => {
    router.push('/support');
  };

  // Use the multi-click hook for version clicks
  const handleVersionClick = useMultiClick(
    () => {
      // Toggle dev mode
      const newDevMode = !devModeEnabled;
      setDevModeEnabled(newDevMode);
      if (newDevMode) {
        setShowDebugIds(true);
        setDebugIdsInitializedForDevMode(true);
      } else {
        setShowDebugIds(false);
      }
      Modal.alert(
        t('modals.developerMode'),
        newDevMode ? t('modals.developerModeEnabled') : t('modals.developerModeDisabled')
      );
    },
    {
      requiredClicks: 10,
      resetTimeout: 2000,
    }
  );

  // Connection status
  const isGitHubConnected = !!profile.github;
  const isAnthropicConnected = profile.connectedServices?.includes('anthropic') || false;

  // GitHub connection
  const [connectingGitHub, connectGitHub] = useFreeAction(async () => {
    const params = await getGitHubOAuthParams(auth.credentials!);
    await Linking.openURL(params.url);
  });

  // GitHub disconnection
  const [disconnectingGitHub, handleDisconnectGitHub] = useFreeAction(async () => {
    const confirmed = await Modal.confirm(
      t('modals.disconnectGithub'),
      t('modals.disconnectGithubConfirm'),
      { confirmText: t('modals.disconnect'), destructive: true }
    );
    if (confirmed) {
      await disconnectGitHub(auth.credentials!);
    }
  });

  // Anthropic connection
  const [connectingAnthropic, connectAnthropic] = useFreeAction(async () => {
    router.push('/settings/connect/claude');
  });

  // Anthropic disconnection
  const [disconnectingAnthropic, handleDisconnectAnthropic] = useFreeAction(async () => {
    const confirmed = await Modal.confirm(
      t('modals.disconnectService', { service: 'Claude' }),
      t('modals.disconnectServiceConfirm', { service: 'Claude' }),
      { confirmText: t('modals.disconnect'), destructive: true }
    );
    if (confirmed) {
      await disconnectService(auth.credentials!, 'anthropic');
    }
  });

  return (
    <ItemList style={{ paddingTop: 0 }}>
      {/* App Info Header */}
      <View style={{ maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}>
        <View
          style={{
            alignItems: 'center',
            paddingVertical: 24,
            backgroundColor: theme.colors.surface,
            marginTop: 16,
            borderRadius: 12,
            marginHorizontal: 16,
          }}
        >
          {profile.firstName ? (
            // Profile view: Avatar + name + version
            <>
              <View style={{ marginBottom: 12 }}>
                <Avatar
                  id={profile.id}
                  size={90}
                  imageUrl={avatarUrl}
                  thumbhash={profile.avatar?.thumbhash}
                />
              </View>
              <Text
                style={{
                  fontSize: 20,
                  fontWeight: '600',
                  color: theme.colors.text,
                  marginBottom: bio ? 4 : 8,
                }}
              >
                {displayName}
              </Text>
              {bio && (
                <Text
                  style={{
                    fontSize: 14,
                    color: theme.colors.textSecondary,
                    textAlign: 'center',
                    marginBottom: 8,
                    paddingHorizontal: 16,
                  }}
                >
                  {bio}
                </Text>
              )}
            </>
          ) : (
            // Logo view: Original logo + version
            <>
              <Text
                style={{
                  fontSize: 36,
                  fontWeight: 'bold',
                  color: theme.dark ? '#ffffff' : '#000000',
                  letterSpacing: 6,
                  marginBottom: 12,
                }}
              >
                FREE
              </Text>
            </>
          )}
        </View>
      </View>

      <ItemGroup>
        {Platform.OS !== 'web' && (
          <Item
            title={t('settings.scanQrCodeToAuthenticate')}
            icon={<Ionicons name="qr-code-outline" size={29} color="#007AFF" />}
            onPress={connectTerminal}
            loading={isLoading}
            showChevron={false}
          />
        )}
        <Item
          title={t('connect.enterUrlManually')}
          icon={<Ionicons name="link-outline" size={29} color="#007AFF" />}
          onPress={async () => {
            const url = await Modal.prompt(
              t('modals.authenticateTerminal'),
              t('modals.pasteUrlFromTerminal'),
              {
                placeholder: 'free://terminal?...',
                confirmText: t('common.authenticate'),
              }
            );
            if (url?.trim()) {
              connectWithUrl(url.trim());
            }
          }}
          showChevron={false}
        />
      </ItemGroup>

      {/* Support Us - only visible in local development */}
      {__DEV__ && (
        <ItemGroup>
          <Item
            title={t('settings.supportUs')}
            subtitle={isPro ? t('settings.supportUsSubtitlePro') : t('settings.supportUsSubtitle')}
            icon={<Ionicons name="rocket-outline" size={29} color="#667eea" />}
            showChevron={!isPro}
            onPress={isPro ? undefined : handleSubscribe}
            detail={isPro ? undefined : '→'}
          />
        </ItemGroup>
      )}

      {/* Social */}
      {/* <ItemGroup title={t('settings.social')}>
                <Item
                    title={t('navigation.friends')}
                    subtitle={t('friends.manageFriends')}
                    icon={<Ionicons name="people-outline" size={29} color="#007AFF" />}
                    onPress={() => router.push('/friends')}
                />
            </ItemGroup> */}

      {/* Machines (sorted: online first, then last seen desc) */}
      {allMachines.length > 0 && (
        <ItemGroup title={t('settings.machines')}>
          {[...allMachines].map(machine => {
            const isOnline = isMachineOnline(machine);
            const host = machine.metadata?.host || 'Unknown';
            const displayName = machine.metadata?.displayName;
            const platform = machine.metadata?.platform || '';

            // Use displayName if available, otherwise use host
            const title = displayName || host;

            // Build subtitle: show hostname if different from title, plus platform and status
            let subtitle = '';
            if (displayName && displayName !== host) {
              subtitle = host;
            }
            if (platform) {
              subtitle = subtitle ? `${subtitle} • ${platform}` : platform;
            }
            subtitle = subtitle
              ? `${subtitle} • ${isOnline ? t('status.online') : t('status.offline')}`
              : isOnline
                ? t('status.online')
                : t('status.offline');

            return (
              <Item
                key={machine.id}
                title={title}
                subtitle={subtitle}
                icon={
                  <Ionicons
                    name="desktop-outline"
                    size={29}
                    color={
                      isOnline ? theme.colors.status.connected : theme.colors.status.disconnected
                    }
                  />
                }
                onPress={() => router.push(`/machine/${machine.id}`)}
              />
            );
          })}
        </ItemGroup>
      )}

      {/* Features */}
      <ItemGroup title={t('settings.features')}>
        <Item
          title={t('settings.account')}
          subtitle={t('settings.accountSubtitle')}
          icon={<Ionicons name="person-circle-outline" size={29} color="#007AFF" />}
          onPress={() => router.push('/settings/account')}
        />
        <Item
          title={t('settings.appearance')}
          subtitle={t('settings.appearanceSubtitle')}
          icon={<Ionicons name="color-palette-outline" size={29} color="#5856D6" />}
          onPress={() => router.push('/settings/appearance')}
        />
        <Item
          title={t('settings.permissions')}
          subtitle={t('settings.permissionsSubtitle')}
          icon={<Ionicons name="shield-checkmark-outline" size={29} color="#34C759" />}
          onPress={() => router.push('/settings/permissions')}
        />
        <Item
          title={t('settings.featuresTitle')}
          subtitle={t('settings.featuresSubtitle')}
          icon={<Ionicons name="flask-outline" size={29} color="#FF9500" />}
          onPress={() => router.push('/settings/features')}
        />
        <Item
          title="Keyboard Shortcuts"
          subtitle="View desktop and web keyboard controls"
          icon={<Ionicons name="keypad-outline" size={29} color="#0A84FF" />}
          onPress={() => router.push('/settings/keyboard-shortcuts' as any)}
        />
        <Item
          title={t('settings.focusAudio')}
          subtitle={
            focusAudioEnabled
              ? t('focusAudio.settingsSubtitleEnabled', { sound: focusAudioSoundLabel })
              : t('focusAudio.settingsSubtitleDisabled')
          }
          icon={<Ionicons name="musical-notes-outline" size={29} color="#007AFF" />}
          onPress={() => router.push('/settings/focus-audio')}
        />
        <Item
          title={t('settings.usage')}
          subtitle={t('settings.usageSubtitle')}
          icon={<Ionicons name="analytics-outline" size={29} color="#007AFF" />}
          onPress={() => router.push('/settings/usage')}
        />
      </ItemGroup>

      {/* Developer */}
      {devModeEnabled && (
        <ItemGroup title={t('settings.developer')}>
          <Item
            title={t('settings.developerTools')}
            icon={<Ionicons name="construct-outline" size={29} color="#5856D6" />}
            onPress={() => router.push('/dev')}
          />
        </ItemGroup>
      )}

      {/* About */}
      <ItemGroup title={t('settings.about')} footer={t('settings.aboutFooter')}>
        {/* Hidden - TODO: update URL before enabling
        <Item
          title={t('settings.whatsNew')}
          subtitle={t('settings.whatsNewSubtitle')}
          icon={<Ionicons name="sparkles-outline" size={29} color="#FF9500" />}
          onPress={() => {
            trackWhatsNewClicked();
            router.push('/changelog');
          }}
        />
        */}
        <Item
          title={t('settings.github')}
          icon={<Ionicons name="logo-github" size={29} color={theme.colors.text} />}
          detail="saaskit-dev/agentbridge"
          onPress={handleGitHub}
        />
        <Item
          title={t('settings.reportIssue')}
          icon={<Ionicons name="bug-outline" size={29} color="#FF3B30" />}
          onPress={handleReportIssue}
        />
        {/* Hidden - TODO: update URL to project's privacy policy
        <Item
          title={t('settings.privacyPolicy')}
          icon={<Ionicons name="shield-checkmark-outline" size={29} color="#007AFF" />}
          onPress={async () => {
            const url = 'https://free-server.saaskit.app/privacy/';
            const supported = await Linking.canOpenURL(url);
            if (supported) {
              await Linking.openURL(url);
            }
          }}
        />
        */}
        {/* Hidden - TODO: update URL to project's terms of service
        <Item
          title={t('settings.termsOfService')}
          icon={<Ionicons name="document-text-outline" size={29} color="#007AFF" />}
          onPress={async () => {
            const url = 'https://github.com/saaskit-dev/agentbridge/blob/main/TERMS.md';
            const supported = await Linking.canOpenURL(url);
            if (supported) {
              await Linking.openURL(url);
            }
          }}
        />
        */}
        {Platform.OS === 'ios' && (
          <Item
            title={t('settings.eula')}
            icon={<Ionicons name="document-text-outline" size={29} color="#007AFF" />}
            onPress={async () => {
              const url = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
              const supported = await Linking.canOpenURL(url);
              if (supported) {
                await Linking.openURL(url);
              }
            }}
          />
        )}
        <Item
          title={t('common.version')}
          detail={appVersion}
          icon={
            <Ionicons
              name="information-circle-outline"
              size={29}
              color={theme.colors.textSecondary}
            />
          }
          onPress={handleVersionClick}
          showChevron={false}
        />
      </ItemGroup>
    </ItemList>
  );
});
