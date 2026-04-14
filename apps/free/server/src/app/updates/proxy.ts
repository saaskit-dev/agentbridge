import { Logger } from '@saaskit-dev/agentbridge/telemetry';
import { getUpdatesGatewayConfig } from './config';

const logger = new Logger('app/updates/proxy');

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export type UpdatesProxyRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body?: Buffer;
};

export type UpdatesProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

function normalizeHeaders(headers: UpdatesProxyRequest['headers']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) continue;
    result[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

export async function proxyExpoUpdates(request: UpdatesProxyRequest): Promise<UpdatesProxyResponse> {
  const config = getUpdatesGatewayConfig();
  if (!config.enabled) {
    throw new Error('Expo updates gateway is disabled');
  }
  if (config.mode !== 'expo') {
    throw new Error(`Unsupported updates gateway mode: ${config.mode}`);
  }
  if (!config.upstreamUrl) {
    throw new Error('EXPO_UPDATES_UPSTREAM_URL is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const upstreamResponse = await fetch(config.upstreamUrl, {
      method: request.method,
      headers: normalizeHeaders(request.headers),
      body: request.body,
      signal: controller.signal,
      redirect: 'manual',
    });

    const body = Buffer.from(await upstreamResponse.arrayBuffer());
    const headers: Record<string, string> = {};
    upstreamResponse.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        headers[key] = value;
      }
    });

    logger.debug('Proxied Expo update request', {
      status: upstreamResponse.status,
      contentType: headers['content-type'] || null,
      runtimeVersion: headers['expo-manifest-filters'] || null,
    });

    return {
      status: upstreamResponse.status,
      headers,
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}
