/**
 * Server-side telemetry relay — aggregates client logs and forwards to New Relic
 *
 * Batching strategy:
 * - Buffers entries from all clients
 * - Flushes when buffer hits batchSize (200) OR every flushIntervalMs (15s)
 * - Groups entries by source (deviceId + layer + appVersion) for NR's common attributes
 * - Max buffer 5000 entries; oldest dropped on overflow
 * - Network errors silently dropped — telemetry must never block
 */

import type { LogEntry, DeviceMetadata } from '@saaskit-dev/agentbridge/telemetry';

interface RelayEntry {
  entry: LogEntry;
  metadata: DeviceMetadata;
}

export class TelemetryRelay {
  private buffer: RelayEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private readonly licenseKey: string;
  private readonly baseUrl: string;
  private readonly maxBuffer: number;
  private readonly batchSize: number;

  constructor(opts: {
    licenseKey: string;
    region?: 'us' | 'eu';
    flushIntervalMs?: number;
    maxBuffer?: number;
    batchSize?: number;
  }) {
    this.licenseKey = opts.licenseKey;
    this.baseUrl =
      opts.region === 'eu'
        ? 'https://log-api.eu.newrelic.com'
        : 'https://log-api.newrelic.com';
    this.maxBuffer = opts.maxBuffer ?? 5000;
    this.batchSize = opts.batchSize ?? 200;

    const intervalMs = opts.flushIntervalMs ?? 15_000;
    this.flushTimer = setInterval(() => this.flush(), intervalMs);
    if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      (this.flushTimer as NodeJS.Timeout).unref();
    }
  }

  ingest(entries: LogEntry[], metadata: DeviceMetadata): void {
    for (const entry of entries) {
      this.buffer.push({ entry, metadata });
    }

    if (this.buffer.length > this.maxBuffer) {
      this.buffer.splice(0, this.buffer.length - this.maxBuffer);
    }

    if (this.buffer.length >= this.batchSize) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;

    try {
      while (this.buffer.length > 0) {
        const batch = this.buffer.splice(0, this.batchSize);

        // Group by source metadata
        const groups = new Map<string, { meta: DeviceMetadata; entries: LogEntry[] }>();
        for (const { entry, metadata } of batch) {
          const key = `${metadata.deviceId}|${metadata.layer}|${metadata.appVersion}`;
          let g = groups.get(key);
          if (!g) {
            g = { meta: metadata, entries: [] };
            groups.set(key, g);
          }
          g.entries.push(entry);
        }

        // Build NR Log API payload — one block per source group
        const payload = Array.from(groups.values()).map(({ meta, entries }) => ({
          common: {
            attributes: {
              'service.name': 'agentbridge',
              'device.id': meta.deviceId,
              'app.version': meta.appVersion,
              'telemetry.layer': meta.layer,
              'telemetry.source': 'relay',
              ...(meta.machineId ? { 'machine.id': meta.machineId } : {}),
            },
          },
          logs: entries.map((e) => ({
            timestamp: new Date(e.timestamp).getTime(),
            message: e.message,
            level: e.level,
            attributes: {
              ...e.data,
              component: e.component,
              layer: e.layer,
              ...(e.traceId ? { traceId: e.traceId } : {}),
              ...(e.spanId ? { spanId: e.spanId } : {}),
              ...(e.parentSpanId ? { parentSpanId: e.parentSpanId } : {}),
              ...(e.sessionId ? { sessionId: e.sessionId } : {}),
              ...(e.machineId ? { machineId: e.machineId } : {}),
              ...(e.durationMs != null ? { durationMs: e.durationMs } : {}),
              ...(e.error
                ? {
                    'error.message': e.error.message,
                    'error.stack': e.error.stack,
                    'error.code': e.error.code,
                  }
                : {}),
            },
          })),
        }));

        try {
          const res = await fetch(`${this.baseUrl}/log/v1`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Api-Key': this.licenseKey,
            },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            // Server error — put entries back for next retry cycle
            this.buffer.unshift(...batch);
            return;
          }
        } catch {
          // Network error — put entries back for next retry cycle
          this.buffer.unshift(...batch);
          return;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Drain all remaining batches on shutdown
    while (this.buffer.length > 0) {
      const before = this.buffer.length;
      await this.flush();
      if (this.buffer.length >= before) break;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton — only created when NEW_RELIC_LICENSE_KEY is configured
// ---------------------------------------------------------------------------

const nrKey = process.env.NEW_RELIC_LICENSE_KEY;

export const telemetryRelay: TelemetryRelay | null = nrKey
  ? new TelemetryRelay({
      licenseKey: nrKey,
      region: (process.env.NEW_RELIC_REGION as 'us' | 'eu') || 'us',
    })
  : null;

export async function shutdownRelay(): Promise<void> {
  if (telemetryRelay) {
    await telemetryRelay.close();
  }
}
