import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { View, ScrollView, Pressable, Platform, Linking } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Logger, safeStringify } from '@saaskit-dev/agentbridge/telemetry';
import { useAuth } from '@/auth/AuthContext';
import { getFocusAudioSound } from '@/audio/focusAudioCatalog';
import { Avatar } from '@/components/Avatar';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { layout } from '@/components/layout';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useAppVersion } from '@/hooks/useAppVersion';
import { useConnectTerminal } from '@/hooks/useConnectTerminal';
import { useDesktopCLIStatus } from '@/hooks/useDesktopCLIStatus';
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
import { getTauriErrorMessage, isTauriDesktop, isTauriUpdaterEnabled } from '@/utils/tauri';
import { useProfile } from '@/sync/storage';
import { t } from '@/text';
import { StatusDot } from './StatusDot';

const logger = new Logger('app/components/SettingsView');

const stylesheet = StyleSheet.create(theme => ({
  heroShell: {
    maxWidth: layout.maxWidth,
    alignSelf: 'center',
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 14,
  },
  heroCard: {
    borderRadius: 28,
    padding: 22,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroAvatarWrap: {
    marginRight: 16,
  },
  heroMeta: {
    flex: 1,
  },
  heroEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: theme.colors.textSecondary,
    ...Typography.default('semiBold'),
  },
  heroTitle: {
    marginTop: 4,
    fontSize: 24,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  heroBio: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 18,
  },
  statChip: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.colors.groupped.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
    flexDirection: 'row',
    alignItems: 'center',
  },
  statChipText: {
    fontSize: 12,
    lineHeight: 15,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  statDot: {
    marginRight: 6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionCard: {
    flex: 1,
    borderRadius: 22,
    padding: 18,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
  },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: theme.colors.groupped.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  actionTitle: {
    fontSize: 16,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  actionSubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  actionFooter: {
    marginTop: 14,
    fontSize: 12,
    color: theme.colors.textSecondary,
    ...Typography.default('semiBold'),
  },
  machineSection: {
    borderRadius: 28,
    padding: 20,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
  },
  sectionEyebrow: {
    fontSize: 11,
    lineHeight: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: theme.colors.textSecondary,
    ...Typography.default('semiBold'),
  },
  sectionTitle: {
    marginTop: 4,
    fontSize: 22,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  sectionSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  machinesList: {
    marginTop: 18,
    gap: 12,
  },
  machineCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: theme.colors.groupped.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
  },
  machineCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  machineIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  machineMeta: {
    flex: 1,
  },
  machineTitle: {
    fontSize: 16,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  machineSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  machineStatusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: theme.colors.surface,
  },
  machineStatusText: {
    fontSize: 11,
    lineHeight: 14,
    ...Typography.default('semiBold'),
  },
  machineCardBottom: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  machineMetaChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: theme.colors.surface,
  },
  machineMetaChipText: {
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.textSecondary,
    ...Typography.default('semiBold'),
  },
  machineAction: {
    fontSize: 12,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
}));

export const SettingsView = React.memo(function SettingsView() {
  const { theme } = useUnistyles();
  const styles = stylesheet;
  const router = useRouter();
  const appVersion = useAppVersion();
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
  const isDesktopApp = isTauriDesktop();
  const allMachines = useAllMachines();
  const profile = useProfile();
  const displayName = getDisplayName(profile);
  const avatarUrl = getAvatarUrl(profile);
  const bio = getBio(profile);
  const onlineMachines = React.useMemo(
    () => allMachines.filter(machine => isMachineOnline(machine)),
    [allMachines]
  );

  const { connectTerminal, connectWithUrl, isLoading } = useConnectTerminal();
  const {
    state: desktopCLI,
    refresh: refreshDesktopCLI,
    installOrUpdate: installOrUpdateDesktopCLI,
    authorize: authorizeDesktopCLI,
  } = useDesktopCLIStatus(auth.credentials);
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
  const [checkingForUpdates, setCheckingForUpdates] = React.useState(false);
  const [desktopUpdateStatus, setDesktopUpdateStatus] = React.useState<string | null>(null);
  const [isDesktopUpdaterAvailable, setIsDesktopUpdaterAvailable] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    if (!isDesktopApp) {
      setIsDesktopUpdaterAvailable(false);
      return;
    }

    void (async () => {
      const enabled = await isTauriUpdaterEnabled();
      if (cancelled) {
        return;
      }

      setIsDesktopUpdaterAvailable(enabled);
      if (!enabled) {
        setDesktopUpdateStatus(
          `Current version: ${appVersion}. Auto-update is unavailable in this desktop build. Install a release bundle built with updater support to enable in-app updates.`
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appVersion, isDesktopApp]);

  const handleCheckForDesktopUpdates = React.useCallback(async () => {
    if (!isDesktopUpdaterAvailable || checkingForUpdates) {
      return;
    }

    setCheckingForUpdates(true);
    setDesktopUpdateStatus('Checking for updates…');

    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();

      if (!update) {
        const status = `Up to date (${appVersion})`;
        setDesktopUpdateStatus(status);
        Modal.alert('Up to date', `Free ${appVersion} is already the latest version.`);
        return;
      }

      setDesktopUpdateStatus(`Update ${update.version} available`);
      const confirmed = await Modal.confirm(
        'Update available',
        `Version ${update.version} is available. Current version: ${update.currentVersion}. Download and install it now?`,
        {
          cancelText: t('common.cancel'),
          confirmText: 'Install update',
        }
      );

      if (!confirmed) {
        await update.close();
        return;
      }

      let downloadedBytes = 0;
      let totalBytes: number | null = null;

      await update.downloadAndInstall(event => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? null;
          setDesktopUpdateStatus('Downloading update…');
          return;
        }

        if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes && totalBytes > 0) {
            const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            setDesktopUpdateStatus(`Downloading update… ${percent}%`);
          } else {
            setDesktopUpdateStatus('Downloading update…');
          }
          return;
        }

        setDesktopUpdateStatus('Installing update…');
      });

      setDesktopUpdateStatus(`Update ${update.version} installed. Restart required.`);
      Modal.alert(
        'Update installed',
        `Free ${update.version} has been downloaded and installed. Restart the app to finish applying the update.`
      );
    } catch (error) {
      const message = getTauriErrorMessage(error);
      logger.warn('Desktop update failed', { error: safeStringify(error) });
      setDesktopUpdateStatus('Update check failed');
      Modal.alert('Update failed', message);
    } finally {
      setCheckingForUpdates(false);
    }
  }, [appVersion, checkingForUpdates, isDesktopUpdaterAvailable]);

  const desktopCLITitle = React.useMemo(() => {
    if (desktopCLI.needsInstall) {
      return 'Install Free CLI';
    }
    if (desktopCLI.needsAuth) {
      return 'Authorize This PC';
    }
    if (desktopCLI.needsUpdate) {
      return 'Update Free CLI';
    }
    return 'Local Free CLI';
  }, [desktopCLI.needsAuth, desktopCLI.needsInstall, desktopCLI.needsUpdate]);

  const desktopCLISubtitle = React.useMemo(() => {
    if (desktopCLI.isChecking) {
      return 'Checking local CLI status and installed version…';
    }
    if (desktopCLI.error) {
      return desktopCLI.error;
    }
    if (desktopCLI.needsInstall) {
      if (desktopCLI.installIssues.length > 0) {
        if (desktopCLI.canAutoRepair && desktopCLI.brewPath) {
          return 'Free CLI prerequisites are missing on this Mac. The app can repair them automatically with Homebrew, then run the official install.sh flow.';
        }
        return desktopCLI.installIssues
          .map(issue => issue.suggestedAction || issue.message)
          .filter(Boolean)
          .join(' ');
      }
      if (!desktopCLI.bashPath) {
        return 'bash was not found on this Mac. Free CLI installer requires bash.';
      }
      if (!desktopCLI.curlPath) {
        return 'curl was not found on this Mac. Free CLI currently installs through install.sh, so curl is required.';
      }
      return 'Free CLI is not installed on this Mac. Install it here with the official install.sh flow, then authorize this app account for local agent control.';
    }
    if (desktopCLI.needsAuth) {
      return `Free CLI ${desktopCLI.version ?? 'installed'} is installed, but this Mac is not linked to your current account yet. The daemon will only come up after you log in and authorize this PC.`;
    }
    if (desktopCLI.hasCredentials && !desktopCLI.daemonRunning) {
      return 'This Mac is authorized, but the local daemon is not ready yet. Re-authorize or run `free daemon status` to diagnose.';
    }
    if (desktopCLI.needsUpdate) {
      return `Installed ${desktopCLI.version}. Latest ${desktopCLI.latestVersion}. Update to keep desktop and CLI behavior aligned.`;
    }
    if (desktopCLI.version) {
      return `Installed ${desktopCLI.version}${desktopCLI.latestVersion ? ` · Latest ${desktopCLI.latestVersion}` : ''}`;
    }
    return 'Free CLI is available on this Mac.';
  }, [
    desktopCLI.error,
    desktopCLI.isChecking,
    desktopCLI.latestVersion,
    desktopCLI.needsAuth,
    desktopCLI.needsInstall,
    desktopCLI.needsUpdate,
    desktopCLI.hasCredentials,
    desktopCLI.daemonRunning,
    desktopCLI.installIssues,
    desktopCLI.canAutoRepair,
    desktopCLI.brewPath,
    desktopCLI.curlPath,
    desktopCLI.bashPath,
    desktopCLI.version,
  ]);

  const desktopCLIFooter = React.useMemo(() => {
    if (desktopCLI.isRepairing) {
      return 'Repairing environment…';
    }
    if (desktopCLI.isInstalling) {
      return 'Installing…';
    }
    if (desktopCLI.isAuthorizing) {
      return 'Authorizing…';
    }
    if (desktopCLI.needsInstall) {
      if (desktopCLI.installIssues.length > 0) {
        return desktopCLI.canAutoRepair ? 'Repair and install' : 'Manual fix required';
      }
      return desktopCLI.bashPath && desktopCLI.curlPath ? 'Install CLI' : 'Installer unavailable';
    }
    if (desktopCLI.needsAuth) {
      return 'Authorize now';
    }
    if (desktopCLI.hasCredentials && !desktopCLI.daemonRunning) {
      return 'Repair daemon';
    }
    if (desktopCLI.needsUpdate) {
      return 'Update CLI';
    }
    return 'Refresh status';
  }, [
    desktopCLI.isAuthorizing,
    desktopCLI.isRepairing,
    desktopCLI.isInstalling,
    desktopCLI.needsAuth,
    desktopCLI.needsInstall,
    desktopCLI.needsUpdate,
    desktopCLI.hasCredentials,
    desktopCLI.daemonRunning,
    desktopCLI.installIssues,
    desktopCLI.canAutoRepair,
    desktopCLI.curlPath,
    desktopCLI.bashPath,
  ]);

  const handleDesktopCLIPress = React.useCallback(async () => {
    if (!isDesktopApp) {
      return;
    }

    if (
      desktopCLI.isChecking ||
      desktopCLI.isRepairing ||
      desktopCLI.isInstalling ||
      desktopCLI.isAuthorizing
    ) {
      return;
    }

    if (desktopCLI.needsInstall || desktopCLI.needsUpdate) {
      if (desktopCLI.installIssues.length > 0 && !desktopCLI.canAutoRepair) {
        Modal.alert(
          'Manual setup required',
          desktopCLI.installIssues
            .map(issue => issue.suggestedAction || issue.message)
            .filter(Boolean)
            .join('\n')
        );
        return;
      }

      const confirmed = await Modal.confirm(
        desktopCLI.needsInstall ? 'Install Free CLI' : 'Update Free CLI',
        desktopCLI.installIssues.length > 0 && desktopCLI.canAutoRepair
          ? 'The app will first repair missing prerequisites with Homebrew, then download and run the official Free install.sh script.'
          : desktopCLI.needsInstall
            ? 'This will download and run the official Free install.sh script on this Mac.'
            : `This will re-run the official Free install.sh script to update the local CLI from ${desktopCLI.version ?? 'unknown'} to the latest published version.`,
        {
          cancelText: t('common.cancel'),
          confirmText: desktopCLI.needsInstall ? 'Install' : 'Update',
        }
      );

      if (!confirmed) {
        return;
      }

      await installOrUpdateDesktopCLI();
      return;
    }

    if (desktopCLI.needsAuth) {
      const confirmed = await Modal.confirm(
        'Authorize This PC',
        'This will write your current app credentials into the local Free CLI config, then start the local daemon and wait for it to become ready.',
        {
          cancelText: t('common.cancel'),
          confirmText: 'Authorize',
        }
      );

      if (!confirmed) {
        return;
      }

      await authorizeDesktopCLI();
      return;
    }

    if (desktopCLI.hasCredentials && !desktopCLI.daemonRunning) {
      const confirmed = await Modal.confirm(
        'Repair daemon',
        'This Mac already has CLI credentials, but the daemon is not ready. Re-run local authorization and start the daemon again?',
        {
          cancelText: t('common.cancel'),
          confirmText: 'Start daemon',
        }
      );

      if (!confirmed) {
        return;
      }

      await authorizeDesktopCLI();
      return;
    }

    await refreshDesktopCLI();
  }, [
    authorizeDesktopCLI,
    desktopCLI.isAuthorizing,
    desktopCLI.isChecking,
    desktopCLI.isRepairing,
    desktopCLI.isInstalling,
    desktopCLI.installIssues,
    desktopCLI.needsAuth,
    desktopCLI.needsInstall,
    desktopCLI.needsUpdate,
    desktopCLI.hasCredentials,
    desktopCLI.daemonRunning,
    desktopCLI.canAutoRepair,
    desktopCLI.curlPath,
    desktopCLI.bashPath,
    desktopCLI.version,
    installOrUpdateDesktopCLI,
    isDesktopApp,
    refreshDesktopCLI,
  ]);

  return (
    <ItemList style={{ paddingTop: 0 }}>
      <View style={styles.heroShell}>
        <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={styles.heroAvatarWrap}>
              {profile.firstName ? (
                <Avatar
                  id={profile.id}
                  size={84}
                  imageUrl={avatarUrl}
                  thumbhash={profile.avatar?.thumbhash}
                />
              ) : (
                <View
                  style={{
                    width: 84,
                    height: 84,
                    borderRadius: 28,
                    backgroundColor: theme.colors.groupped.background,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="code-slash" size={34} color={theme.colors.text} />
                </View>
              )}
            </View>
            <View style={styles.heroMeta}>
              <Text style={styles.heroEyebrow}>{t('settings.title')}</Text>
              <Text style={styles.heroTitle}>{profile.firstName ? displayName : 'Free'}</Text>
              <Text style={styles.heroBio}>
                {bio || t('settings.workspaceControl')}
              </Text>
            </View>
          </View>

          <View style={styles.statRow}>
            <View style={styles.statChip}>
              <StatusDot
                color={
                  onlineMachines.length > 0
                    ? theme.colors.status.connected
                    : theme.colors.status.disconnected
                }
                isPulsing={onlineMachines.length > 0}
                size={7}
                style={styles.statDot}
              />
              <Text style={styles.statChipText}>
                {t('settings.machineSummary', {
                  total: allMachines.length,
                  online: onlineMachines.length,
                })}
              </Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statChipText}>{`v${appVersion}`}</Text>
            </View>
            {isPro ? (
              <View style={styles.statChip}>
                <Text style={styles.statChipText}>{t('settings.supportUsSubtitlePro')}</Text>
              </View>
            ) : null}
            {experiments ? (
              <View style={styles.statChip}>
                <Text style={styles.statChipText}>{t('settings.featuresTitle')}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.actionRow}>
          {Platform.OS !== 'web' && (
            <Pressable style={styles.actionCard} onPress={connectTerminal}>
              <View style={styles.actionIconWrap}>
                <Ionicons name="qr-code-outline" size={22} color={theme.colors.text} />
              </View>
              <Text style={styles.actionTitle}>{t('settings.scanQrCodeToAuthenticate')}</Text>
              <Text style={styles.actionSubtitle}>{t('settings.scanQrDescription')}</Text>
              <Text style={styles.actionFooter}>
                {isLoading ? t('common.loading') : t('components.emptyMainScreen.openCamera')}
              </Text>
            </Pressable>
          )}
          <Pressable
            style={styles.actionCard}
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
          >
            <View style={styles.actionIconWrap}>
              <Ionicons name="link-outline" size={22} color={theme.colors.text} />
            </View>
            <Text style={styles.actionTitle}>{t('connect.enterUrlManually')}</Text>
            <Text style={styles.actionSubtitle}>{t('settings.pasteTerminalLinkDescription')}</Text>
            <Text style={styles.actionFooter}>{t('common.authenticate')}</Text>
          </Pressable>
          {isDesktopApp ? (
            <Pressable style={styles.actionCard} onPress={handleDesktopCLIPress}>
              <View style={styles.actionIconWrap}>
                <Ionicons
                  name={
                    desktopCLI.needsInstall
                      ? 'download-outline'
                      : desktopCLI.needsAuth
                        ? 'key-outline'
                        : desktopCLI.needsUpdate
                          ? 'refresh-outline'
                          : 'terminal-outline'
                  }
                  size={22}
                  color={theme.colors.text}
                />
              </View>
              <Text style={styles.actionTitle}>{desktopCLITitle}</Text>
              <Text style={styles.actionSubtitle}>{desktopCLISubtitle}</Text>
              <Text style={styles.actionFooter}>{desktopCLIFooter}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.machineSection}>
          <Text style={styles.sectionEyebrow}>{t('settings.machines')}</Text>
          <Text style={styles.sectionTitle}>{t('settings.devicesReadyTitle')}</Text>
          <Text style={styles.sectionSubtitle}>
            {allMachines.length > 0
              ? t('settings.machineSummaryLong', {
                  total: allMachines.length,
                  online: onlineMachines.length,
                })
              : t('settings.noMachinesConnectedYet')}
          </Text>

          {allMachines.length > 0 ? (
            <View style={styles.machinesList}>
              {[...allMachines].map(machine => {
                const isOnline = isMachineOnline(machine);
                const host = machine.metadata?.host || 'Unknown';
                const machineDisplayName = machine.metadata?.displayName || host;
                const platform = machine.metadata?.platform || '';
                return (
                  <Pressable
                    key={machine.id}
                    style={styles.machineCard}
                    onPress={() => router.push(`/machine/${machine.id}`)}
                  >
                    <View style={styles.machineCardTop}>
                      <View style={styles.machineIcon}>
                        <Ionicons
                          name="desktop-outline"
                          size={20}
                          color={
                            isOnline
                              ? theme.colors.status.connected
                              : theme.colors.status.disconnected
                          }
                        />
                      </View>
                      <View style={styles.machineMeta}>
                        <Text style={styles.machineTitle}>{machineDisplayName}</Text>
                        <Text style={styles.machineSubtitle}>
                          {machine.metadata?.displayName && machineDisplayName !== host
                            ? `${host}${platform ? `  ${platform}` : ''}`
                            : platform || host}
                        </Text>
                      </View>
                      <View style={styles.machineStatusWrap}>
                        <StatusDot
                          color={
                            isOnline
                              ? theme.colors.status.connected
                              : theme.colors.status.disconnected
                          }
                          isPulsing={isOnline}
                          size={7}
                          style={styles.statDot}
                        />
                        <Text
                          style={[
                            styles.machineStatusText,
                            {
                              color: isOnline
                                ? theme.colors.status.connected
                                : theme.colors.status.disconnected,
                            },
                          ]}
                        >
                          {isOnline ? t('status.online') : t('status.offline')}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.machineCardBottom}>
                      <View style={styles.machineMetaChip}>
                        <Text style={styles.machineMetaChipText}>{machine.id.slice(0, 8)}</Text>
                      </View>
                      <Text style={styles.machineAction}>{t('settings.openMachine')}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      </View>

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
        {isDesktopApp && (
          <Item
            title="Check for Updates"
            subtitle={
              desktopUpdateStatus ||
              `Current version: ${appVersion}. Check GitHub release updates and install the latest desktop build.`
            }
            subtitleLines={0}
            icon={<Ionicons name="cloud-download-outline" size={29} color="#34C759" />}
            onPress={isDesktopUpdaterAvailable ? () => void handleCheckForDesktopUpdates() : undefined}
            loading={isDesktopUpdaterAvailable ? checkingForUpdates : false}
            disabled={!isDesktopUpdaterAvailable}
            showChevron={false}
          />
        )}
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
