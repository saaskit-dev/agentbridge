/**
 * Central backend configuration for RemoteSink (RFC §24.2 / §23.6).
 *
 * Change ACTIVE_BACKEND to switch between providers.
 * The DATASET constant reads APP_ENV at runtime to target the correct
 * environment-specific dataset (dev / preview / prod).
 *
 * Usage:
 *   import { createRemoteBackend, setTelemetryToken } from './config.js'
 *
 *   // After user authenticates:
 *   setTelemetryToken(credentials.telemetryToken)
 *
 *   // When creating RemoteSink:
 *   new RemoteSink({ backend: createRemoteBackend(), ... })
 */

import { AxiomBackend } from './axiom.js';
import { NewRelicBackend } from './newrelic.js';
import type { RemoteBackend } from './types.js';

// ========================================
// Change this line to switch backend:
const ACTIVE_BACKEND: 'axiom' | 'newrelic' = 'newrelic';
// ========================================

// Environment-aware dataset / account selection.
// APP_ENV is set at build time: 'development' | 'preview' | 'production'
const ENV = (typeof process !== 'undefined' ? process.env.APP_ENV : undefined) ?? 'development';
const DATASET_SUFFIX = ENV === 'production' ? 'prod' : ENV === 'preview' ? 'preview' : 'dev';
const DATASET = `agentbridge-${DATASET_SUFFIX}`;

let _telemetryToken: string | undefined;

/**
 * Call once after authentication to make the remote backend start uploading.
 * RemoteBackend reads this lazily at upload time — entries buffered before
 * this call will be included in the first successful flush.
 */
export function setTelemetryToken(token: string): void {
  _telemetryToken = token;
}

const BACKENDS = {
  axiom: () =>
    new AxiomBackend({
      dataset: DATASET,
      apiToken: () => _telemetryToken,
    }),
  newrelic: () =>
    new NewRelicBackend({
      licenseKey: () => _telemetryToken,
      region: 'us',
    }),
} as const;

/**
 * Create a RemoteBackend instance using the active backend and current environment.
 * Call once when building the RemoteSink at process startup.
 */
export function createRemoteBackend(): RemoteBackend {
  return BACKENDS[ACTIVE_BACKEND]();
}
