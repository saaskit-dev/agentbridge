/**
 * App-level telemetry initialization
 *
 * RemoteSink: ON by default (RFC §21.2), sends all log levels (debug/info/warn/error)
 * to the server relay which forwards to New Relic. Auth token is set lazily after login.
 * deviceId uses sync.anonId (user-level anonymous identifier) for cross-device tracking.
 *
 * TraceContext: We do NOT use setGlobalContextProvider() in the App — multiple sessions
 * can run in parallel, so a single "current session" would mis-attribute traces. Session-
 * scoped code uses sessionLogger() from appTraceStore (per sessionId) or logger.withContext().
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  initTelemetry,
  isCollectorReady,
  RemoteSink,
  ServerRelayBackend,
} from '@saaskit-dev/agentbridge/telemetry';
import { config } from '@/config';
import { getServerUrl } from '@/sync/serverConfig';
import { sync } from '@/sync/sync';
import { DesktopFileSink } from '@/telemetry/desktopFileSink';
import { isTauriDesktop } from '@/utils/tauri';

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
    // deviceId is lazily resolved from sync.anonId (user-level anonymous identifier)
    // Falls back to platform-app if sync not initialized yet
    const getDeviceId = () => sync.anonId || Platform.OS + '-app';
    const sinks = [];

    if (isTauriDesktop()) {
      sinks.push(new DesktopFileSink());
    }

    sinks.push(
      new RemoteSink({
        backend: new ServerRelayBackend({
          serverUrl,
          authToken: () => _telemetryAuthToken,
        }),
        minLevel: 'debug',
        metadata: { deviceId: getDeviceId(), appVersion, layer: 'app' },
      })
    );

    initTelemetry({
      layer: 'app',
      sinks,
      minLevel: 'debug',
      sanitize: !config.isDev,
    });
  }
}

/** @deprecated Use setAnalyticsEnabled(false) */
export function disableRemoteTelemetry(): void {
  _analyticsEnabled = false;
  _telemetryAuthToken = undefined;
}
