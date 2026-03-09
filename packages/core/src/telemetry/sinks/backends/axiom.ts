import type { LogEntry } from '../../types.js'
import type { RemoteBackend, RemoteRequest, DeviceMetadata } from './types.js'

export class AxiomBackend implements RemoteBackend {
  readonly name = 'axiom'

  constructor(private opts: {
    dataset: string
    apiToken: string | (() => string | undefined)
    baseUrl?: string
  }) {}

  buildRequest(entries: LogEntry[], meta: DeviceMetadata): RemoteRequest | null {
    const token = typeof this.opts.apiToken === 'function'
      ? this.opts.apiToken()
      : this.opts.apiToken
    if (!token) return null

    // Axiom ingest: array of JSON objects, each is one event.
    // Axiom auto-detects the _time field for timestamp.
    const events = entries.map(entry => ({
      _time: entry.timestamp,
      ...entry,
      _deviceId: meta.deviceId,
      _appVersion: meta.appVersion,
      _layer: meta.layer,
      ...(meta.machineId ? { _machineId: meta.machineId } : {}),
    }))

    return {
      url: `${this.opts.baseUrl ?? 'https://api.axiom.co'}/v1/datasets/${this.opts.dataset}/ingest`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(events),
    }
  }
}
