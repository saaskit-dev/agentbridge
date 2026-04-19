import 'react-native-quick-base64';
import '../theme.css';
import { initAppTelemetry, setTelemetryAuthToken, setAnalyticsEnabled } from '@/appTelemetry';
import { FontAwesome } from '@expo/vector-icons';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Fonts from 'expo-font';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import * as React from 'react';
import { View, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { AuthCredentials, TokenStorage } from '@/auth/tokenStorage';
import { CommandPaletteProvider } from '@/components/CommandPalette/CommandPaletteProvider';
import { DesktopPerformanceHud } from '@/components/DesktopPerformanceHud';
import { FocusAudioController } from '@/components/FocusAudioController';
import { SidebarNavigator } from '@/components/SidebarNavigator';
import { StatusBarProvider } from '@/components/StatusBarProvider';
import { FaviconPermissionIndicator } from '@/components/web/FaviconPermissionIndicator';
import sodium from '@/encryption/libsodium.lib';
import { initPasteImageBridge } from '@/utils/pasteImageBridge';
import { Modal, ModalProvider } from '@/modal';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';
import { useDesktopCLIStatus } from '@/hooks/useDesktopCLIStatus';
import { initKVStores } from '@/sync/cachedKVStore';
import { syncRestore } from '@/sync/sync';
import { loadCachedSessions, loadLocalSettings, loadSettings, saveLocalSettings } from '@/sync/persistence';
import { storage, useSetting } from '@/sync/storage';
import { getCurrentLanguage, resolveLanguage, setLanguage } from '@/text';
import {
  applyFocusAudioWidgetAction,
  mergeFocusAudioWidgetState,
  parseFocusAudioWidgetActionURL,
} from '@/widget/focusAudioWidget';
// import * as SystemUI from 'expo-system-ui';
import { AsyncLock } from '@/utils/lock';
import { isTauriDesktop } from '@/utils/tauri';
import { useWatchConnectivity } from '@/hooks/useWatchConnectivity';
import { useDisableTauriNativeContextMenu } from '@/hooks/useDisableTauriNativeContextMenu';
import { useTauriDevtoolsShortcut } from '@/hooks/useTauriDevtoolsShortcut';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/layout');

// Initialize telemetry — guard against double-init on Expo hot reload
initAppTelemetry();

// Configure notification handler for foreground notifications
Notifications.setNotificationHandler({
  handleNotification: async notification => {
    if (notification.request.content.data?.type === 'ws-reconnect') {
      return {
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

// Setup Android notification channel (required for Android 8.0+)
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF231F7C',
  });
}

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

// Configure splash screen
SplashScreen.setOptions({
  fade: true,
  duration: 300,
});
SplashScreen.preventAutoHideAsync();

// Set window background color - now handled by Unistyles
// SystemUI.setBackgroundColorAsync('white');

// Component to apply horizontal safe area padding
function HorizontalSafeAreaWrapper({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      {children}
    </View>
  );
}

const lock = new AsyncLock();
let loaded = false;

function applyFocusAudioWidgetURL(url: string | null) {
  if (!url) {
    return;
  }

  const action = parseFocusAudioWidgetActionURL(url);
  if (!action) {
    return;
  }

  const current = storage.getState().localSettings;
  const nextLocalSettings = applyFocusAudioWidgetAction(current, action);
  saveLocalSettings(nextLocalSettings);
  storage.setState(state => ({
    ...state,
    localSettings: nextLocalSettings,
  }));
}

function DesktopCLIOnboardingPrompt() {
  const auth = useAuth();
  const { state, installOrUpdate, authorize } = useDesktopCLIStatus(auth.credentials);
  const promptStateRef = React.useRef<'idle' | 'install' | 'auth'>('idle');

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !isTauriDesktop()) {
      return;
    }

    if (
      state.isChecking ||
      state.isRepairing ||
      state.isInstalling ||
      state.isAuthorizing ||
      !auth.isAuthenticated ||
      promptStateRef.current !== 'idle'
    ) {
      return;
    }

    if (state.needsInstall && (state.canAutoRepair || (state.curlPath && state.bashPath))) {
      promptStateRef.current = 'install';
      void (async () => {
        const confirmed = await Modal.confirm(
          'Install Free CLI',
          state.installIssues.length > 0 && state.canAutoRepair
            ? 'Free CLI is not installed and this Mac is missing some prerequisites. Let the app repair them automatically, then install Free CLI now?'
            : 'Free CLI is not installed on this Mac. Install it now so this desktop app can control local agents?',
          {
            confirmText: 'Install',
            cancelText: 'Later',
          }
        );

        if (confirmed) {
          await installOrUpdate();
        }
      })().finally(() => {
        promptStateRef.current = 'idle';
      });
      return;
    }

    if (!state.needsInstall && state.needsAuth) {
      promptStateRef.current = 'auth';
      void (async () => {
        const confirmed = await Modal.confirm(
          'Authorize This PC',
          'Free CLI is installed but not linked to your current account. Authorize this Mac now and start the local daemon?',
          {
            confirmText: 'Authorize',
            cancelText: 'Later',
          }
        );

        if (confirmed) {
          await authorize();
        }
      })().finally(() => {
        promptStateRef.current = 'idle';
      });
      return;
    }

    if (!state.needsInstall && state.hasCredentials && !state.daemonRunning) {
      promptStateRef.current = 'auth';
      void (async () => {
        const confirmed = await Modal.confirm(
          'Start local daemon',
          'This Mac is already linked to your account, but the local daemon is not ready yet. Start it now?',
          {
            confirmText: 'Start',
            cancelText: 'Later',
          }
        );

        if (confirmed) {
          await authorize();
        }
      })().finally(() => {
        promptStateRef.current = 'idle';
      });
    }
  }, [
    auth.isAuthenticated,
    authorize,
    state.canAutoRepair,
    state.installIssues,
    installOrUpdate,
    state.isAuthorizing,
    state.isChecking,
    state.isRepairing,
    state.isInstalling,
    state.needsAuth,
    state.needsInstall,
    state.hasCredentials,
    state.daemonRunning,
    state.curlPath,
    state.bashPath,
  ]);

  return null;
}

