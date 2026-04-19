import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { Logger, safeStringify } from '@saaskit-dev/agentbridge/telemetry';
import { kvStore } from '@/sync/cachedKVStore';
import { isTauriDesktop, isTauriUpdaterEnabled } from '@/utils/tauri';

const logger = new Logger('app/hooks/useUpdates');

const UPDATE_STATE_KEY = 'app-update-availability-v1';

type PersistedUpdateState = {
  installedVersion: string;
  updateAvailable: boolean;
};

type UpdatesSnapshot = {
  updateAvailable: boolean;
  isChecking: boolean;
  desktopUpdate: any | null;
  installedVersion: string;
};

const listeners = new Set<() => void>();

function getInstalledVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

function loadPersistedUpdateState(installedVersion: string): PersistedUpdateState | null {
  const raw = kvStore.getString(UPDATE_STATE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedUpdateState;
    if (
      typeof parsed.installedVersion !== 'string' ||
      typeof parsed.updateAvailable !== 'boolean'
    ) {
      return null;
    }
    if (parsed.installedVersion !== installedVersion) {
      return null;
    }
    return parsed;
  } catch (error) {
    logger.warn('Failed to parse persisted update state', {
      error: safeStringify(error),
    });
    kvStore.delete(UPDATE_STATE_KEY);
    return null;
  }
}

function createInitialSnapshot(): UpdatesSnapshot {
  const installedVersion = getInstalledVersion();
  const persisted = loadPersistedUpdateState(installedVersion);
  return {
    updateAvailable: persisted?.updateAvailable === true,
    isChecking: false,
    desktopUpdate: null,
    installedVersion,
  };
}

let snapshot: UpdatesSnapshot = createInitialSnapshot();
let activeCheckPromise: Promise<void> | null = null;
let singletonStarted = false;
let appStateSubscription: { remove(): void } | null = null;

function emitSnapshot() {
  for (const listener of listeners) {
    listener();
  }
}

function writeSnapshot(next: UpdatesSnapshot) {
  const previous = snapshot;
  snapshot = next;

  if (previous.updateAvailable !== next.updateAvailable) {
    logger.debug('[useUpdates] update availability changed', {
      installedVersion: next.installedVersion,
      updateAvailable: next.updateAvailable,
      isDesktop: isTauriDesktop(),
    });
  }

  if (next.updateAvailable) {
    kvStore.set(
      UPDATE_STATE_KEY,
      JSON.stringify({
        installedVersion: next.installedVersion,
        updateAvailable: true,
      } satisfies PersistedUpdateState)
    );
  } else if (previous.installedVersion !== next.installedVersion) {
    kvStore.delete(UPDATE_STATE_KEY);
  }

  emitSnapshot();
}

function updateSnapshot(patch: Partial<UpdatesSnapshot>) {
  writeSnapshot({
    ...snapshot,
    ...patch,
  });
}

function refreshInstalledVersion() {
  const installedVersion = getInstalledVersion();
  if (snapshot.installedVersion === installedVersion) {
    return;
  }

  const persisted = loadPersistedUpdateState(installedVersion);
  writeSnapshot({
    updateAvailable: persisted?.updateAvailable === true,
    isChecking: false,
    desktopUpdate: null,
    installedVersion,
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  refreshInstalledVersion();
  return snapshot;
}

function shouldKeepStickyUpdate() {
  return snapshot.updateAvailable;
}

async function checkForUpdatesShared(): Promise<void> {
  refreshInstalledVersion();

  if (__DEV__) {
    return;
  }

  if (snapshot.isChecking && activeCheckPromise) {
    return activeCheckPromise;
  }

  updateSnapshot({ isChecking: true });

  activeCheckPromise = (async () => {
    try {
      if (isTauriDesktop()) {
        const updaterEnabled = await isTauriUpdaterEnabled();
        if (!updaterEnabled) {
          updateSnapshot({
            isChecking: false,
            desktopUpdate: null,
            updateAvailable: false,
          });
          return;
        }

        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (update) {
          updateSnapshot({
            desktopUpdate: update,
            updateAvailable: true,
          });
        } else if (!shouldKeepStickyUpdate()) {
          updateSnapshot({
            desktopUpdate: null,
            updateAvailable: false,
          });
        }
        return;
      }

      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
        updateSnapshot({
          updateAvailable: true,
        });
      } else if (!shouldKeepStickyUpdate()) {
        updateSnapshot({
          updateAvailable: false,
        });
      }
    } catch (error) {
      if (!shouldKeepStickyUpdate()) {
        updateSnapshot({
          desktopUpdate: null,
          updateAvailable: false,
        });
      }
      logger.warn('Error checking for updates', { error: safeStringify(error) });
    } finally {
      updateSnapshot({ isChecking: false });
      activeCheckPromise = null;
    }
  })();

  return activeCheckPromise;
}

function handleAppStateChange(nextAppState: AppStateStatus) {
  if (nextAppState === 'active') {
    void checkForUpdatesShared();
  }
}

function ensureSingletonStarted() {
  if (singletonStarted) {
    return;
  }
  singletonStarted = true;
  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
  void checkForUpdatesShared();
}

export function useUpdates() {
  const sharedState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    ensureSingletonStarted();
    return () => {
      if (listeners.size === 0 && appStateSubscription && !__DEV__) {
        // Keep the singleton listener for the process lifetime in production.
        // In development, Fast Refresh benefits from fully resetting the hook.
        return;
      }
    };
  }, []);

  const reloadApp = async () => {
    if (isTauriDesktop()) {
      try {
        let desktopUpdate = snapshot.desktopUpdate;
        if (!desktopUpdate && snapshot.updateAvailable) {
          await checkForUpdatesShared();
          desktopUpdate = snapshot.desktopUpdate;
        }
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

    if (snapshot.updateAvailable) {
      await checkForUpdatesShared();
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
    updateAvailable: sharedState.updateAvailable,
    isChecking: sharedState.isChecking,
    checkForUpdates: checkForUpdatesShared,
    reloadApp,
  };
}
