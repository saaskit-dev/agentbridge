import type { LogEntry } from '../../types.js';
import type { RemoteBackend, RemoteRequest, DeviceMetadata } from './types.js';

export interface ServerRelayBackendOptions {
  serverUrl: string;
  authToken: string | (() => string | undefined);
}

/**
 * RemoteBackend that sends log batches to our own server's relay endpoint
 * instead of directly to a third-party service.
 *
 * The auth token can be a lazy getter — if it returns undefined,
 * buildRequest returns null and RemoteSink will buffer entries until
 * the token becomes available (e.g. after user authentication).
 */
export class ServerRelayBackend implements RemoteBackend {
  readonly name = 'server-relay';

  constructor(private readonly opts: ServerRelayBackendOptions) {}

  buildRequest(entries: LogEntry[], meta: DeviceMetadata): RemoteRequest | null {
    const token =
      typeof this.opts.authToken === 'function' ? this.opts.authToken() : this.opts.authToken;
    if (!token) return null;

    return {
      url: `${this.opts.serverUrl}/v1/telemetry/ingest`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ metadata: meta, entries }),
    };
  }
}
