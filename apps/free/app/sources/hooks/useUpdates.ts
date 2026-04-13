import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { Logger, safeStringify } from '@saaskit-dev/agentbridge/telemetry';
import { isTauriDesktop } from '@/utils/tauri';
const logger = new Logger('app/hooks/useUpdates');

export function useUpdates() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [desktopUpdate, setDesktopUpdate] = useState<any>(null);

  useEffect(() => {
    // Check for updates when app becomes active
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Initial check
    checkForUpdates();

    return () => {
      subscription.remove();
    };
  }, []);

  const handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      checkForUpdates();
    }
  };

  const checkForUpdates = async () => {
    if (__DEV__) {
      // Don't check for updates in development
      return;
    }

    if (isChecking) {
      return;
    }

    setIsChecking(true);

    try {
      if (isTauriDesktop()) {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        setDesktopUpdate(update);
        setUpdateAvailable(Boolean(update));
        return;
      }

      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
        setUpdateAvailable(true);
      } else {
        setUpdateAvailable(false);
      }
    } catch (error) {
      setDesktopUpdate(null);
      setUpdateAvailable(false);
      logger.warn('Error checking for updates', { error: safeStringify(error) });
    } finally {
      setIsChecking(false);
    }
  };

  const reloadApp = async () => {
    if (isTauriDesktop()) {
      try {
        if (!desktopUpdate) {
          return;
        }
        await desktopUpdate.downloadAndInstall();
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      } catch (error) {
        logger.warn('Error installing desktop update', { error: safeStringify(error) });
      }
      return;
    }

    if (Platform.OS === 'web') {
      window.location.reload();
    } else {
      try {
        await Updates.reloadAsync();
      } catch (error) {
        logger.warn('Error reloading app', { error: safeStringify(error) });
      }
    }
  };

  return {
    updateAvailable,
    isChecking,
    checkForUpdates,
    reloadApp,
  };
}
