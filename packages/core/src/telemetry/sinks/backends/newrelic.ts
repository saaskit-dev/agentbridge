import type { LogEntry } from '../../types.js'
import type { RemoteBackend, RemoteRequest, DeviceMetadata } from './types.js'

export class NewRelicBackend implements RemoteBackend {
  readonly name = 'newrelic'

  constructor(private opts: {
    licenseKey: string | (() => string | undefined)
    region?: 'us' | 'eu'
  }) {}

  buildRequest(entries: LogEntry[], meta: DeviceMetadata): RemoteRequest | null {
    const key = typeof this.opts.licenseKey === 'function'
      ? this.opts.licenseKey()
      : this.opts.licenseKey
    if (!key) return null

    const baseUrl = this.opts.region === 'eu'
      ? 'https://log-api.eu.newrelic.com'
      : 'https://log-api.newrelic.com'

    const payload = [{
      common: {
        attributes: {
          'service.name': 'agentbridge',
          'device.id': meta.deviceId,
          'app.version': meta.appVersion,
          'telemetry.layer': meta.layer,
          ...(meta.machineId ? { 'machine.id': meta.machineId } : {}),
          ...(meta.env ? { 'deployment.environment': meta.env } : {}),
          ...(meta.serverIp ? { 'server.ip': meta.serverIp } : {}),
        },
      },
      logs: entries.map(entry => ({
        timestamp: new Date(entry.timestamp).getTime(),
        message: entry.message,
        level: entry.level,
        attributes: {
          ...entry.data,
          component: entry.component,
          layer: entry.layer,
          ...(entry.traceId ? { traceId: entry.traceId } : {}),
          ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
          ...(entry.machineId ? { machineId: entry.machineId } : {}),
          ...(entry.durationMs != null ? { durationMs: entry.durationMs } : {}),
          ...(entry.error ? {
            'error.message': entry.error.message,
            'error.stack': entry.error.stack,
            'error.code': entry.error.code,
          } : {}),
        },
      })),
    }]

    return {
      url: `${baseUrl}/log/v1`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': key,
      },
      body: JSON.stringify(payload),
    }
  }
}
