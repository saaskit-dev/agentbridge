export type UpdatesUpstreamMode = 'expo' | 'self-hosted' | 'disabled';

export type UpdatesGatewayConfig = {
  enabled: boolean;
  mode: UpdatesUpstreamMode;
  upstreamUrl: string | null;
  requestTimeoutMs: number;
};

function parseTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getUpdatesGatewayConfig(): UpdatesGatewayConfig {
  const mode = (process.env.EXPO_UPDATES_GATEWAY_MODE || 'self-hosted') as UpdatesUpstreamMode;
  const enabled = process.env.EXPO_UPDATES_GATEWAY_ENABLED
    ? process.env.EXPO_UPDATES_GATEWAY_ENABLED === 'true'
    : mode !== 'disabled';
  const upstreamUrl = process.env.EXPO_UPDATES_UPSTREAM_URL || null;

  return {
    enabled,
    mode,
    upstreamUrl,
    requestTimeoutMs: parseTimeout(process.env.EXPO_UPDATES_GATEWAY_TIMEOUT_MS, 10000),
  };
}