async function loadFonts() {
  await lock.inLock(async () => {
    if (loaded) {
      return;
    }
    loaded = true;
    // Check if running in Tauri
    const isTauri =
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      (window as any).__TAURI_INTERNALS__ !== undefined;

    if (!isTauri) {
      // Normal font loading for non-Tauri environments (native and regular web)
      await Fonts.loadAsync({
        // Keep existing font
        SpaceMono: require('@/assets/fonts/SpaceMono-Regular.ttf'),

        // IBM Plex Sans family
        'IBMPlexSans-Regular': require('@/assets/fonts/IBMPlexSans-Regular.ttf'),
        'IBMPlexSans-Italic': require('@/assets/fonts/IBMPlexSans-Italic.ttf'),
        'IBMPlexSans-SemiBold': require('@/assets/fonts/IBMPlexSans-SemiBold.ttf'),

        // IBM Plex Mono family
        'IBMPlexMono-Regular': require('@/assets/fonts/IBMPlexMono-Regular.ttf'),
        'IBMPlexMono-Italic': require('@/assets/fonts/IBMPlexMono-Italic.ttf'),
        'IBMPlexMono-SemiBold': require('@/assets/fonts/IBMPlexMono-SemiBold.ttf'),

        // Bricolage Grotesque
        'BricolageGrotesque-Bold': require('@/assets/fonts/BricolageGrotesque-Bold.ttf'),

        ...FontAwesome.font,
      });
    } else {
      // For Tauri, skip Font Face Observer as fonts are loaded via CSS
      logger.debug('Do not wait for fonts to load');
      (async () => {
        try {
          await Fonts.loadAsync({
            // Keep existing font
            SpaceMono: require('@/assets/fonts/SpaceMono-Regular.ttf'),

            // IBM Plex Sans family
            'IBMPlexSans-Regular': require('@/assets/fonts/IBMPlexSans-Regular.ttf'),
            'IBMPlexSans-Italic': require('@/assets/fonts/IBMPlexSans-Italic.ttf'),
            'IBMPlexSans-SemiBold': require('@/assets/fonts/IBMPlexSans-SemiBold.ttf'),

            // IBM Plex Mono family
            'IBMPlexMono-Regular': require('@/assets/fonts/IBMPlexMono-Regular.ttf'),
            'IBMPlexMono-Italic': require('@/assets/fonts/IBMPlexMono-Italic.ttf'),
            'IBMPlexMono-SemiBold': require('@/assets/fonts/IBMPlexMono-SemiBold.ttf'),

            // Bricolage Grotesque
            'BricolageGrotesque-Bold': require('@/assets/fonts/BricolageGrotesque-Bold.ttf'),

            ...FontAwesome.font,
          });
        } catch (e) {
          // Ignore
        }
      })();
    }
  });
}

