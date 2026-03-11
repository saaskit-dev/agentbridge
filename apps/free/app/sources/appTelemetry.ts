/**
 * App-level telemetry initialization
 *
 * Holds the MemorySink singleton so both the layout (init) and the
 * logs UI (read) can share the same instance without circular deps.
 *
 * Persistence: entries are flushed to AsyncStorage every 5s and on background,
 * so diagnostics survive iOS/Android app kills.
 *
 * RemoteSink: ON by default (RFC §21.2), sends warn/error entries to the server
 * relay which forwards to New Relic. Auth token is set lazily after login.
 */

import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  initTelemetry,
  isCollectorReady,
  MemorySink,
  RemoteSink,
  ServerRelayBackend,
} from '@saaskit-dev/agentbridge/telemetry';
import { getServerUrl } from '@/sync/serverConfig';

// AsyncStorage is not available on web — use lazy require to avoid module load crash
// On native (iOS/Android), entries are flushed every 5s and on background app kill
const nativePersistence: NonNullable<ConstructorParameters<typeof MemorySink>[0]>['persistence'] =
  Platform.OS !== 'web'
    ? (() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        return {
          storage: AsyncStorage,
          key: '@telemetry/logs',
          maxPersistedEntries: 2000,
          flushIntervalMs: 5000,
        };
      })()
    : undefined;

export const appMemorySink = new MemorySink({
  maxEntries: 500,
  persistence: nativePersistence,
});

// Flush to disk immediately when the app goes to background (before OS may kill it)
// AppState.addEventListener is a no-op on web so this is safe cross-platform
AppState.addEventListener('change', nextState => {
  if (nextState === 'background') {
    void appMemorySink.flush();
  }
});

// Lazily-resolved auth token for RemoteSink — set after login, cleared on logout
let _telemetryAuthToken: string | undefined;
// Whether the user has opted in to remote analytics (RFC §8.1, default: true)
let _analyticsEnabled = true;

/**
 * Called by the auth system after login/logout to wire up RemoteSink.
 * Before login: RemoteSink buffers entries silently (they stay local).
 * After login: buffered entries upload on the next 30s flush cycle.
 * If the user has opted out of analytics, the token stays cleared.
 */
export function setTelemetryAuthToken(token: string | undefined): void {
  _telemetryAuthToken = token;
  // Only actually enable the remote sink when analytics is on
  if (!_analyticsEnabled) {
    _telemetryAuthToken = undefined;
  }
}

/**
 * Called when the user toggles the analytics setting (RFC §8.1).
 * Pass the current auth token so the remote sink can be re-enabled.
 */
export function setAnalyticsEnabled(enabled: boolean, authToken?: string): void {
  _analyticsEnabled = enabled;
  _telemetryAuthToken = enabled ? authToken : undefined;
}

export function initAppTelemetry(): void {
  if (!isCollectorReady()) {
    const serverUrl = getServerUrl();
    const appVersion = Constants.expoConfig?.version ?? '0.0.0';
    const deviceId = Platform.OS + '-app';

    initTelemetry({
      layer: 'app',
      sinks: [
        appMemorySink,
        // RemoteSink ON by default (RFC §21.2) — user can opt-out in Settings → Privacy
        // Auth token is lazy: before login entries stay buffered, after login they upload
        new RemoteSink({
          backend: new ServerRelayBackend({
            serverUrl,
            authToken: () => _telemetryAuthToken,
          }),
          metadata: { deviceId, appVersion, layer: 'app' },
        }),
      ],
      minLevel: 'debug',
      sanitize: process.env.DEBUG ? false : true,
    });
  }
}

/** Load persisted log entries from AsyncStorage into the in-memory buffer. */
export async function loadPersistedTelemetry(): Promise<void> {
  await appMemorySink.loadPersistedEntries();
}

/** Remove the RemoteSink from the collector (user opted out of telemetry). @deprecated Use setAnalyticsEnabled(false) */
export function disableRemoteTelemetry(): void {
  _analyticsEnabled = false;
  _telemetryAuthToken = undefined;
}
