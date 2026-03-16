import type { LogEntry } from '../../types.js'

export interface DeviceMetadata {
  deviceId: string
  appVersion: string
  layer: string
  machineId?: string
  env?: string
  serverIp?: string
}

export interface RemoteRequest {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: string
}

export interface RemoteBackend {
  readonly name: string
  buildRequest(entries: LogEntry[], metadata: DeviceMetadata): RemoteRequest | null
}
