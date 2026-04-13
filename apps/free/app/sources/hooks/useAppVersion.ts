import * as React from 'react';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { isTauriDesktop } from '@/utils/tauri';

function getFallbackAppVersion(): string {
  return Application.nativeApplicationVersion || Constants.expoConfig?.version || '1.0.0';
}

export function useAppVersion(): string {
  const [appVersion, setAppVersion] = React.useState(getFallbackAppVersion);

  React.useEffect(() => {
    let cancelled = false;

    async function loadVersion() {
      if (Platform.OS === 'web' && isTauriDesktop()) {
        try {
          const { getVersion } = await import('@tauri-apps/api/app');
          const version = await getVersion();
          if (!cancelled && version) {
            setAppVersion(version);
          }
          return;
        } catch {
          // Fall back below when desktop runtime metadata is unavailable.
        }
      }

      const nativeVersion = Application.nativeApplicationVersion;
      if (!cancelled && nativeVersion) {
        setAppVersion(nativeVersion);
      }
    }

    void loadVersion();
    return () => {
      cancelled = true;
    };
  }, []);

  return appVersion;
}