export default function RootLayout() {
  useDisableTauriNativeContextMenu();
  useTauriDevtoolsShortcut();
  const { theme } = useUnistyles();
  const navigationTheme = React.useMemo(() => {
    if (theme.dark) {
      return {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: theme.colors.groupped.background,
        },
      };
    }
    return {
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        background: theme.colors.groupped.background,
      },
    };
  }, [theme.dark]);

  //
  // Init sequence
  //
  const [initState, setInitState] = React.useState<{ credentials: AuthCredentials | null } | null>(
    null
  );
  const languageInitialized = React.useRef(false);
  const [languageKey, setLanguageKey] = React.useState(0);

  const preferredLanguage = useSetting('preferredLanguage');
  React.useEffect(() => {
    if (!languageInitialized.current) return;
    const lang = resolveLanguage(preferredLanguage);
    // Skip remount if language module is already on the correct language
    // (e.g. when Zustand is refreshed from KV after init but setLanguage was already called)
    if (lang === getCurrentLanguage()) return;
    setLanguage(lang);
    setLanguageKey(k => k + 1);
  }, [preferredLanguage]);

  React.useEffect(() => {
    initPasteImageBridge();
    (async () => {
      try {
        await initKVStores();
        await loadFonts();
        await sodium.ready;
        let credentials = await TokenStorage.getCredentials();
        logger.debug('credentials', credentials);
        // Wire RemoteSink auth token so telemetry can upload after login (RFC §21.2)
        // Respect the user's analytics opt-in preference from synced Settings (RFC §8.1)
        const { settings, version } = loadSettings();
        const localSettingsResult = mergeFocusAudioWidgetState(loadLocalSettings());
        const localSettings = localSettingsResult.nextLocalSettings;
        if (localSettingsResult.changed) {
          saveLocalSettings(localSettings);
        }
        // Refresh Zustand with real KV data — the store was created before initKVStores()
        // ran, so it loaded stale defaults. Without this, useSetting('preferredLanguage')
        // returns 'zh-Hans' (default) even when the stored value is e.g. 'en', making
        // the language settings page show the wrong selection and block switching.
        storage.setState(state => ({
          ...state,
          settings,
          settingsVersion: version,
          localSettings,
        }));
        applyFocusAudioWidgetURL(await Linking.getInitialURL());
        setAnalyticsEnabled(settings.analyticsEnabled !== false, credentials?.token);
        // Apply stored language preference now that KV store is ready
        setLanguage(resolveLanguage(settings.preferredLanguage));
        languageInitialized.current = true;
        if (credentials) {
          const cachedSessions = loadCachedSessions();
          if (cachedSessions.length > 0) {
            storage.getState().applySessions(cachedSessions);
            storage.getState().applyReady();
            logger.debug('Hydrated cached sessions from local SQLite', {
              count: cachedSessions.length,
            });
          }
          try {
            await syncRestore(credentials);
          } catch (syncError) {
            logger.error('Sync restore failed, clearing invalid credentials', toError(syncError));
            await TokenStorage.removeCredentials();
            credentials = null;
          }
        }

        setInitState({ credentials });
      } catch (error) {
        logger.error('Error initializing:', toError(error));
        setInitState({ credentials: null });
      }
    })();
  }, []);

  React.useEffect(() => {
    if (initState) {
      setTimeout(() => {
        SplashScreen.hideAsync();
      }, 100);
    }
  }, [initState]);

  React.useEffect(() => {
    const subscription = Linking.addEventListener('url', event => {
      applyFocusAudioWidgetURL(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  //
  // Not inited
  //

  // Sync session data to Apple Watch (no-op on non-iOS)
  useWatchConnectivity();

  if (!initState) {
    return null;
  }

  //
  // Boot
  //

  let providers = (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <AuthProvider initialCredentials={initState.credentials}>
            <ThemeProvider value={navigationTheme}>
              <StatusBarProvider />
              <ModalProvider>
                <CommandPaletteProvider>
                  <RealtimeProvider>
                    <FocusAudioController />
                    <DesktopCLIOnboardingPrompt />
                    <HorizontalSafeAreaWrapper>
                      <SidebarNavigator />
                    </HorizontalSafeAreaWrapper>
                    <DesktopPerformanceHud />
                  </RealtimeProvider>
                </CommandPaletteProvider>
              </ModalProvider>
            </ThemeProvider>
          </AuthProvider>
        </GestureHandlerRootView>
      </KeyboardProvider>
    </SafeAreaProvider>
  );

  return (
    <>
      <FaviconPermissionIndicator />
      <React.Fragment key={languageKey}>{providers}</React.Fragment>
    </>
  );
}
